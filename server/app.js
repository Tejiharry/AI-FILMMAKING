// Application assembly: database, vault, providers, runner, HTTP routes.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.js';
import { openDb, hydrate, now, uid, logEvent, getSetting, setSetting } from './db.js';
import { loadMasterKey, Vault } from './secrets.js';
import { Router, send, readJson, serveStatic, sendFile, guardRequest } from './http.js';
import { VOCAB } from './engine/cinematography.js';
import { defaultSpec, resolveSpec, validateSpec } from './engine/shotspec.js';
import { createMockProvider } from './providers/mock.js';
import { createSeedanceProvider, DEFAULT_PRICING, DEFAULT_BASE_URL } from './providers/seedance.js';
import { planGeneration, createJob, approveJob, rejectJob, budgetStatus, DEFAULT_BUDGET, httpError } from './services/generation.js';
import { createRunner } from './services/runner.js';
import { setAssetsRoot, ingestUpload, deleteAsset } from './services/assets.js';
import { registerExtendedRoutes } from './routes/extended.js';
import { seedPresets } from './engine/presets.js';
import { createComfyH3Provider } from './providers/comfy-h3.js';
import { createEngineManager } from './services/engine.js';

export function createApp(overrides = {}) {
  const config = loadConfig(overrides);
  fs.mkdirSync(config.assetsDir, { recursive: true });
  fs.mkdirSync(config.outputsDir, { recursive: true });
  setAssetsRoot(config.assetsDir);
  const db = openDb(config.dbPath);
  const vault = new Vault(db, loadMasterKey(config.keyFile));
  seedPresets(db);

  const providers = new Map();
  const mock = overrides.mockProvider ?? createMockProvider({ delayMs: config.mockDelayMs });
  providers.set('mock', mock);
  const seedanceCreds = () => {
    const key = vault.get('seedance');
    const meta = vault.describe('seedance');
    return key ? { api_key: key, base_url: meta.base_url, endpoint_id: meta.endpoint_id } : null;
  };
  providers.set('seedance', createSeedanceProvider({
    getCredentials: seedanceCreds,
    getPricing: () => getSetting(db, 'pricing.seedance', DEFAULT_PRICING),
    getSettings: () => getSetting(db, 'provider.seedance', {}),
    fetchImpl: overrides.fetchImpl ?? globalThis.fetch,
  }));

  const h3Settings = () => getSetting(db, 'provider.local-h3', {});
  providers.set('local-h3', overrides.h3Provider ?? createComfyH3Provider({ getSettings: h3Settings, fetchImpl: overrides.fetchImpl ?? globalThis.fetch, workDir: config.outputsDir, configDir: path.join(config.dataDir, 'engine') }));
  const engine = createEngineManager({ getSettings: h3Settings, configDir: path.join(config.dataDir, 'engine') });

  const runner = createRunner({ db, providers, config, secretsForRedaction: () => [vault.get('seedance')].filter(Boolean) });
  const sse = new Set();
  runner.onUpdate((job) => { const msg = `event: job\ndata: ${JSON.stringify(publicJob(job))}\n\n`; for (const r of sse) r.write(msg); });

  const r = new Router();
  const one = (sql, ...a) => hydrate(db.prepare(sql).get(...a));
  const all = (sql, ...a) => db.prepare(sql).all(...a).map(hydrate);
  const must = (row, what) => { if (!row) throw httpError(404, `${what} not found`); return row; };

  // ---------------------------------------------------------------- meta
  r.get('/api/health', () => ({ ok: true, time: now() }));
  r.get('/api/vocab', () => ({ vocab: VOCAB, default_spec: defaultSpec() }));
  r.get('/api/events', (_p, q) => all('SELECT * FROM events ORDER BY id DESC LIMIT ?', Math.min(500, Number(q.get('limit') ?? 100))));

  // ---------------------------------------------------------------- projects
  r.get('/api/projects', () => all(`SELECT p.*, (SELECT COUNT(*) FROM shots s WHERE s.project_id = p.id) AS shot_count,
    (SELECT COUNT(*) FROM assets a WHERE a.project_id = p.id) AS asset_count FROM projects p ORDER BY updated_at DESC`));
  r.post('/api/projects', (_p, _q, b) => {
    if (!b.name?.trim()) throw httpError(400, 'name required');
    const id = uid(), t = now();
    const settings = { shot_defaults: { aspect: '16:9', resolution: '720p', ...(b.settings?.shot_defaults ?? {}) }, ...(b.settings ?? {}) };
    db.prepare('INSERT INTO projects (id, name, logline, settings_json, created_at, updated_at) VALUES (?,?,?,?,?,?)').run(id, b.name.trim(), b.logline ?? '', JSON.stringify(settings), t, t);
    return [201, one('SELECT * FROM projects WHERE id = ?', id)];
  });
  r.get('/api/projects/:id', ({ id }) => {
    const p = must(one('SELECT * FROM projects WHERE id = ?', id), 'project');
    p.scenes = all('SELECT * FROM scenes WHERE project_id = ? ORDER BY idx', id);
    for (const s of p.scenes) s.shots = all(`SELECT sh.*, j.output_asset_id AS selected_output_asset_id FROM shots sh
      LEFT JOIN jobs j ON j.id = sh.selected_job_id WHERE sh.scene_id = ? ORDER BY sh.idx`, s.id);
    return p;
  });
  r.patch('/api/projects/:id', ({ id }, _q, b) => {
    const p = must(one('SELECT * FROM projects WHERE id = ?', id), 'project');
    db.prepare('UPDATE projects SET name = ?, logline = ?, settings_json = ?, updated_at = ? WHERE id = ?')
      .run(b.name ?? p.name, b.logline ?? p.logline, JSON.stringify(b.settings ?? p.settings), now(), id);
    return one('SELECT * FROM projects WHERE id = ?', id);
  });
  r.del('/api/projects/:id', ({ id }, q) => {
    const p = must(one('SELECT * FROM projects WHERE id = ?', id), 'project');
    if (q.get('confirm') !== p.name) throw httpError(400, 'pass ?confirm=<exact project name> to delete a project and all its media');
    const files = all('SELECT path, meta_json FROM assets WHERE project_id = ?', id);
    for (const a of files) for (const f of [a.path, a.meta?.thumb]) if (f) fs.rmSync(f, { force: true });
    db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    logEvent(db, 'info', 'project.delete', `project "${p.name}" deleted by user`);
    return { deleted: true };
  });

  // ---------------------------------------------------------------- scenes
  r.post('/api/projects/:id/scenes', ({ id }, _q, b) => {
    must(one('SELECT id FROM projects WHERE id = ?', id), 'project');
    const idx = (db.prepare('SELECT MAX(idx) m FROM scenes WHERE project_id = ?').get(id).m ?? 0) + 1;
    const sid = uid(), t = now();
    db.prepare('INSERT INTO scenes (id, project_id, idx, heading, script_text, settings_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(sid, id, b.idx ?? idx, b.heading ?? `Scene ${idx}`, b.script_text ?? '', JSON.stringify(b.settings ?? {}), t, t);
    touchProject(id);
    return [201, one('SELECT * FROM scenes WHERE id = ?', sid)];
  });
  r.patch('/api/scenes/:id', ({ id }, _q, b) => {
    const s = must(one('SELECT * FROM scenes WHERE id = ?', id), 'scene');
    db.prepare('UPDATE scenes SET heading = ?, script_text = ?, settings_json = ?, idx = ?, updated_at = ? WHERE id = ?')
      .run(b.heading ?? s.heading, b.script_text ?? s.script_text, JSON.stringify(b.settings ?? s.settings), b.idx ?? s.idx, now(), id);
    touchProject(s.project_id);
    return one('SELECT * FROM scenes WHERE id = ?', id);
  });
  r.del('/api/scenes/:id', ({ id }) => {
    const s = must(one('SELECT * FROM scenes WHERE id = ?', id), 'scene');
    db.prepare('DELETE FROM scenes WHERE id = ?').run(id);
    touchProject(s.project_id);
    return { deleted: true };
  });

  // ---------------------------------------------------------------- shots
  r.post('/api/scenes/:id/shots', ({ id }, _q, b) => {
    const s = must(one('SELECT * FROM scenes WHERE id = ?', id), 'scene');
    return [201, insertShot(s, b)];
  });
  r.get('/api/shots/:id', ({ id }) => {
    const shot = must(one('SELECT * FROM shots WHERE id = ?', id), 'shot');
    shot.jobs = all('SELECT * FROM jobs WHERE shot_id = ? ORDER BY created_at DESC', id).map(publicJob);
    return shot;
  });
  r.patch('/api/shots/:id', ({ id }, _q, b) => {
    const s = must(one('SELECT * FROM shots WHERE id = ?', id), 'shot');
    db.prepare('UPDATE shots SET title = ?, spec_json = ?, idx = ?, status = ?, selected_job_id = ?, updated_at = ? WHERE id = ?')
      .run(b.title ?? s.title, JSON.stringify(b.spec ?? s.spec), b.idx ?? s.idx, b.status ?? s.status, b.selected_job_id === undefined ? s.selected_job_id : b.selected_job_id, now(), id);
    touchProject(s.project_id);
    return one('SELECT * FROM shots WHERE id = ?', id);
  });
  r.del('/api/shots/:id', ({ id }) => { must(one('SELECT id FROM shots WHERE id = ?', id), 'shot'); db.prepare('DELETE FROM shots WHERE id = ?').run(id); return { deleted: true }; });
  r.post('/api/shots/:id/duplicate', ({ id }) => {
    const s = must(one('SELECT * FROM shots WHERE id = ?', id), 'shot');
    const scene = one('SELECT * FROM scenes WHERE id = ?', s.scene_id);
    return [201, insertShot(scene, { title: `${s.title} (copy)`, spec: s.spec })];
  });
  r.get('/api/shots/:id/effective', ({ id }) => {
    const s = must(one('SELECT * FROM shots WHERE id = ?', id), 'shot');
    const scene = one('SELECT * FROM scenes WHERE id = ?', s.scene_id);
    const p = one('SELECT * FROM projects WHERE id = ?', s.project_id);
    const spec = resolveSpec(p.settings, scene.settings, s.spec);
    return { spec, validation: validateSpec(spec) };
  });
  // `spec` (optional) previews unsaved edits without writing them (live cost on the Generate button).
  r.post('/api/shots/:id/plan', ({ id }, _q, b) => planView(planGeneration(db, providers, { shotId: id, providerId: b.provider, model: b.model, workflow: b.workflow, extraInputs: b.extra_inputs ?? [], specOverride: b.spec })));
  r.post('/api/shots/:id/generate', ({ id }, _q, b) => {
    // takes: 1–4 variants of the same shot. Take 1 is idempotent as usual; extra takes are deliberate new
    // requests (force) with a different seed where the model supports seeds.
    const takes = Math.max(1, Math.min(4, Number(b.takes ?? 1) || 1));
    const out = [];
    for (let i = 0; i < takes; i++) {
      const base = one('SELECT spec_json FROM shots WHERE id = ?', id)?.spec ?? {};
      const specOverride = i === 0 ? undefined : { ...base, seed: Math.floor(Math.random() * 2 ** 31) };
      const plan = planGeneration(db, providers, { shotId: id, providerId: b.provider, model: b.model, workflow: b.workflow, extraInputs: b.extra_inputs ?? [], specOverride, label: takes > 1 ? `${one('SELECT title FROM shots WHERE id = ?', id)?.title ?? 'shot'} · take ${i + 1}` : undefined });
      const { job, duplicate } = createJob(db, plan, { force: !!b.force || i > 0 });
      out.push({ job: publicJob(job), duplicate, plan: planView(plan) });
    }
    runner.tick();
    const first = out[0];
    return [first.duplicate && takes === 1 ? 200 : 201, { ...first, takes: out.map((x) => ({ job: x.job, duplicate: x.duplicate })) }];
  });

  // ---------------------------------------------------------------- assets
  r.get('/api/projects/:id/assets', ({ id }, q) => {
    const kind = q.get('kind');
    return kind ? all('SELECT * FROM assets WHERE project_id = ? AND kind = ? ORDER BY created_at DESC', id, kind) : all('SELECT * FROM assets WHERE project_id = ? ORDER BY created_at DESC', id);
  });
  r.put('/api/projects/:id/assets', async ({ id }, q, _b, req) => {
    must(one('SELECT id FROM projects WHERE id = ?', id), 'project');
    if (q.get('rights_confirmed') !== '1') throw httpError(400, 'confirm you have the rights to use this media (rights_confirmed=1)');
    const rights = { rights_confirmed: true, depicts_real_person: q.get('depicts_real_person') === '1', likeness_consent: q.get('likeness_consent') === '1', note: q.get('rights_note') ?? '', confirmed_at: now() };
    const tags = (q.get('tags') ?? '').split(',').map((t) => t.trim()).filter(Boolean);
    const out = await ingestUpload(db, { projectId: id, req, filename: q.get('filename') ?? 'upload.bin', rights, tags, maxBytes: config.maxUploadBytes });
    touchProject(id);
    return [out.duplicate ? 200 : 201, out];
  }, { rawBody: true });
  r.get('/api/assets/:id', ({ id }) => must(one('SELECT * FROM assets WHERE id = ?', id), 'asset'));
  r.patch('/api/assets/:id', ({ id }, _q, b) => {
    const a = must(one('SELECT * FROM assets WHERE id = ?', id), 'asset');
    const meta = { ...a.meta };
    if (b.remote_url !== undefined) {
      if (b.remote_url && !/^(https:\/\/|asset:\/\/)/.test(b.remote_url)) throw httpError(400, 'remote_url must start with https:// or asset://');
      meta.remote_url = b.remote_url || undefined;
    }
    const rights = b.rights ? { ...a.rights, ...b.rights } : a.rights;
    db.prepare('UPDATE assets SET meta_json = ?, rights_json = ?, tags_json = ?, filename = ? WHERE id = ?')
      .run(JSON.stringify(meta), JSON.stringify(rights), JSON.stringify(b.tags ?? a.tags), b.filename ?? a.filename, id);
    return one('SELECT * FROM assets WHERE id = ?', id);
  });
  r.del('/api/assets/:id', ({ id }) => { deleteAsset(db, id); return { deleted: true }; });
  r.get('/api/assets/:id/file', ({ id }, q, _b, req, res) => {
    const a = must(one('SELECT * FROM assets WHERE id = ?', id), 'asset');
    sendFile(req, res, a.path, a.mime, { download: q.get('download') === '1', filename: a.filename });
  }, { raw: true });
  r.get('/api/assets/:id/thumb', ({ id }, _q, _b, req, res) => {
    const a = must(one('SELECT * FROM assets WHERE id = ?', id), 'asset');
    if (!a.meta?.thumb) return send(res, 404, { error: 'no thumbnail' });
    sendFile(req, res, a.meta.thumb, 'image/jpeg');
  }, { raw: true });

  // ---------------------------------------------------------------- references (consistency library)
  r.get('/api/projects/:id/refs', ({ id }) => all('SELECT * FROM refs WHERE project_id = ? ORDER BY type, name', id));
  r.post('/api/projects/:id/refs', ({ id }, _q, b) => {
    must(one('SELECT id FROM projects WHERE id = ?', id), 'project');
    if (!b.name?.trim() || !b.type) throw httpError(400, 'name and type required');
    const handle = normHandle(b.handle ?? b.name);
    if (one('SELECT id FROM refs WHERE project_id = ? AND handle = ?', id, handle)) throw httpError(409, `handle ${handle} already exists`);
    const rid = uid(), t = now();
    db.prepare('INSERT INTO refs (id, project_id, type, name, handle, description, asset_ids_json, attrs_json, consent_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(rid, id, b.type, b.name.trim(), handle, b.description ?? '', JSON.stringify(b.asset_ids ?? []), JSON.stringify(b.attrs ?? {}), JSON.stringify(b.consent ?? {}), t, t);
    return [201, one('SELECT * FROM refs WHERE id = ?', rid)];
  });
  r.patch('/api/refs/:id', ({ id }, _q, b) => {
    const x = must(one('SELECT * FROM refs WHERE id = ?', id), 'reference');
    db.prepare('UPDATE refs SET name = ?, type = ?, description = ?, asset_ids_json = ?, attrs_json = ?, consent_json = ?, updated_at = ? WHERE id = ?')
      .run(b.name ?? x.name, b.type ?? x.type, b.description ?? x.description, JSON.stringify(b.asset_ids ?? x.asset_ids), JSON.stringify(b.attrs ?? x.attrs), JSON.stringify(b.consent ?? x.consent), now(), id);
    return one('SELECT * FROM refs WHERE id = ?', id);
  });
  r.del('/api/refs/:id', ({ id }) => { db.prepare('DELETE FROM refs WHERE id = ?').run(id); return { deleted: true }; });

  // ---------------------------------------------------------------- jobs
  r.get('/api/projects/:id/jobs', ({ id }) => all('SELECT * FROM jobs WHERE project_id = ? ORDER BY created_at DESC LIMIT 500', id).map(publicJob));
  r.get('/api/jobs/:id', ({ id }) => publicJob(must(one('SELECT * FROM jobs WHERE id = ?', id), 'job')));
  r.post('/api/jobs/:id/approve', ({ id }, _q, b) => { const j = approveJob(db, id, { confirmUsd: b.confirm_usd }); runner.tick(); return publicJob(j); });
  r.post('/api/jobs/:id/reject', ({ id }) => { rejectJob(db, id); return publicJob(one('SELECT * FROM jobs WHERE id = ?', id)); });
  r.post('/api/jobs/:id/cancel', async ({ id }) => publicJob(await runner.cancel(id)));
  r.post('/api/jobs/:id/recheck', ({ id }) => { const j = runner.recheck(id); runner.tick(); return publicJob(j); });
  r.post('/api/jobs/:id/attach', ({ id }, _q, b) => { if (!b.task_id) throw httpError(400, 'task_id required'); const j = runner.attachTask(id, b.task_id); runner.tick(); return publicJob(j); });
  r.get('/api/stream', (_p, _q, _b, req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(': connected\n\n');
    sse.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { clearInterval(ping); sse.delete(res); });
  }, { raw: true });

  // ---------------------------------------------------------------- providers, credentials, budget
  r.get('/api/providers', () => [...providers.values()].map((p) => ({
    id: p.id, label: p.label, billable: p.billable, description: p.description, models: p.models(),
    credentials: p.id === 'mock' || p.id === 'local-h3' ? { configured: true } : vault.describe(p.id),
    attribution: p.attribution ?? null,
    defaults: p.id === 'seedance' ? { base_url: DEFAULT_BASE_URL } : {},
    settings: getSetting(db, `provider.${p.id}`, {}),
    pricing: p.id === 'seedance' ? getSetting(db, 'pricing.seedance', DEFAULT_PRICING) : null,
  })));
  r.put('/api/providers/:id/credentials', ({ id }, _q, b) => {
    if (!providers.has(id) || id === 'mock') throw httpError(400, 'unknown or credential-less provider');
    if (!b.api_key || typeof b.api_key !== 'string' || b.api_key.length < 8) throw httpError(400, 'api_key required');
    if (b.base_url && !/^https:\/\//.test(b.base_url)) throw httpError(400, 'base_url must be https');
    vault.set(id, b.api_key.trim(), { base_url: b.base_url || DEFAULT_BASE_URL, endpoint_id: b.endpoint_id || null });
    logEvent(db, 'info', 'credentials.set', `${id} credentials updated`);
    return vault.describe(id);
  });
  r.del('/api/providers/:id/credentials', ({ id }) => { vault.remove(id); logEvent(db, 'info', 'credentials.remove', `${id} credentials removed`); return { configured: false }; });
  r.post('/api/providers/:id/test', async ({ id }) => {
    const p = providers.get(id); if (!p) throw httpError(404, 'provider not found');
    try { return await p.testConnection({}); } catch (e) { return { ok: false, detail: e.message, category: e.category }; }
  });
  r.put('/api/providers/:id/settings', ({ id }, _q, b) => {
    const allowed = id === 'local-h3'
      ? { lora: ['v1', 'v1.5'], keep_source_audio: [true, false] }
      : { output_format: ['mp4', 'mov'], watermark: [true, false] };
    const s = {};
    for (const [k, vals] of Object.entries(allowed)) if (b[k] !== undefined) { if (!vals.includes(b[k])) throw httpError(400, `${k} must be one of ${vals.join(', ')}`); s[k] = b[k]; }
    if (id === 'local-h3' && b.engine_dir !== undefined) {
      // The engine folder can be moved (e.g. to a faster disk); point the studio at its new location.
      const dir = String(b.engine_dir).trim();
      if (!fs.existsSync(path.join(dir, 'ComfyUI_windows_portable', 'python_embeded', 'python.exe'))) throw httpError(400, `no portable ComfyUI found in "${dir}"`);
      if (!fs.existsSync(path.join(dir, 'models'))) throw httpError(400, `no models folder in "${dir}"`);
      s.engine_dir = dir;
    }
    setSetting(db, `provider.${id}`, { ...getSetting(db, `provider.${id}`, {}), ...s });
    return getSetting(db, `provider.${id}`, {});
  });
  r.get('/api/engine', () => engine.status());
  r.post('/api/engine/start', () => engine.start());
  r.post('/api/engine/stop', () => engine.stop());
  r.get('/api/providers/:id/recent', async ({ id }, q) => {
    const p = providers.get(id); if (!p?.listRecent) throw httpError(400, 'provider has no task listing');
    return p.listRecent({ sinceUnix: q.get('since') ? Number(q.get('since')) : undefined });
  });
  r.get('/api/budget', () => {
    const st = budgetStatus(db);
    const byProvider = all(`SELECT provider, COUNT(*) AS jobs, SUM(COALESCE(actual_usd, estimated_usd)) AS usd FROM usage WHERE billable = 1 GROUP BY provider`);
    return { ...st, by_provider: byProvider };
  });
  r.put('/api/budget', (_p, _q, b) => {
    const cur = getSetting(db, 'budget', DEFAULT_BUDGET);
    const next = { ...cur };
    for (const k of ['per_job_usd', 'daily_usd', 'monthly_usd']) if (b[k] !== undefined) { const n = Number(b[k]); if (!(n >= 0)) throw httpError(400, `${k} must be ≥ 0`); next[k] = n; }
    setSetting(db, 'budget', next);
    return next;
  });

  registerExtendedRoutes(r, { db, providers, runner, config, one, all, must, insertShot, touchProject });

  function insertShot(scene, b) {
    const idx = b.idx ?? (db.prepare('SELECT MAX(idx) m FROM shots WHERE scene_id = ?').get(scene.id).m ?? 0) + 1;
    const id = uid(), t = now();
    db.prepare('INSERT INTO shots (id, project_id, scene_id, idx, title, spec_json, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(id, scene.project_id, scene.id, idx, b.title ?? `Shot ${idx}`, JSON.stringify(b.spec ?? {}), 'draft', t, t);
    touchProject(scene.project_id);
    return one('SELECT * FROM shots WHERE id = ?', id);
  }
  function touchProject(id) { db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now(), id); }

  // ---------------------------------------------------------------- server
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const block = guardRequest(req);
    if (block) return send(res, 403, { error: block });
    if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, config.webDir, url.pathname);
    const m = r.match(req.method, url.pathname);
    if (!m) return send(res, 404, { error: 'not found' });
    try {
      const opts = m.handler.opts ?? {};
      const body = opts.raw || opts.rawBody || req.method === 'GET' || req.method === 'DELETE' ? {} : await readJson(req);
      const out = await m.handler(m.params, url.searchParams, body, req, res);
      if (opts.raw) return;
      if (Array.isArray(out) && typeof out[0] === 'number') send(res, out[0], out[1]); else send(res, 200, out);
    } catch (e) {
      const status = e.status ?? (e.category ? 502 : 500);
      if (status >= 500) logEvent(db, 'error', 'http.error', `${req.method} ${url.pathname}: ${e.message}`);
      if (!res.headersSent) send(res, status, { error: e.message, ...(e.errors ? { errors: e.errors } : {}), ...(e.category ? { category: e.category } : {}) });
      else res.end();
    }
  });

  return {
    config, db, vault, providers, runner, server,
    clientCount: () => sse.size, // open studio windows (live-update connections)
    busy: () => db.prepare(`SELECT COUNT(*) n FROM jobs WHERE status IN ('queued','submitting','running')`).get().n > 0,
    listen() { return new Promise((resolve) => server.listen(config.port, config.host, () => { runner.start(); resolve(server.address()); })); },
    async close() { runner.stop(); engine.stop(); for (const s of sse) s.end(); await new Promise((r2) => server.close(r2)); server.closeAllConnections?.(); db.close(); },
  };
}

