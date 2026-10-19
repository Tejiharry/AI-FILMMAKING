import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultSpec, resolveSpec, validateSpec, deepMerge } from '../../server/engine/shotspec.js';
import { compileShot } from '../../server/engine/compiler.js';
import { breakdown, parseScreenplay } from '../../server/engine/director.js';
import { encrypt, decrypt, redact } from '../../server/secrets.js';
import { createSeedanceProvider, SEEDANCE_25, nearestAspect } from '../../server/providers/seedance.js';
import { edl, fcpxml, otio } from '../../server/engine/exports.js';
import crypto from 'node:crypto';

const seedCaps = createSeedanceProvider({ getCredentials: () => ({ api_key: 'test-key-123456' }) }).caps(SEEDANCE_25);

test('inheritance: shot overrides scene overrides project; blanks inherit', () => {
  const eff = resolveSpec(
    { shot_defaults: { look: { genre: 'drama', palette: ['#112233'] }, aspect: '21:9' } },
    { shot_defaults: { lighting: { time_of_day: 'night' } } },
    { lighting: { key_direction: 'side_left', time_of_day: '' }, intent: { summary: 'x' } });
  assert.equal(eff.aspect, '21:9');
  assert.equal(eff.look.genre, 'drama');
  assert.equal(eff.lighting.time_of_day, 'night', 'blank shot value must inherit scene value');
  assert.equal(eff.lighting.key_direction, 'side_left');
});

test('validation catches bad enums, refs and non-contiguous timeline', () => {
  const s = deepMerge(defaultSpec(), { intent: { summary: 'a' }, framing: { shot_size: 'HUGE' }, duration_s: 6,
    references: [{ role: 'last_frame', asset_id: 'x' }], timeline: [{ start_s: 0, end_s: 2, action: 'a' }, { start_s: 3, end_s: 6, action: 'b' }] });
  const v = validateSpec(s);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes('shot_size')));
  assert.ok(v.errors.some((e) => e.includes('last_frame requires a first_frame')));
  assert.ok(v.errors.some((e) => e.includes('starts at 3s')));
});

test('compiler: native params vs best-effort prompt are reported honestly', () => {
  const spec = deepMerge(defaultSpec(), {
    intent: { summary: 'Mira reads the letter', emotion: 'quiet dread' }, duration_s: 6, resolution: '1080p', seed: 42,
    framing: { shot_size: 'CU', angle: 'low' }, camera: { movement: 'push_in', speed: 'slow', rig: 'dolly' },
    lens: { focal_mm: 85, aperture: 1.8, dof: 'very_shallow' }, lighting: { key_direction: 'rembrandt', color_temp_k: 3200 },
    subjects: [{ ref: '@mira', wardrobe: 'red coat' }], look: { palette: ['#AA3322'] },
  });
  const refs = { '@mira': { name: 'Mira', description: 'woman, 30s', assets: [{ id: 'img1', kind: 'image' }] } };
  const out = compileShot(spec, { refsByHandle: refs, caps: seedCaps, assetsById: {} });
  assert.equal(out.params.duration_s, 6);
  assert.equal(out.params.resolution, '1080p');
  assert.equal(out.params.seed, undefined, 'seed is not documented for Seedance 2.5 and must not be sent');
  assert.equal(out.report.find((r) => r.field === 'seed').delivered_as, 'unsupported');
  assert.equal(out.report.find((r) => r.field === 'camera').guaranteed, false);
  assert.match(out.prompt, /^Close-up, .*low-angle/);
  assert.doesNotMatch(out.prompt, /slow dolly push-in toward the subject, slow/);
  assert.match(out.prompt, /85mm/);
  assert.match(out.prompt, /@mira \(Mira: woman, 30s\), wearing red coat/);
  assert.deepEqual(out.inputs.map((i) => [i.asset_id, i.role]), [['img1', 'reference_image']], 'subject library image auto-attached');
});

