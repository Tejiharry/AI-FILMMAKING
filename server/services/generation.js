// Builds a provider-neutral GenerationRequest for a shot (or an ad-hoc workflow),
// validates it against the provider, estimates cost and creates a job.
import crypto from 'node:crypto';
import { hydrate, now, uid, logEvent, getSetting } from '../db.js';
import { resolveSpec, validateSpec } from '../engine/shotspec.js';
import { compileShot } from '../engine/compiler.js';
import { checkPrompt } from '../engine/promptcheck.js';

export const DEFAULT_BUDGET = { per_job_usd: 5, daily_usd: 25, monthly_usd: 250 };

export function loadRefs(db, projectId) {
  const refs = db.prepare('SELECT * FROM refs WHERE project_id = ?').all(projectId).map(hydrate);
  const assets = Object.fromEntries(db.prepare('SELECT * FROM assets WHERE project_id = ?').all(projectId).map((a) => [a.id, hydrate(a)]));
  const byHandle = {};
  for (const r of refs) byHandle[r.handle] = { ...r, assets: r.asset_ids.map((id) => assets[id]).filter(Boolean) };
  return { byHandle, assets };
}

// Replace library handles in the prompt with the provider's reference tokens and
// make sure every attached reference is mentioned at least once.
export function applyRefTokens(prompt, inputs, provider) {
  const counters = {};
  let out = prompt;
  const mentions = [];
  inputs.forEach((inp) => {
    const kind = inp.kind ?? 'image';
    counters[kind] = (counters[kind] ?? 0) + 1;
    inp.token = provider.refToken ? provider.refToken(inp, counters[kind] - 1, inputs) : inp.handle;
    if (!inp.token) return;
    if (inp.handle && inp.token !== inp.handle) {
      // Replace "@handle (Name: desc)" first-mention and bare "@handle" thereafter.
      out = out.split(inp.handle).join(inp.token);
    }
    if (!out.includes(inp.token) && ['reference_image', 'reference_video', 'reference_audio'].includes(inp.role))
      mentions.push(`${inp.token}: ${inp.label ?? inp.role.replace('reference_', '') + ' reference'}`);
  });
  if (mentions.length) out += ` References — ${mentions.join('; ')}.`;
  return out;
}

export function idempotencyKey(provider, model, req, assets) {
  const h = crypto.createHash('sha256');
  h.update(JSON.stringify({ provider, model, workflow: req.workflow, prompt: req.prompt, params: req.params,
    inputs: req.inputs.map((i) => [i.role, assets[i.asset_id]?.sha256 ?? i.asset_id]) }));
  return h.digest('hex');
}

export function budgetStatus(db) {
  const budget = getSetting(db, 'budget', DEFAULT_BUDGET);
  const sumSince = (iso) => db.prepare(`SELECT COALESCE(SUM(COALESCE(actual_usd, estimated_usd)),0) AS s FROM usage WHERE billable = 1 AND created_at >= ?`).get(iso).s;
  const d = new Date();
  const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
  const monthStart = new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
  return { budget, spent_today_usd: sumSince(dayStart), spent_month_usd: sumSince(monthStart) };
}

// Plan a generation. Does NOT create a job; returns everything the UI needs to
// show the approval card (prompt, report, validation, estimate).
export function planGeneration(db, providers, { shotId, providerId, model, workflow, specOverride, extraInputs = [], label }) {
  const shot = hydrate(db.prepare('SELECT * FROM shots WHERE id = ?').get(shotId));
  if (!shot) throw httpError(404, 'shot not found');
  const scene = hydrate(db.prepare('SELECT * FROM scenes WHERE id = ?').get(shot.scene_id));
  const project = hydrate(db.prepare('SELECT * FROM projects WHERE id = ?').get(shot.project_id));
  const provider = providers.get(providerId || shot.spec?.model_pref?.provider || 'mock');
  if (!provider) throw httpError(400, `unknown provider ${providerId}`);
  // Blank model preference = provider default (a '' must not become the model id).
  const modelId = model || shot.spec?.model_pref?.model || provider.models()[0].id;
  const caps = provider.caps(modelId);
  if (!caps) throw httpError(400, `unknown model ${modelId} for ${provider.id}`);

  const spec = resolveSpec(project.settings, scene.settings, specOverride ?? shot.spec);
  const specCheck = validateSpec(spec);
  const { byHandle, assets } = loadRefs(db, project.id);
  const compiled = compileShot(spec, { refsByHandle: byHandle, caps, assetsById: assets });
  const inputs = [...compiled.inputs, ...extraInputs].map((i) => {
    const a = assets[i.asset_id];
    return { ...i, kind: i.kind ?? a?.kind, label: i.label ?? a?.filename,
      asset: a ? { filename: a.filename, bytes: a.bytes, mime: a.mime, meta: a.meta, rights: a.rights, path: a.path } : undefined };
  });
  const wf = workflow || spec.workflow || inferWorkflow(inputs);
  const req = { workflow: wf, prompt: '', params: compiled.params, inputs, label: label ?? shot.title };
  req.prompt = applyRefTokens(compiled.prompt, inputs, provider);
  const missing = inputs.filter((i) => !assets[i.asset_id]).map((i) => i.asset_id);
  const provCheck = provider.validate(modelId, req);
  const promptCheck = checkPrompt(spec, { refsByHandle: byHandle, caps, prompt: req.prompt });
  const errors = [...specCheck.errors, ...provCheck.errors, ...promptCheck.errors, ...missing.map((m) => `input asset ${m} not found`)];
  const warnings = [...new Set([...specCheck.warnings, ...provCheck.warnings, ...promptCheck.warnings])];
  // Consent gate: references flagged as depicting a real person need recorded consent.
  for (const i of inputs) {
    const a = assets[i.asset_id];
    if (a?.rights?.depicts_real_person && !a?.rights?.likeness_consent) errors.push(`${a.filename}: depicts a real person but no likeness consent is recorded`);
    if (a && !a.rights?.rights_confirmed) errors.push(`${a.filename}: usage rights not confirmed`);
  }
  const estimate = provider.estimate(modelId, req);
  const key = idempotencyKey(provider.id, modelId, req, assets);
  return { project, scene, shot, spec, provider, modelId, caps, req, report: compiled.report, errors, warnings, estimate, key };
}

