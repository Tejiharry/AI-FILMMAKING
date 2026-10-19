// Local H3 adapter against a fake ComfyUI API (no GPU, no real engine).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createComfyH3Provider, H3_MODEL, SWAP_LORAS } from '../../server/providers/comfy-h3.js';
import { tool, f, probe } from '../../server/media.js';

let tmp, src30, srcOut, img, calls = [], queued = null;
const TEMPLATE = {
  92: { class_type: 'SaveVideo', inputs: { filename_prefix: 'x' } },
  115: { class_type: 'ResolutionSelector', inputs: { aspect_ratio: '16:9 (Widescreen)', megapixels: 0.4 } },
  129: { class_type: 'RandomNoise', inputs: { noise_seed: 1 } },
  132: { class_type: 'PrimitiveFloat', inputs: { value: 5 } },
  137: { class_type: 'LoadImage', inputs: { image: 'x.png' } },
  138: { class_type: 'PrimitiveStringMultiline', inputs: { value: '' } },
  139: { class_type: 'LoadVideo', inputs: { file: 'x.mp4' } },
  147: { class_type: 'LoraLoaderModelOnly', inputs: { lora_name: 'x', strength_model: 1 } },
};

function fakeComfy() {
  let polls = 0;
  return async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ path: u.pathname, method: init.method ?? 'GET', body: init.body });
    const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });
    if (u.pathname === '/upload/image') { const fd = init.body; return json({ name: fd.get('image').name ?? 'up', subfolder: '', type: 'input' }); }
    if (u.pathname === '/prompt') { queued = JSON.parse(init.body); return json({ prompt_id: 'p-1', number: 1, node_errors: {} }); }
    if (u.pathname === '/history/p-1') {
      if (++polls < 2) return json({});
      return json({ 'p-1': { status: { status_str: 'success', completed: true }, outputs: { 92: { images: [{ filename: 'h3_swap_00001.mp4', subfolder: 'studio', type: 'output' }] } } } });
    }
    if (u.pathname === '/queue') return json({ queue_running: [[0, 'p-1']], queue_pending: [] });
    if (u.pathname === '/view') return new Response(fs.readFileSync(srcOut), { status: 200 });
    if (u.pathname === '/system_stats') return json({ system: { comfyui_version: '0.41.0' }, devices: [{ name: 'cuda:0 NVIDIA GeForce RTX 5080', vram_total: 16 * 2 ** 30, vram_free: 15 * 2 ** 30 }] });
    return json({ error: 'nf' }, 404);
  };
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'h3-'));
  fs.mkdirSync(path.join(tmp, 'cfg'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'cfg', 'h3-swap-v1.api.json'), JSON.stringify(TEMPLATE));
  src30 = path.join(tmp, 'src30.mp4'); srcOut = path.join(tmp, 'engine_out.mp4'); img = path.join(tmp, 'char.png');
  // 30 fps source WITH audio (must be conformed to 24 fps; soundtrack must survive).
  await tool('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=4',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', f(src30)]);
  // Engine output: silent 24 fps clip (H3 output audio is replaced by the source soundtrack).
  await tool('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'smptebars=size=640x360:rate=24:duration=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', f(srcOut)]);
  await tool('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=512x512:rate=1', '-frames:v', '1', f(img)]);
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const req = async () => ({
  workflow: 'edit', prompt: 'Replace only the man in <Video 1> with <Picture 1>.', params: { duration_s: 4, aspect: 'adaptive', resolution: '720p', seed: 7 },
  inputs: [
    { kind: 'video', role: 'reference_video', label: 'src30.mp4', asset: { path: src30, mime: 'video/mp4', meta: await probe(src30), rights: { rights_confirmed: true } } },
    { kind: 'image', role: 'reference_image', label: 'char.png', asset: { path: img, mime: 'image/png', meta: {}, rights: { rights_confirmed: true } } },
  ],
});

test('local H3: validate, build graph, conform fps, poll, download with source audio restored', async () => {
  const p = createComfyH3Provider({ getSettings: () => ({ engine_dir: tmp, lora: 'v1' }), fetchImpl: fakeComfy(), workDir: tmp, configDir: path.join(tmp, 'cfg') });
  assert.equal(p.billable, false);
  assert.equal(p.attribution, 'MiniMax H3', 'licence: product must display "MiniMax H3"');
  const r = await req();
  const v = p.validate(H3_MODEL, r);
  assert.deepEqual(v.errors, []);
  assert.ok(v.warnings.some((w) => w.includes('30 fps')), 'non-24fps source flagged');

  const { task_id } = await p.submit(H3_MODEL, r);
  assert.equal(calls.filter((c) => c.path === '/upload/image').length, 2, 'source + character uploaded');
  assert.equal(queued.prompt['147'].inputs.lora_name, SWAP_LORAS.v1);
  assert.equal(queued.prompt['138'].inputs.value, r.prompt);
  assert.equal(queued.prompt['132'].inputs.value, 4);
  assert.equal(queued.prompt['129'].inputs.noise_seed, 7);
  assert.equal(queued.prompt['115'].inputs.megapixels, 0.98);
  assert.equal(queued.prompt['115'].inputs.aspect_ratio, '16:9 (Widescreen)', 'adaptive → nearest aspect of the source');
  assert.match(queued.prompt['139'].inputs.file, /^studio_src_/);

  assert.equal((await p.poll(task_id)).status, 'running');
  const done = await p.poll(task_id);
  assert.equal(done.status, 'succeeded');
  const dest = path.join(tmp, 'final.mp4');
  await p.download(done.result, dest);
  const out = await probe(dest);
  assert.ok(out.audio, 'source soundtrack muxed back onto the swap');
  assert.equal(out.video.width, 640);
  assert.equal(fs.readdirSync(tmp).filter((x) => x.startsWith('h3src_')).length, 0, 'temporary 24 fps conform cleaned up');
});

test('local H3: refuses real-person media without consent, wrong input counts, missing engine', async () => {
  const p = createComfyH3Provider({ getSettings: () => ({ engine_dir: tmp }), fetchImpl: fakeComfy(), workDir: tmp, configDir: path.join(tmp, 'cfg') });
  const r = await req();
  r.inputs[1].asset.rights.depicts_real_person = true;
  assert.ok(p.validate(H3_MODEL, r).errors.some((e) => e.includes('likeness consent')));
  r.inputs.pop();
  assert.ok(p.validate(H3_MODEL, r).errors.some((e) => e.includes('<Picture 1>')));
  const missing = createComfyH3Provider({ getSettings: () => ({ engine_dir: tmp }), fetchImpl: fakeComfy(), configDir: path.join(tmp, 'nope') });
  assert.ok(missing.validate(H3_MODEL, await req()).errors.some((e) => e.includes('template missing')));
  const t = await p.testConnection();
  assert.equal(t.ok, true);
  assert.match(t.detail, /RTX 5080/);
});
