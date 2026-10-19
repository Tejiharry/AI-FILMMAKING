// End-to-end: real HTTP server, real SQLite, real ffmpeg, mock provider and a
// fetch-stubbed Seedance adapter (no network, no spend).
import { test, before, after } from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../../server/app.js';
import { tool, f } from '../../server/media.js';

let app, base, tmp, fixtures = {};
const seedanceCalls = [];

async function api(method, url, body, headers = {}) {
  const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body) });
  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
  return { status: res.status, data, headers: res.headers };
}
const upload = (pid, file, q = '') => api('PUT', `/api/projects/${pid}/assets?filename=${encodeURIComponent(path.basename(file))}&rights_confirmed=1${q}`, fs.readFileSync(file), { 'Content-Type': 'application/octet-stream' });

async function waitJob(id, until = ['succeeded', 'failed', 'needs_review', 'cancelled'], ms = 90000) {
  const t0 = Date.now();
  for (;;) {
    const { data } = await api('GET', `/api/jobs/${id}`);
    if (until.includes(data.status)) return data;
    if (Date.now() - t0 > ms) throw new Error(`job ${id} stuck in ${data.status}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

// Stub of the ModelArk API, recording every call.
function seedanceStub(realFetch) {
  let polls = 0;
  return async (url, init = {}) => {
    const u = String(url);
    if (!u.startsWith('https://ark.stub/') && !u.startsWith('https://cdn.stub/')) return realFetch(url, init);
    seedanceCalls.push({ url: u, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : null, auth: init.headers?.Authorization });
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
    if (u.endsWith('/contents/generations/tasks') && init.method === 'POST') return json({ id: 'cgt-stub-0001' });
    if (u.includes('/contents/generations/tasks?')) return json({ total: 0, items: [] });
    if (u.endsWith('/contents/generations/tasks/cgt-stub-0001')) {
      polls++;
      if (polls < 2) return json({ id: 'cgt-stub-0001', status: 'running' });
      return json({ id: 'cgt-stub-0001', model: 'dreamina-seedance-2-5-260628', status: 'succeeded', content: { video_url: 'https://cdn.stub/out.mp4', last_frame_url: 'https://cdn.stub/last.png' },
        usage: { completion_tokens: 108000, total_tokens: 108000 }, error: null, duration: 5, framespersecond: 24, resolution: '720p', ratio: '16:9', output_format: 'mp4' });
    }
    if (u === 'https://cdn.stub/out.mp4') return new Response(fs.readFileSync(fixtures.output), { status: 200 });
    if (u === 'https://cdn.stub/last.png') return new Response(fs.readFileSync(fixtures.image), { status: 200 });
    return json({ error: { code: 'NotFound', message: u } }, 404);
  };
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-e2e-'));
  fixtures.image = path.join(tmp, 'ref_still.png');
  fixtures.video = path.join(tmp, 'ref_two_shots.mp4');
  fixtures.output = path.join(tmp, 'stub_output.mp4');
  await tool('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'mandelbrot=size=640x360:rate=24', '-t', '5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', f(fixtures.output)]);
  await tool('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=1', '-frames:v', '1', f(fixtures.image)]);
  // Reference video with one hard cut at 3 s (two different sources).
  await tool('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24:duration=3', '-f', 'lavfi', '-i', 'smptebars=size=640x360:rate=24:duration=3',
    '-filter_complex', '[0:v][1:v]concat=n=2:v=1[v]', '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', f(fixtures.video)]);
  app = createApp({ dataDir: path.join(tmp, 'data'), port: 0, pollMs: 100, mockDelayMs: 300, fetchImpl: seedanceStub(globalThis.fetch) });
  const addr = await app.listen();
  base = `http://127.0.0.1:${addr.port}`;
});

after(async () => { await app?.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

let projectId, sceneId, shotId, imageId, mockJob;

test('M1: project → scene → shot → reference upload', async () => {
  const p = await api('POST', '/api/projects', { name: 'E2E Film', logline: 'test', settings: { shot_defaults: { look: { genre: 'drama' } } } });
  assert.equal(p.status, 201); projectId = p.data.id;
  const s = await api('POST', `/api/projects/${projectId}/scenes`, { heading: 'INT. KITCHEN - NIGHT', settings: { shot_defaults: { lighting: { time_of_day: 'night' } } } });
  assert.equal(s.status, 201); sceneId = s.data.id;
  const noRights = await api('PUT', `/api/projects/${projectId}/assets?filename=x.png`, fs.readFileSync(fixtures.image), { 'Content-Type': 'application/octet-stream' });
  assert.equal(noRights.status, 400, 'upload without rights confirmation is refused');
  const up = await upload(projectId, fixtures.image, '&tags=character');
  assert.equal(up.status, 201);
  imageId = up.data.asset.id;
  assert.equal(up.data.asset.kind, 'image');
  assert.deepEqual([up.data.asset.meta.image.width, up.data.asset.meta.image.height], [1280, 720], 'ffprobe metadata recorded');
  assert.equal((await upload(projectId, fixtures.image)).data.duplicate, true, 'same file is de-duplicated by sha256');
  const ref = await api('POST', `/api/projects/${projectId}/refs`, { type: 'character', name: 'Mira', description: 'woman in a red coat', asset_ids: [imageId] });
  assert.equal(ref.data.handle, '@mira');
  const sh = await api('POST', `/api/scenes/${sceneId}/shots`, { title: 'Mira reads', spec: {
    intent: { summary: 'Mira reads the letter by the window' }, duration_s: 5, framing: { shot_size: 'CU' }, camera: { movement: 'push_in', speed: 'slow', rig: 'dolly' },
    subjects: [{ ref: '@mira' }], audio: { generate: true } } });
  assert.equal(sh.status, 201); shotId = sh.data.id;
  const eff = await api('GET', `/api/shots/${shotId}/effective`);
  assert.equal(eff.data.spec.look.genre, 'drama');
  assert.equal(eff.data.spec.lighting.time_of_day, 'night');
});

test('M1: plan, generate (mock), track, retrieve, download', async () => {
  const blank = (await api('POST', `/api/scenes/${sceneId}/shots`, { title: 'blank pref', spec: { intent: { summary: 'x' }, duration_s: 4, model_pref: { provider: '', model: '' } } })).data;
  const bp = (await api('POST', `/api/shots/${blank.id}/plan`, {})).data;
  assert.equal(bp.provider, 'mock', 'blank provider preference falls back to default');
  assert.equal(bp.model, 'mock-video-1', 'blank model preference falls back to the provider default');
  await api('DELETE', `/api/shots/${blank.id}`);
  const plan = await api('POST', `/api/shots/${shotId}/plan`, { provider: 'mock' });
  assert.deepEqual(plan.data.errors, []);
  assert.match(plan.data.prompt, /@mira/);
  assert.equal(plan.data.estimate.usd, 0);
  assert.equal(plan.data.workflow, 'reference_to_video');
  const gen = await api('POST', `/api/shots/${shotId}/generate`, { provider: 'mock' });
  assert.equal(gen.status, 201);
  assert.equal(gen.data.job.status, 'queued', 'free provider jobs queue without approval');
  const dup = await api('POST', `/api/shots/${shotId}/generate`, { provider: 'mock' });
  assert.equal(dup.data.duplicate, true, 'identical request is not resubmitted');
  mockJob = await waitJob(gen.data.job.id);
  assert.equal(mockJob.status, 'succeeded', JSON.stringify(mockJob.error));
  const asset = (await api('GET', `/api/assets/${mockJob.output_asset_id}`)).data;
  assert.equal(asset.kind, 'video');
  assert.equal(asset.meta.mock, true);
  assert.ok(Math.abs(asset.meta.duration_s - 5) < 0.2);
  assert.ok(asset.meta.audio, 'generate_audio honoured by mock');
  const file = await api('GET', `/api/assets/${asset.id}/file?download=1`);
  assert.equal(file.status, 200);
  assert.match(file.headers.get('content-disposition'), /attachment/);
  assert.equal(file.data.length, asset.bytes);
  const range = await fetch(`${base}/api/assets/${asset.id}/file`, { headers: { Range: 'bytes=0-99' } });
  assert.equal(range.status, 206);
  assert.equal((await range.arrayBuffer()).byteLength, 100);
  const shot = (await api('GET', `/api/shots/${shotId}`)).data;
  assert.equal(shot.status, 'review');
  assert.equal(shot.selected_job_id, mockJob.id);
  assert.equal(shot.jobs[0].request.inputs[0].path, undefined, 'no local paths leak to the client');
});

test('M1: failure modes — moderation, transient retry', async () => {
  const mk = async (summary) => (await api('POST', `/api/scenes/${sceneId}/shots`, { title: summary, spec: { intent: { summary }, duration_s: 4 } })).data.id;
  const mod = await api('POST', `/api/shots/${await mk('test [mock:moderation]')}/generate`, { provider: 'mock' });
  const m = await waitJob(mod.data.job.id);
  assert.equal(m.status, 'failed'); assert.equal(m.error.category, 'moderation');
  const tr = await api('POST', `/api/shots/${await mk('test [mock:transient]')}/generate`, { provider: 'mock' });
  const t = await waitJob(tr.data.job.id);
  assert.equal(t.status, 'succeeded'); assert.equal(t.attempts, 2, 'retried once after a pre-send failure');
});

test('M1: Seedance — credentials vault, approval gate, budget, exact wire format, result retrieval (stubbed API)', async () => {
  const noCreds = await api('POST', '/api/providers/seedance/test');
  assert.equal(noCreds.data.ok, false);
  const put = await api('PUT', '/api/providers/seedance/credentials', { api_key: 'sk-test-SECRET-123456789', base_url: 'https://ark.stub/api/v3' });
  assert.equal(put.data.configured, true);
  const provs = await api('GET', '/api/providers');
  assert.ok(!JSON.stringify(provs.data).includes('SECRET'), 'API key never returned to the client');
  const conn = await api('POST', '/api/providers/seedance/test');
  assert.equal(conn.data.ok, true, JSON.stringify(conn.data));

  const sh = await api('POST', `/api/scenes/${sceneId}/shots`, { title: 'Seedance i2v', spec: { intent: { summary: 'The still comes alive, slow push in' }, duration_s: 5, resolution: '720p',
    references: [{ role: 'first_frame', asset_id: imageId }], audio: { generate: false } } });
  const plan = await api('POST', `/api/shots/${sh.data.id}/plan`, { provider: 'seedance' });
  assert.deepEqual(plan.data.errors, []);
  assert.equal(plan.data.workflow, 'image_to_video');
  assert.equal(plan.data.wire_preview.ratio, 'adaptive');
  assert.ok(plan.data.estimate.usd > 0);

  const before = seedanceCalls.filter((c) => c.method === 'POST').length;
  const gen = await api('POST', `/api/shots/${sh.data.id}/generate`, { provider: 'seedance' });
  assert.equal(gen.data.job.status, 'awaiting_approval', 'billable job waits for explicit approval');
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(seedanceCalls.filter((c) => c.method === 'POST').length, before, 'nothing submitted before approval');

  const jobId = gen.data.job.id;
  const est = gen.data.job.estimate.usd;
  assert.equal((await api('POST', `/api/jobs/${jobId}/approve`, { confirm_usd: est + 1 })).status, 400, 'confirmation must match the estimate');
  await api('PUT', '/api/budget', { per_job_usd: est / 2 });
  assert.equal((await api('POST', `/api/jobs/${jobId}/approve`, { confirm_usd: est })).status, 402, 'per-job budget enforced');
  await api('PUT', '/api/budget', { per_job_usd: 5 });
  const ok = await api('POST', `/api/jobs/${jobId}/approve`, { confirm_usd: est });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));

  const done = await waitJob(jobId);
  assert.equal(done.status, 'succeeded', JSON.stringify(done.error));
  const post = seedanceCalls.find((c) => c.method === 'POST');
  assert.equal(post.auth, 'Bearer sk-test-SECRET-123456789');
  assert.equal(post.body.model, 'dreamina-seedance-2-5-260628');
  assert.equal(post.body.ratio, 'adaptive');
  assert.equal(post.body.duration, 5);
  assert.equal(post.body.content[1].role, 'first_frame');
  assert.match(post.body.content[1].image_url.url, /^data:image\/png;base64,/);
  for (const k of ['seed', 'camera_fixed', 'frames']) assert.equal(post.body[k], undefined);
  assert.equal(seedanceCalls.filter((c) => c.method === 'POST').length, before + 1, 'exactly one billable submit');
  assert.ok(done.result.last_frame_asset_id, 'last frame saved for continuity');
  const budget = (await api('GET', '/api/budget')).data;
  assert.ok(budget.spent_today_usd > 0);
  const events = JSON.stringify((await api('GET', '/api/events?limit=500')).data);
  assert.ok(!events.includes('SECRET'), 'secret never written to the event log');
});

test('M2: director breakdown → scenes and shots; presets', async () => {
  const script = 'INT. KITCHEN - NIGHT\n\nMira enters, holding a letter.\n\nMIRA\nYou knew?\n\nDEV\nI was going to tell you!\n';
  const b = await api('POST', '/api/director/breakdown', { script, project_id: projectId });
  assert.equal(b.data.scenes.length, 1);
  const ap = await api('POST', `/api/projects/${projectId}/director/apply`, { breakdown: b.data, script, create_character_refs: true });
  assert.equal(ap.status, 201);
  const proj = (await api('GET', `/api/projects/${projectId}`)).data;
  assert.ok(proj.scenes.length >= 2);
  const presets = (await api('GET', '/api/presets')).data;
  const confession = presets.find((p) => p.name.startsWith('Intimate confession'));
  const applied = await api('POST', `/api/shots/${shotId}/apply-preset`, { preset_id: confession.id });
  assert.equal(applied.data.spec.lens.focal_mm, 85);
  assert.equal(applied.data.spec.intent.summary, 'Mira reads the letter by the window', 'preset never overwrites story content');
});

test('M3: reference analysis segments a two-shot clip and plans a recreation', async () => {
  const tf = (await api('GET', '/api/transforms')).data;
  for (const [k, v] of Object.entries(tf)) assert.ok(['katana', 'genjutsu'].includes(v.studio), `${k} belongs to OG Katana or OG Genjutsu`);
  assert.deepEqual(Object.keys(tf).filter((k) => tf[k].studio === 'genjutsu').sort(), ['character_swap', 'motion_transfer', 'object_swap', 'selective_change']);
  const up = await upload(projectId, fixtures.video);
  const an = await api('POST', `/api/assets/${up.data.asset.id}/analyze`, {});
  assert.equal(an.status, 201, JSON.stringify(an.data));
  assert.equal(an.data.segments.length, 2, `segments: ${JSON.stringify(an.data.segments)}`);
  assert.ok(Math.abs(an.data.segments[0].end_s - 3) < 0.1);
  const tr = await api('POST', `/api/projects/${projectId}/transform`, { type: 'recreate', source_asset_id: up.data.asset.id, analysis_id: an.data.id, brief: 'with Mira', ref_handles: ['@mira'] });
  assert.equal(tr.status, 201, JSON.stringify(tr.data));
  assert.equal(tr.data.shots.length, 2);
  assert.equal(tr.data.shots[0].spec.references[0].role, 'reference_image');
  const ed = await api('POST', `/api/projects/${projectId}/transform`, { type: 'object_swap', source_asset_id: up.data.asset.id, target: 'the test card', replacement: 'a red coat' });
  assert.equal(ed.data.shots[0].spec.workflow, 'edit');
  const plan = await api('POST', `/api/shots/${ed.data.shots[0].id}/plan`, { provider: 'seedance' });
  assert.ok(plan.data.errors.some((e) => e.includes('hosted')), `Seedance edit needs a hosted source URL — surfaced, not hidden. Got: ${JSON.stringify(plan.data.errors)}`);
});

test('M4: QC report separates measured and manual checks; version compare', async () => {
  const qc = await api('POST', `/api/assets/${mockJob.output_asset_id}/qc`);
  assert.equal(qc.status, 201, JSON.stringify(qc.data));
  const checks = qc.data.measured.map((m) => m.check);
  for (const c of ['duration', 'flicker (luma)', 'unintended cuts', 'audio track']) assert.ok(checks.includes(c), `missing ${c}`);
  assert.ok(qc.data.manual.length >= 3);
  const cmp = await api('POST', '/api/compare', { a: mockJob.output_asset_id, b: mockJob.output_asset_id });
  assert.ok(cmp.data.ssim > 0.99);
});

test('M5: export selected takes as EDL / FCPXML / OTIO', async () => {
  for (const fmt of ['edl', 'fcpxml', 'otio']) {
    const r = await api('GET', `/api/projects/${projectId}/export/${fmt}`);
    assert.equal(r.status, 200, `${fmt}: ${r.data}`);
    assert.ok(r.data.length > 100);
  }
});

test('security: foreign Host and cross-origin writes refused', async () => {
  const r1 = await new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port: new URL(base).port, path: '/api/projects', headers: { Host: 'evil.example' } }, (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject));
  assert.equal(r1, 403, 'DNS-rebinding style Host header refused');
  const r2 = await fetch(`${base}/api/projects`, { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{"name":"x"}' });
  assert.equal(r2.status, 403);
  const del = await api('DELETE', `/api/projects/${projectId}`);
  assert.equal(del.status, 400, 'project delete needs typed confirmation');
});

test('extended: frame extraction, continuity chaining, revisions keep old takes', async () => {
  const fr = await api('POST', `/api/assets/${mockJob.output_asset_id}/extract-frame`, { at: 'last' });
  assert.equal(fr.status, 201, JSON.stringify(fr.data));
  assert.equal(fr.data.kind, 'image');
  assert.equal(fr.data.meta.derived_from, mockJob.output_asset_id);
  // Mock output has no provider last frame -> chaining refuses with a clear message.
  const sc2 = (await api('POST', `/api/projects/${projectId}/scenes`, { heading: 'CHAIN TEST' })).data;
  const a = (await api('POST', `/api/scenes/${sc2.id}/shots`, { title: 'A', spec: { intent: { summary: 'first' }, duration_s: 4 } })).data;
  const b = (await api('POST', `/api/scenes/${sc2.id}/shots`, { title: 'B', spec: { intent: { summary: 'second' }, duration_s: 4, subjects: [{ ref: '@mira' }] } })).data;
  const ja = await api('POST', `/api/shots/${a.id}/generate`, { provider: 'mock' });
  await waitJob(ja.data.job.id);
  const refused = await api('POST', `/api/shots/${b.id}/chain-from-previous`);
  assert.equal(refused.status, 409);
  assert.match(refused.data.error, /no last-frame image/);
  // The Seedance take (stub) saved a last frame -> chaining the next shot in that scene works.
  const c = (await api('POST', `/api/scenes/${sceneId}/shots`, { title: 'After i2v', spec: { intent: { summary: 'continues' }, duration_s: 5, references: [{ role: 'reference_image', asset_id: imageId }] } })).data;
  const ch = await api('POST', `/api/shots/${c.id}/chain-from-previous`);
  assert.equal(ch.status, 200, JSON.stringify(ch.data));
  const refs = ch.data.shot.spec.references;
  assert.equal(refs.length, 1, 'reference inputs removed (first-frame and reference modes cannot mix)');
  assert.equal(refs[0].role, 'first_frame');
  // Revision: new job with parent, old take stays selected.
  const rev = await api('POST', `/api/shots/${shotId}/revise`, { provider: 'mock', note: 'slower', changes: { intent: { action: 'she lowers the letter slowly' } } });
  assert.equal(rev.status, 201, JSON.stringify(rev.data));
  assert.equal(rev.data.previous_job_id, mockJob.id);
  assert.equal((await waitJob(rev.data.job.id)).status, 'succeeded');
  const shot = (await api('GET', `/api/shots/${shotId}`)).data;
  assert.ok(shot.jobs.length >= 2, 'previous takes kept');
  assert.equal(shot.selected_job_id, mockJob.id, 'revision does not replace the selected take');
  assert.equal(shot.jobs.find((j) => j.id === rev.data.job.id).parent_job_id, mockJob.id);
});

test('extended: batch approval needs the exact total; rejecting sends nothing', async () => {
  const posts = () => seedanceCalls.filter((c) => c.method === 'POST').length;
  const before = posts();
  const ids = [];
  for (const s of ['batch one', 'batch two']) {
    const sh = (await api('POST', `/api/scenes/${sceneId}/shots`, { title: s, spec: { intent: { summary: s }, duration_s: 4, resolution: '480p' } })).data;
    const g = await api('POST', `/api/shots/${sh.id}/generate`, { provider: 'seedance' });
    assert.equal(g.data.job.status, 'awaiting_approval');
    ids.push(g.data.job.id);
  }
  const wrong = await api('POST', '/api/jobs/approve-batch', { job_ids: ids, confirm_usd_total: 0.01 });
  assert.equal(wrong.status, 400);
  for (const id of ids) assert.equal((await api('POST', `/api/jobs/${id}/reject`)).data.status, 'rejected');
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(posts(), before, 'no provider calls for rejected jobs');
});

test('extended: presets, references, asset rules, cancel, project delete', async () => {
  const pr = await api('POST', '/api/presets', { name: 'My CU', kind: 'shot', data: { intent: { summary: 'story text' }, framing: { shot_size: 'CU' } } });
  assert.equal(pr.status, 201);
  assert.equal(pr.data.data.intent, undefined, 'presets never store story content');
  assert.equal((await api('DELETE', `/api/presets/${pr.data.id}`)).status, 200);
  const builtin = (await api('GET', '/api/presets')).data.find((p) => p.builtin);
  assert.equal((await api('DELETE', `/api/presets/${builtin.id}`)).status, 409);

  const refs = (await api('GET', `/api/projects/${projectId}/refs`)).data;
  const mira = refs.find((r) => r.handle === '@mira');
  assert.equal((await api('PATCH', `/api/refs/${mira.id}`, { description: 'woman, 30s, red wool coat' })).data.description, 'woman, 30s, red wool coat');
  const tmp = (await api('POST', `/api/projects/${projectId}/refs`, { type: 'prop', name: 'Letter' })).data;
  assert.equal((await api('POST', `/api/projects/${projectId}/refs`, { type: 'prop', name: 'Letter' })).status, 409, 'duplicate handle refused');
  assert.equal((await api('DELETE', `/api/refs/${tmp.id}`)).status, 200);

  assert.equal((await api('PATCH', `/api/assets/${imageId}`, { remote_url: 'http://insecure.example/x.png' })).status, 400);
  assert.equal((await api('PATCH', `/api/assets/${imageId}`, { remote_url: 'asset://abc123' })).data.meta.remote_url, 'asset://abc123');
  await api('PATCH', `/api/assets/${imageId}`, { remote_url: '' });
  assert.equal((await api('DELETE', `/api/assets/${imageId}`)).status, 409, 'asset used by a reference cannot be deleted');

  const slow = (await api('POST', `/api/scenes/${sceneId}/shots`, { title: 'slow', spec: { intent: { summary: 'slow one [mock:slow]' }, duration_s: 4 } })).data;
  const sj = (await api('POST', `/api/shots/${slow.id}/generate`, { provider: 'mock' })).data.job;
  await waitJob(sj.id, ['running']);
  assert.equal((await api('POST', `/api/jobs/${sj.id}/cancel`)).data.status, 'cancelled');

  const throwaway = (await api('POST', '/api/projects', { name: 'Throwaway' })).data;
  assert.equal((await api('DELETE', `/api/projects/${throwaway.id}?confirm=wrong`)).status, 400);
  assert.equal((await api('DELETE', `/api/projects/${throwaway.id}?confirm=Throwaway`)).status, 200);
  assert.equal((await api('GET', `/api/projects/${throwaway.id}`)).status, 404);
});

test('regression: still-image uploads get a thumbnail (ffmpeg 8 -ss 0 bug)', async () => {
  const a = (await api('GET', `/api/assets/${imageId}`)).data;
  assert.ok(a.meta.thumb, 'thumb path recorded');
  const t = await fetch(`${base}/api/assets/${imageId}/thumb`);
  assert.equal(t.status, 200, 'thumbnail file exists and is served');
  const frame = await api('POST', `/api/assets/${mockJob.output_asset_id}/extract-frame`, { at: 0 });
  assert.equal((await fetch(`${base}/api/assets/${frame.data.id}/thumb`)).status, 200);
});

test('OG Katana: beat analysis, recreation, conform to reference timing + soundtrack, recipes', async () => {
  // 6 s reference: two shots (cut at 3.0 s, on the beat) over a 120 BPM click soundtrack.
  const ref = path.join(tmp, 'katana_ref.mp4');
  await tool('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24:duration=3', '-f', 'lavfi', '-i', 'smptebars=size=640x360:rate=24:duration=3',
    '-f', 'lavfi', '-i', "aevalsrc='if(lt(mod(t,0.5),0.012),0.8*sin(2*PI*2000*t),0)':s=44100:d=6",
    '-filter_complex', '[0:v][1:v]concat=n=2:v=1[v]', '-map', '[v]', '-map', '2:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', f(ref)]);
  const up = await upload(projectId, ref);
  const an = (await api('POST', `/api/assets/${up.data.asset.id}/analyze`, {})).data;
  assert.equal(an.segments.length, 2);
  assert.ok(Math.abs(an.soundtrack.bpm - 120) <= 2, `bpm ${an.soundtrack?.bpm}`);
  assert.equal(an.cut_alignment.total, 1);
  assert.equal(an.cut_alignment.on_beat, 1, `cut offset ${an.cut_alignment.cuts[0]?.offset_ms} ms`);

  const tr = (await api('POST', `/api/projects/${projectId}/transform`, { type: 'recreate', source_asset_id: up.data.asset.id, analysis_id: an.id, brief: 'with Mira', ref_handles: ['@mira'] })).data;
  assert.equal(tr.shots.length, 2);
  // Conform with no takes yet: black slates keep the timing.
  const empty = await api('POST', `/api/scenes/${tr.scene_id}/conform`);
  assert.equal(empty.status, 201, JSON.stringify(empty.data));
  assert.ok(empty.data.report.every((r) => r.status.startsWith('black slate')));
  for (const s of tr.shots) {
    const g = (await api('POST', `/api/shots/${s.id}/generate`, { provider: 'mock' })).data;
    assert.equal((await waitJob(g.job.id)).status, 'succeeded');
  }
  const conf = await api('POST', `/api/scenes/${tr.scene_id}/conform`);
  assert.equal(conf.status, 201, JSON.stringify(conf.data));
  assert.deepEqual(conf.data.report.map((r) => r.status), ['trimmed', 'trimmed'], '4 s takes trimmed to the 3 s reference shots');
  const a = conf.data.asset;
  assert.ok(Math.abs(a.meta.duration_s - 6) < 0.15, `conformed length ${a.meta.duration_s}`);
  assert.equal(a.meta.video.width, 640);
  assert.equal(a.meta.video.fps, 24);
  assert.ok(a.meta.audio, 'reference soundtrack laid under the conform');
  assert.equal(a.origin, 'derived');

  const rec = await api('POST', `/api/analyses/${an.id}/recipe`, { name: 'Two-beat test spot' });
  assert.equal(rec.status, 201);
  assert.equal(rec.data.kind, 'recipe');
  assert.equal(rec.data.data.bpm, an.soundtrack.bpm);
  const applied = await api('POST', `/api/projects/${projectId}/recipes/${rec.data.id}/apply`, { brief: 'product version', ref_handles: ['@mira'] });
  assert.equal(applied.status, 201, JSON.stringify(applied.data));
  assert.equal(applied.data.shots.length, 2);
  assert.equal(applied.data.shots[0].spec.references[0].role, 'reference_image');
  assert.equal(applied.data.shots[0].spec.transform.segment.duration_s, an.segments[0].duration_s, 'recipe keeps the reference timing');
});

