// Background job runner: submits approved jobs, polls providers, downloads
// results into the asset library. Rules that protect money:
//  * a job is submitted at most once unless the failure is provably pre-send
//    (connection refused / 429 rejected) — bounded by maxRetries with backoff;
//  * if the submit outcome is unknown (timeout after send) the job goes to
//    needs_review instead of being resubmitted;
//  * jobs left in "submitting" by a crash are moved to needs_review on startup.
import fs from 'node:fs';
import path from 'node:path';
import { hydrate, now, uid, logEvent } from '../db.js';
import { registerFile } from './assets.js';
import { redact } from '../secrets.js';

export function createRunner({ db, providers, config, secretsForRedaction = () => [] }) {
  let timer = null;
  let busy = false;
  const listeners = new Set();

  const get = (id) => hydrate(db.prepare('SELECT * FROM jobs WHERE id = ?').get(id));
  const update = (id, fields) => {
    const keys = Object.keys(fields);
    const sql = `UPDATE jobs SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`;
    db.prepare(sql).run(...keys.map((k) => (k.endsWith('_json') ? JSON.stringify(fields[k]) : fields[k])), now(), id);
    const j = get(id);
    for (const l of listeners) l(j);
    return j;
  };
  const errJson = (e) => ({ category: e.category ?? 'internal', message: redact(e.message, secretsForRedaction()), code: e.code ?? null, status: e.status ?? null });

  function recover() {
    const stuck = db.prepare(`SELECT id FROM jobs WHERE status = 'submitting'`).all();
    for (const { id } of stuck) {
      update(id, { status: 'needs_review', error_json: { category: 'network_unknown', message: 'app stopped while submitting; the provider may or may not have received this job. Check the provider console or use "Reconcile" before retrying.' } });
      logEvent(db, 'warn', 'job.recover', `job ${id} moved to needs_review after restart`);
    }
  }

  async function submitOne(job) {
    const provider = providers.get(job.provider);
    update(job.id, { status: 'submitting', attempts: job.attempts + 1, submitted_at: now() });
    try {
      const { task_id } = await provider.submit(job.model, job.request, {});
      update(job.id, { status: 'running', provider_task_id: task_id });
      logEvent(db, 'info', 'job.submitted', `job ${job.id} -> ${job.provider} task ${task_id}`);
    } catch (e) {
      const attempts = job.attempts + 1;
      if (e.retryable && (e.category === 'network_pre_send' || e.category === 'rate_limit') && attempts < config.maxRetries) {
        const wait = Math.min(60000, 1000 * 2 ** attempts);
        update(job.id, { status: 'queued', next_attempt_at: new Date(Date.now() + wait).toISOString(), error_json: errJson(e) });
        logEvent(db, 'warn', 'job.retry', `job ${job.id} submit retry in ${wait}ms (${e.category})`);
      } else if (e.category === 'network_unknown') {
        update(job.id, { status: 'needs_review', error_json: errJson(e) });
      } else {
        finishFailed(job.id, errJson(e));
      }
    }
  }

  function finishFailed(id, error) {
    const j = update(id, { status: 'failed', error_json: error, finished_at: now() });
    db.prepare('UPDATE usage SET actual_usd = 0 WHERE job_id = ?').run(id); // documented: failed/moderated tasks are not billed
    if (j.shot_id) db.prepare(`UPDATE shots SET status = 'needs_attention', updated_at = ? WHERE id = ? AND status = 'generating'`).run(now(), j.shot_id);
    logEvent(db, 'warn', 'job.failed', `job ${id} failed: ${error.category} ${error.message}`);
  }

  async function pollOne(job) {
    const provider = providers.get(job.provider);
    if (Date.now() - Date.parse(job.submitted_at) > config.jobTimeoutMs) {
      update(job.id, { status: 'needs_review', error_json: { category: 'timeout', message: `no result after ${Math.round(config.jobTimeoutMs / 60000)} min; the provider task may still finish — use "Recheck"` } });
      return;
    }
    let r;
    try { r = await provider.poll(job.provider_task_id, {}); }
    catch (e) {
      // Polling is read-only: always safe to try again next tick.
      logEvent(db, 'warn', 'job.poll_error', `job ${job.id} poll error: ${redact(e.message, secretsForRedaction())}`);
      if (e.category === 'auth') update(job.id, { error_json: errJson(e) });
      return;
    }
    if (r.status === 'running') { if (r.progress != null) update(job.id, { result_json: { progress: r.progress } }); return; }
    if (r.status === 'failed') return finishFailed(job.id, r.error ?? { category: 'provider', message: 'failed' });
    await collect(job, provider, r);
  }

  async function collect(job, provider, r) {
    const outDir = path.join(config.outputsDir, job.project_id);
    fs.mkdirSync(outDir, { recursive: true });
    const ext = r.result.output_format === 'mov' ? '.mov' : '.mp4';
    const base = `${(job.label || 'shot').replace(/[^\w-]+/g, '_').slice(0, 40)}_${job.id.slice(0, 8)}`;
    const dest = path.join(outDir, base + ext);
    try {
      await provider.download(r.result, dest, {});
    } catch (e) {
      logEvent(db, 'warn', 'job.download_error', `job ${job.id} download error: ${e.message}`);
      return; // retry next tick; provider URLs stay valid for a while
    }
    const meta = { job_id: job.id, provider: job.provider, model: job.model, provider_task_id: job.provider_task_id, mock: !!r.result.mock,
      seed: r.result.seed ?? null, prompt: job.request.prompt, params: job.request.params };
    if (r.result.url) { meta.provider_url = r.result.url; meta.provider_url_valid_until = new Date(Date.now() + 23 * 3600 * 1000).toISOString(); meta.trusted_output = true; }
    const asset = await registerFile(db, { projectId: job.project_id, file: dest, origin: 'generated', meta,
      rights: { rights_confirmed: true, source: `generated by ${job.provider}/${job.model}` }, tags: ['generated', job.workflow] });
    let lastFrame = null;
    if (provider.downloadLastFrame && r.result.last_frame_url) {
      const lf = path.join(outDir, base + '_last.jpg');
      if (await provider.downloadLastFrame(r.result, lf)) {
        lastFrame = await registerFile(db, { projectId: job.project_id, file: lf, origin: 'generated',
          meta: { job_id: job.id, role: 'last_frame', trusted_output: true }, rights: { rights_confirmed: true, source: 'last frame of generation' }, tags: ['last_frame'] });
      }
    }
    const usd = r.usage?.usd ?? r.usage?.usd_upper_bound ?? null;
    if (usd != null) db.prepare('UPDATE usage SET actual_usd = ?, tokens = ? WHERE job_id = ?').run(usd, r.usage.tokens ?? null, job.id);
    update(job.id, { status: 'succeeded', output_asset_id: asset.id, finished_at: now(), result_json: { ...r.result, url: undefined, last_frame_asset_id: lastFrame?.id ?? null, usage: r.usage ?? null } });
    if (job.shot_id) db.prepare(`UPDATE shots SET status = 'review', selected_job_id = COALESCE(selected_job_id, ?), updated_at = ? WHERE id = ?`).run(job.id, now(), job.shot_id);
    logEvent(db, 'info', 'job.succeeded', `job ${job.id} -> asset ${asset.id}`);
  }

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const due = db.prepare(`SELECT * FROM jobs WHERE status = 'queued' AND (next_attempt_at IS NULL OR next_attempt_at <= ?) ORDER BY created_at LIMIT 3`).all(now()).map(hydrate);
      for (const j of due) await submitOne(j);
      const running = db.prepare(`SELECT * FROM jobs WHERE status = 'running' ORDER BY updated_at LIMIT 10`).all().map(hydrate);
      for (const j of running) await pollOne(j);
    } catch (e) {
      logEvent(db, 'error', 'runner.error', e.message);
    } finally { busy = false; }
  }

  return {
    start() { recover(); timer = setInterval(tick, config.pollMs); tick(); },
    stop() { clearInterval(timer); timer = null; },
    tick,
    onUpdate(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    async cancel(id) {
      const job = get(id);
      if (!job) throw Object.assign(new Error('job not found'), { status: 404 });
      if (['awaiting_approval', 'queued'].includes(job.status)) {
        db.prepare('UPDATE usage SET estimated_usd = 0, actual_usd = 0 WHERE job_id = ?').run(id);
        return update(id, { status: 'cancelled', finished_at: now() });
      }
      if (job.status === 'running') {
        try { await providers.get(job.provider).cancel(job.provider_task_id, {}); }
        catch (e) { throw Object.assign(new Error(`provider refused cancel: ${e.message} (ModelArk can only cancel queued tasks)`), { status: 409 }); }
        return update(id, { status: 'cancelled', finished_at: now() });
      }
      throw Object.assign(new Error(`cannot cancel a ${job.status} job`), { status: 409 });
    },
    // needs_review -> running again (re-poll an existing provider task id)
    recheck(id) {
      const job = get(id);
      if (job?.status !== 'needs_review' || !job.provider_task_id) throw Object.assign(new Error('only needs_review jobs with a provider task id can be rechecked'), { status: 409 });
      return update(id, { status: 'running', submitted_at: now(), error_json: null });
    },
    // Attach a provider task id found by reconciliation to a needs_review job.
    attachTask(id, taskId) {
      const job = get(id);
      if (job?.status !== 'needs_review') throw Object.assign(new Error('job is not in needs_review'), { status: 409 });
      return update(id, { status: 'running', provider_task_id: taskId, submitted_at: now(), error_json: null });
    },
  };
}