test('tripod + dolly move: rig phrase dropped, not contradicted', () => {
  const spec = deepMerge(defaultSpec(), { intent: { summary: 'x' }, camera: { movement: 'push_in', rig: 'tripod' } });
  const out = compileShot(spec, { caps: seedCaps });
  assert.doesNotMatch(out.prompt, /on a tripod/);
  assert.ok(validateSpec(spec).warnings.some((w) => w.includes('tripod')));
});

test('Seedance estimate matches the documented example (720p 16:9 5 s ≈ $1.156)', () => {
  const p = createSeedanceProvider({ getCredentials: () => ({ api_key: 'k' }) });
  const e = p.estimate(SEEDANCE_25, { workflow: 'generate', params: { duration_s: 5, resolution: '720p', aspect: '16:9' }, inputs: [] });
  assert.equal(e.tokens, 108000);
  assert.ok(Math.abs(e.usd - 1.1556) < 0.0005, `got ${e.usd}`);
  const e2 = p.estimate(SEEDANCE_25, { workflow: 'generate', params: { duration_s: 5, resolution: '1080p', aspect: '16:9' }, inputs: [] });
  assert.ok(Math.abs(e2.usd - 2.843) < 0.005, `got ${e2.usd}`);
});

test('Seedance wire format: documented fields only, adaptive ratio for first-frame, @Image tokens', () => {
  const p = createSeedanceProvider({ getCredentials: () => ({ api_key: 'k' }) });
  const req = { workflow: 'image_to_video', prompt: 'She turns @Image1', params: { duration_s: 8, resolution: '720p', aspect: '16:9', generate_audio: true },
    inputs: [{ kind: 'image', role: 'first_frame', label: 'f.png', asset: { meta: { remote_url: 'https://example.com/f.png' } } }] };
  const w = p.toWire(SEEDANCE_25, req);
  assert.equal(w.model, SEEDANCE_25);
  assert.equal(w.ratio, 'adaptive');
  assert.equal(w.duration, 8);
  assert.deepEqual(w.content[1], { type: 'image_url', image_url: { url: 'https://example.com/f.png' }, role: 'first_frame' });
  for (const banned of ['seed', 'camera_fixed', 'frames', 'service_tier']) assert.equal(w[banned], undefined, `${banned} must not be sent`);
  const edit = p.toWire(SEEDANCE_25, { workflow: 'edit', prompt: 'Edit the video', params: { duration_s: 8, aspect: '16:9' },
    inputs: [{ kind: 'video', role: 'reference_video', label: 'v', asset: { meta: { remote_url: 'asset://abc' } } }] });
  assert.equal(edit.duration, -1);
  assert.equal(edit.omni_reference_task_type, 'edit');
  assert.equal(p.refToken({ kind: 'video' }, 0), '@Video1');
});

test('Seedance validation: frames+refs exclusive, real-face refs refused, video needs hosted URL', () => {
  const p = createSeedanceProvider({ getCredentials: () => ({ api_key: 'k' }) });
  const v = p.validate(SEEDANCE_25, { workflow: 'image_to_video', prompt: 'x', params: { duration_s: 5 },
    inputs: [
      { kind: 'image', role: 'first_frame', label: 'a', asset: { mime: 'image/png', bytes: 1000, meta: { image: { width: 1280, height: 720 } }, rights: {} } },
      { kind: 'image', role: 'reference_image', label: 'face', asset: { mime: 'image/png', bytes: 1000, meta: { image: { width: 800, height: 800 } }, rights: { depicts_real_person: true } } },
      { kind: 'video', role: 'reference_video', label: 'clip', asset: { mime: 'video/mp4', bytes: 1000, meta: { duration_s: 5 }, rights: {} } },
    ] });
  assert.ok(v.errors.some((e) => e.includes('cannot be combined')));
  assert.ok(v.errors.some((e) => e.includes('real-face')));
  assert.ok(v.errors.some((e) => e.includes('hosted')));
});