test('post tools: reframe (crop / pad / blur) and resample upscale make new files', async () => {
  const src = (await api('GET', `/api/assets/${mockJob.output_asset_id}`)).data;
  const W = src.meta.video.width, H = src.meta.video.height;
  for (const mode of ['crop', 'pad', 'blur']) {
    const r = await api('POST', `/api/assets/${src.id}/reframe`, { aspect: '9:16', mode, position: 0.3 });
    assert.equal(r.status, 201, `${mode}: ${JSON.stringify(r.data)}`);
    const v = r.data.asset.meta.video;
    assert.ok(Math.abs(v.width / v.height - 9 / 16) < 0.02, `${mode} → ${v.width}×${v.height}`);
    if (mode === 'crop') assert.equal(v.height, H, 'crop keeps full height for a vertical reframe');
    else assert.equal(v.width, W, 'pad/blur keep the whole picture');
    assert.equal(r.data.asset.origin, 'derived');
  }
  const up = await api('POST', `/api/assets/${src.id}/upscale`, { target: '1080p' });
  assert.equal(up.status, 201, JSON.stringify(up.data));
  assert.equal(Math.min(up.data.asset.meta.video.width, up.data.asset.meta.video.height), 1080);
  assert.match(up.data.method, /not AI super-resolution/);
  const big = up.data.asset.id;
  assert.equal((await api('POST', `/api/assets/${big}/upscale`, { target: '1080p' })).status, 409, 'no fake "upscale" to the same size');
  assert.equal((await api('GET', `/api/assets/${src.id}`)).data.sha256, src.sha256, 'source untouched');
});