// Never send secrets or local filesystem paths of inputs to the client.
export function publicJob(j) {
  if (!j) return j;
  const req = j.request ? { ...j.request, inputs: (j.request.inputs ?? []).map(({ asset, ...rest }) => ({ ...rest, filename: asset?.filename })) } : j.request;
  return { ...j, request: req };
}

function planView(plan) {
  return {
    provider: plan.provider.id, model: plan.modelId, billable: plan.provider.billable, workflow: plan.req.workflow,
    prompt: plan.req.prompt, params: plan.req.params, inputs: plan.req.inputs.map(({ asset, ...i }) => ({ ...i, filename: asset?.filename })),
    report: plan.report, errors: plan.errors, warnings: plan.warnings, estimate: plan.estimate, caps: plan.caps, spec: plan.spec,
    wire_preview: plan.provider.toWire && !plan.errors.length ? safeWire(plan) : null,
  };
}

// Wire preview with media payloads elided (no Base64 blobs, no secrets).
function safeWire(plan) {
  try {
    const w = plan.provider.toWire(plan.modelId, { ...plan.req, inputs: plan.req.inputs.map((i) => ({ ...i, asset: { ...i.asset, meta: { ...(i.asset?.meta ?? {}), remote_url: i.asset?.meta?.remote_url ?? `<${i.kind === 'video' ? 'hosted URL required' : 'base64 ' + (i.asset?.filename ?? '')}>` } } })) });
    return w;
  } catch (e) { return { error: e.message }; }
}

function normHandle(s) {
  const h = '@' + String(s).replace(/^@/, '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  if (h.length < 2) throw httpError(400, 'invalid handle');
  return h;
}