test('vault encryption round-trips and redaction scrubs keys', () => {
  const key = crypto.randomBytes(32);
  const blob = encrypt(key, 'sk-very-secret-value');
  assert.ok(!blob.includes('sk-very-secret'));
  assert.equal(decrypt(key, blob), 'sk-very-secret-value');
  assert.throws(() => decrypt(crypto.randomBytes(32), blob));
  assert.equal(redact('Authorization: Bearer abcdefghijk123 and sk-very-secret-value', ['sk-very-secret-value']), 'Authorization: Bearer [REDACTED] and [REDACTED]');
});

const SCRIPT = `INT. KITCHEN - NIGHT

Mira enters, holding a letter. She stares at it.

MIRA
You knew about this?

DEV
(quietly)
I was going to tell you.

MIRA
Tell me what?! That you lied for a year?

EXT. ROOFTOP - DAWN

Dev walks to the edge, alone.`;

test('director: parses screenplay and builds coverage', () => {
  const scenes = parseScreenplay(SCRIPT);
  assert.equal(scenes.length, 2);
  assert.equal(scenes[0].location, 'KITCHEN');
  assert.equal(scenes[0].time, 'NIGHT');
  const b = breakdown(SCRIPT);
  assert.deepEqual(b.characters.map((c) => c.handle), ['@mira', '@dev']);
  const titles = b.scenes[0].shots.map((s) => s.title);
  assert.ok(titles[0].startsWith('Establish'));
  assert.ok(titles.some((t) => t.startsWith('Insert — letter')));
  assert.ok(titles.some((t) => t.startsWith('Two-shot')));
  assert.ok(titles.some((t) => t === 'DEV — reaction'), 'heightened line gets listener reaction');
  for (const s of b.scenes.flatMap((x) => x.shots)) {
    const v = validateSpec(deepMerge(defaultSpec(), s.spec));
    assert.ok(v.ok, `${s.title}: ${v.errors.join('; ')}`);
  }
  assert.equal(b.scenes[1].shots[0].spec.lighting.time_of_day, 'dawn');
});

test('exports: EDL timecodes, FCPXML and OTIO are well formed', () => {
  const items = [{ file: 'C:\\x\\a.mp4', duration_s: 5, shot_title: 'A', has_audio: true }, { file: 'C:\\x\\b.mp4', duration_s: 4, shot_title: 'B' }];
  const e = edl('Test', items, 24);
  assert.match(e, /001 {2}AX {7}V {5}C {8}00:00:00:00 00:00:05:00 01:00:00:00 01:00:05:00/);
  assert.match(e, /002 {2}AX {7}V {5}C {8}00:00:00:00 00:00:04:00 01:00:05:00 01:00:09:00/);
  const x = fcpxml('Test', items, { fps: 24 });
  assert.match(x, /<fcpxml version="1.10">/);
  assert.match(x, /offset="12000\/2400s"/);
  const o = JSON.parse(otio('Test', items, 24));
  assert.equal(o.tracks.children[0].children.length, 2);
  assert.equal(nearestAspect(1.78), '16:9');
});

test('camera move stack compiles in order and validates', () => {
  const spec = deepMerge(defaultSpec(), { intent: { summary: 'x' }, camera: { movement: 'push_in', moves: ['push_in', 'orbit', 'crane_down'], speed: 'slow', rig: 'dolly' } });
  const out = compileShot(spec, { caps: seedCaps });
  assert.match(out.prompt, /Camera: first dolly push-in toward the subject, then camera arcs around the subject, then camera cranes down, slow/);
  assert.ok(validateSpec(spec).ok);
  const bad = deepMerge(defaultSpec(), { intent: { summary: 'x' }, camera: { moves: ['push_in', 'teleport'] } });
  assert.ok(validateSpec(bad).errors.some((e) => e.includes('teleport')));
  const single = compileShot(deepMerge(defaultSpec(), { intent: { summary: 'x' }, camera: { movement: 'pan_left', moves: ['pan_left'] } }), { caps: seedCaps });
  assert.match(single.prompt, /Camera: camera pans left on a fixed axis/);
});