test('Blender previz: frame-sequence import, camera path → moves + lens, previz → shot', async () => {
  const dir = path.join(tmp, 'previz_render');
  fs.mkdirSync(dir);
  await tool('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=24:duration=1', f(path.join(dir, 'frame_%04d.png'))]);
  // camera.json: a push-in (camera moves +Y while looking down +Y), 40 mm lens.
  const R = Math.PI / 2;
  fs.writeFileSync(path.join(dir, 'camera.json'), JSON.stringify({ fps: 24, frames: Array.from({ length: 24 }, (_, i) => ({ frame: i + 1, location: [0, -10 + (3 * i) / 23, 1.6], rotation_euler: [R, 0, 0], lens_mm: 40 })) }));
  assert.equal((await api('POST', `/api/projects/${projectId}/previz/import`, { path: path.join(tmp, 'nope') })).status, 400);
  const imp = await api('POST', `/api/projects/${projectId}/previz/import`, { path: dir, fps: 24, name: 'kitchen previz' });
  assert.equal(imp.status, 201, JSON.stringify(imp.data));
  assert.deepEqual(imp.data.camera.moves, ['push_in']);
  assert.equal(imp.data.camera.focal_mm, 40);
  assert.ok(Math.abs(imp.data.asset.meta.duration_s - 1) < 0.1);
  assert.deepEqual(imp.data.asset.tags, ['previz']);
  assert.equal(fs.readdirSync(dir).length, 25, 'render folder untouched (24 frames + camera.json)');

  const motion = await api('POST', `/api/assets/${imp.data.asset.id}/previz-shot`, { mode: 'motion', brief: 'Mira walks into the kitchen at night' });
  assert.equal(motion.status, 201, JSON.stringify(motion.data));
  const ms = motion.data.shot.spec;
  assert.deepEqual(ms.camera.moves, ['push_in']);
  assert.equal(ms.lens.focal_mm, 40);
  assert.equal(ms.references[0].role, 'reference_video');
  assert.deepEqual((await api('POST', `/api/shots/${motion.data.shot.id}/plan`, { provider: 'mock' })).data.errors, []);
  const still = await api('POST', `/api/assets/${imp.data.asset.id}/previz-shot`, { mode: 'first_frame', scene_id: motion.data.scene_id });
  assert.equal(still.data.shot.spec.references[0].role, 'first_frame');
  assert.equal(still.data.scene_id, motion.data.scene_id);
  const plan = (await api('POST', `/api/shots/${still.data.shot.id}/plan`, { provider: 'mock' })).data;
  assert.equal(plan.workflow, 'image_to_video');
});

test('pre-send checks surface in the plan: unknown @handle blocks, contradictions warn', async () => {
  const sh = (await api('POST', `/api/scenes/${sceneId}/shots`, { title: 'checks', spec: { intent: { summary: '@mira meets @ghost in bright sunlight' }, duration_s: 4, lighting: { time_of_day: 'night' } } })).data;
  const pl = (await api('POST', `/api/shots/${sh.id}/plan`, { provider: 'mock' })).data;
  assert.ok(pl.errors.some((e) => e.includes('@ghost is not in Reference Studio')));
  assert.ok(pl.warnings.some((w) => w.includes('Night but the description mentions daylight')));
  assert.equal((await api('POST', `/api/shots/${sh.id}/generate`, { provider: 'mock' })).status, 422, 'blocked before anything is queued');
});