export function inferWorkflow(inputs) {
  const has = (r) => inputs.some((i) => i.role === r);
  if (has('first_frame') && has('last_frame')) return 'first_last_frame';
  if (has('first_frame')) return 'image_to_video';
  if (inputs.length) return 'reference_to_video';
  return 'generate';
}

// Create a job from a plan. Billable providers always start in awaiting_approval.
export function createJob(db, plan, { force = false, parentJobId = null, workflowLabel } = {}) {
  if (plan.errors.length) throw httpError(422, 'request is invalid', { errors: plan.errors });
  const active = db.prepare(`SELECT * FROM jobs WHERE idempotency_key = ? AND status IN ('awaiting_approval','queued','submitting','running','succeeded','needs_review') ORDER BY created_at DESC LIMIT 1`).get(plan.key);
  if (active && !force) return { job: hydrate(active), duplicate: true };
  const id = uid();
  const t = now();
  const status = plan.provider.billable ? 'awaiting_approval' : 'queued';
  db.prepare(`INSERT INTO jobs (id, project_id, shot_id, workflow, provider, model, status, idempotency_key, spec_snapshot_json, request_json,
      compile_report_json, estimate_json, parent_job_id, label, created_at, updated_at, approved_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, plan.project.id, plan.shot?.id ?? null, workflowLabel ?? plan.req.workflow, plan.provider.id, plan.modelId, status, plan.key,
      JSON.stringify(plan.spec), JSON.stringify(plan.req), JSON.stringify({ report: plan.report, warnings: plan.warnings }),
      JSON.stringify(plan.estimate), parentJobId, plan.req.label ?? '', t, t, plan.provider.billable ? null : t);
  db.prepare('INSERT INTO usage (id, job_id, provider, model, estimated_usd, billable, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(uid(), id, plan.provider.id, plan.modelId, plan.estimate.usd ?? 0, plan.provider.billable ? 1 : 0, t);
  if (plan.shot) db.prepare(`UPDATE shots SET status = 'generating', updated_at = ? WHERE id = ?`).run(t, plan.shot.id);
  logEvent(db, 'info', 'job.created', `job ${id} (${plan.provider.id}/${plan.modelId}) ${status}`, { job_id: id, estimate: plan.estimate });
  return { job: hydrate(db.prepare('SELECT * FROM jobs WHERE id = ?').get(id)), duplicate: false };
}

// Explicit approval of a billable job, with budget enforcement.
export function approveJob(db, jobId, { confirmUsd }) {
  const job = hydrate(db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId));
  if (!job) throw httpError(404, 'job not found');
  if (job.status !== 'awaiting_approval') throw httpError(409, `job is ${job.status}, not awaiting approval`);
  const est = Number(job.estimate.usd ?? 0);
  if (job.estimate.confidence === 'unknown') throw httpError(409, 'cost is unknown for this model — set pricing in Model Settings before approving');
  if (Number(confirmUsd) !== est) throw httpError(400, `confirmation amount must equal the estimate ($${est.toFixed(4)})`);
  const { budget, spent_today_usd, spent_month_usd } = budgetStatus(db);
  // usage already holds this job's estimate; exclude it from "spent" for the check.
  const today = spent_today_usd - est, month = spent_month_usd - est;
  if (est > budget.per_job_usd) throw httpError(402, `estimate $${est.toFixed(2)} exceeds per-job limit $${budget.per_job_usd}`);
  if (today + est > budget.daily_usd) throw httpError(402, `would exceed daily limit ($${today.toFixed(2)} spent + $${est.toFixed(2)} > $${budget.daily_usd})`);
  if (month + est > budget.monthly_usd) throw httpError(402, `would exceed monthly limit ($${month.toFixed(2)} + $${est.toFixed(2)} > $${budget.monthly_usd})`);
  const t = now();
  db.prepare(`UPDATE jobs SET status = 'queued', approved_at = ?, updated_at = ? WHERE id = ?`).run(t, t, jobId);
  logEvent(db, 'info', 'job.approved', `job ${jobId} approved at $${est}`, { job_id: jobId });
  return hydrate(db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId));
}

export function rejectJob(db, jobId) {
  const r = db.prepare(`UPDATE jobs SET status = 'rejected', updated_at = ? WHERE id = ? AND status = 'awaiting_approval'`).run(now(), jobId);
  if (!r.changes) throw httpError(409, 'job is not awaiting approval');
  db.prepare('UPDATE usage SET estimated_usd = 0 WHERE job_id = ?').run(jobId);
}

export function httpError(status, message, extra = {}) {
  const e = new Error(message);
  e.status = status;
  Object.assign(e, extra);
  return e;
}
