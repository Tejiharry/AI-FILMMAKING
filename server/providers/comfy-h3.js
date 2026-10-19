// Local MiniMax H3 Ref2VA character swap, executed by a hidden ComfyUI engine.
// The studio talks to ComfyUI's local HTTP API only (upload → /prompt → /history → /view).
// The graph is Akatz Labs' "H3 Character Swap v1 Ref2VA" workflow (core ComfyUI nodes only),
// exported to API format by ComfyUI's own frontend and stored in the studio's data/engine folder — it is
// loaded at runtime, not bundled here.
//
// MiniMax H3 is licensed under the MiniMax H3 Community License Agreement,
// Copyright © 2026 MiniMax. All Rights Reserved.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { ProviderError, validateAgainstCaps } from './base.js';
import { tool, f, probe } from '../media.js';

export const H3_MODEL = 'minimax-h3-ref2va-character-swap';

// Node ids in the exported v1 graph (stable: they come from the workflow file).
const N = { saveVideo: '92', resolution: '115', unet: '127', clip: '128', noise: '129', duration: '132',
  refToVideo: '136', charImage: '137', prompt: '138', turbo: '146', swapLora: '147', sourceVideo: '139', scheduler: '124', steps: '143' };

export const SWAP_LORAS = {
  v1: 'h3_character_swap_pro4500_1000.safetensors',     // tested with this graph (default)
  'v1.5': 'h3_character_swap_v1.5.safetensors',         // author-tested only in Relay V2; experimental here
};

const CAPS = {
  native_params: ['duration_s', 'aspect', 'resolution', 'seed'], // resolution → ResolutionSelector megapixels; seed → RandomNoise
  workflows: ['edit'],
  durations: { min: 2, max: 15 },
  resolutions: ['480p', '720p', '768p'],
  aspects: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'],
  max_refs: { image: 1, video: 1, audio: 0 },
  frames_exclusive_with_refs: false,
  audio: false,
  notes: [
    'local GPU, no API cost; one job at a time on the GPU',
    'character swap: <Video 1> = source performance (2–15 s, converted to 24 fps), <Picture 1> = replacement character',
    'regenerated footage — not a pixel-preserving mask; identity/expression/timing can drift (experimental LoRA)',
    'original soundtrack is muxed back onto the result (video stream not re-encoded)',
    'H3 frame grid is 17n+5 at 24 fps: 5 s becomes 124 frames (5.17 s)',
    'dialogue languages: 11 documented (no Punjabi) — irrelevant for swaps since source audio is kept',
  ],
};

// Aspect labels used by the workflow's ResolutionSelector node.
// Exact COMBO options read from ComfyUI 0.41.0 /object_info/ResolutionSelector.
const ASPECT_LABEL = { '16:9': '16:9 (Widescreen)', '9:16': '9:16 (Portrait Widescreen)', '1:1': '1:1 (Square)', '4:3': '4:3 (Standard)', '3:4': '3:4 (Portrait Standard)', '21:9': '21:9 (Ultrawide)' };
const MEGAPIXELS = { '480p': 0.4, '720p': 0.98, '768p': 0.98 }; // 0.98 MP = 1344×768 at 16:9

export function createComfyH3Provider({ getSettings = () => ({}), fetchImpl = globalThis.fetch, workDir = os.tmpdir(), configDir = null } = {}) {
  const settings = () => ({ url: 'http://127.0.0.1:8188', engine_dir: 'C:\\Users\\harry\\Downloads\\H3 Engine', lora: 'v1', keep_source_audio: true, ...getSettings() });
  const base = () => settings().url.replace(/\/+$/, '');
  // Files the studio authors live in its own data dir (configDir); the engine dir holds only downloaded software/models.
  const templatePath = () => path.join(configDir ?? path.join(settings().engine_dir, '_workflows', 'character-swap'), 'h3-swap-v1.api.json');

  async function call(method, p, body, { raw = false, timeoutMs = 30000 } = {}) {
    let res;
    try {
      res = await fetchImpl(base() + p, { method, body, headers: body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : undefined, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      throw new ProviderError('network_pre_send', `local H3 engine not reachable at ${base()} — start it in Model Settings (${e.cause?.code ?? e.message})`, { retryable: true });
    }
    if (raw) return res;
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    if (!res.ok) throw new ProviderError(res.status === 400 ? 'invalid_request' : 'provider', `ComfyUI ${res.status}: ${json?.error?.message ?? json?.error ?? text.slice(0, 300)}${json?.node_errors ? ' ' + JSON.stringify(json.node_errors).slice(0, 400) : ''}`, { status: res.status });
    return json;
  }

  function loadTemplate() {
    const p = templatePath();
    if (!fs.existsSync(p)) throw new ProviderError('invalid_request', `H3 workflow template missing: ${p} (engine setup not finished)`);
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  }

  // Upload a file into ComfyUI's input folder; returns the name ComfyUI assigned.
  async function upload(file, name) {
    const fd = new FormData();
    fd.append('image', new Blob([fs.readFileSync(file)]), name);
    fd.append('type', 'input');
    fd.append('overwrite', 'true');
    const j = await call('POST', '/upload/image', fd, { timeoutMs: 300000 });
    return j.subfolder ? `${j.subfolder}/${j.name}` : j.name;
  }

  // ComfyUI's LoadVideo does not resample: conform the source to 24 fps first (playback speed preserved).
  async function conformSource(inp) {
    const fps = inp.asset?.meta?.video?.fps;
    if (fps && Math.abs(fps - 24) < 0.01) return inp.asset.path;
    const out = path.join(workDir, `h3src_${randomUUID()}.mp4`);
    await tool('ffmpeg', ['-y', '-v', 'error', '-i', f(inp.asset.path), '-vf', 'fps=24', '-c:v', 'libx264', '-crf', '12', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '256k', f(out)]);
    return out;
  }

  function buildGraph(req, uploaded) {
    const g = loadTemplate();
    const s = settings();
    const set = (id, key, val) => { if (!g[id]) throw new ProviderError('invalid_request', `workflow template has no node ${id} (re-export the template)`); g[id].inputs[key] = val; };
    set(N.sourceVideo, 'file', uploaded.video);
    set(N.charImage, 'image', uploaded.image);
    set(N.prompt, 'value', req.prompt);
    set(N.duration, 'value', Number(req.params.duration_s ?? req.inputs.find((i) => i.kind === 'video')?.asset?.meta?.duration_s ?? 5));
    const aspect = req.params.aspect && req.params.aspect !== 'adaptive' ? req.params.aspect : nearest(req.inputs.find((i) => i.kind === 'video')?.asset?.meta?.video);
    if (g[N.resolution]) { g[N.resolution].inputs.aspect_ratio = ASPECT_LABEL[aspect] ?? ASPECT_LABEL['16:9']; g[N.resolution].inputs.megapixels = MEGAPIXELS[req.params.resolution] ?? 0.4; }
    set(N.noise, 'noise_seed', Number.isInteger(req.params.seed) ? req.params.seed : Math.floor(Math.random() * 2 ** 31));
    set(N.swapLora, 'lora_name', SWAP_LORAS[req.params.lora ?? s.lora] ?? SWAP_LORAS.v1);
    set(N.saveVideo, 'filename_prefix', `studio/h3_swap_${randomUUID().slice(0, 8)}`);
    return g;
  }

  return {
    id: 'local-h3',
    label: 'MiniMax H3 · local character swap (ComfyUI engine)',
    billable: false,
    description: 'MiniMax H3 Ref2VA + Akatz Labs Character Swap LoRA, running on this PC\'s GPU through a hidden ComfyUI engine. MiniMax H3 is licensed under the MiniMax H3 Community License Agreement, Copyright © 2026 MiniMax.',
    attribution: 'MiniMax H3',
    models: () => [{ id: H3_MODEL, label: 'MiniMax H3 Ref2VA · Character Swap v1', workflows: CAPS.workflows, caps: CAPS }],
    caps: (m) => (m === H3_MODEL || !m ? CAPS : null),
    refToken: (inp, index) => (inp.kind === 'video' ? `<Video ${index + 1}>` : `<Picture ${index + 1}>`),
    estimate: () => ({ usd: 0, confidence: 'documented', basis: 'local GPU — no API cost (expect several minutes per clip on 16 GB VRAM with offloading)' }),

    validate(_m, req) {
      const { errors, warnings } = validateAgainstCaps(CAPS, req);
      const vid = req.inputs.filter((i) => i.kind === 'video');
      const img = req.inputs.filter((i) => i.kind === 'image');
      if (vid.length !== 1) errors.push('character swap needs exactly one source video (<Video 1>)');
      if (img.length !== 1) errors.push('character swap needs exactly one replacement character image (<Picture 1>)');
      const d = vid[0]?.asset?.meta?.duration_s;
      if (d != null && (d < 2 || d > 15)) errors.push(`source is ${d.toFixed(1)} s; H3 accepts 2–15 s — trim it first`);
      const fps = vid[0]?.asset?.meta?.video?.fps;
      if (fps && Math.abs(fps - 24) >= 0.01) warnings.push(`source is ${fps} fps — it will be conformed to 24 fps before upload`);
      if (!fs.existsSync(templatePath())) errors.push('local engine not set up: workflow template missing');
      for (const i of [...vid, ...img]) if (i.asset?.rights?.depicts_real_person && !i.asset?.rights?.likeness_consent)
        errors.push(`${i.label}: shows a real person — record likeness consent before swapping`);
      return { errors, warnings };
    },

    async submit(_m, req) {
      const v = req.inputs.find((i) => i.kind === 'video');
      const im = req.inputs.find((i) => i.kind === 'image');
      const src = await conformSource(v);
      const uploaded = {
        video: await upload(src, `studio_src_${randomUUID().slice(0, 8)}.mp4`),
        image: await upload(im.asset.path, `studio_char_${randomUUID().slice(0, 8)}${path.extname(im.asset.path) || '.png'}`),
      };
      if (src !== v.asset.path) fs.rmSync(src, { force: true });
      const j = await call('POST', '/prompt', JSON.stringify({ prompt: buildGraph(req, uploaded), client_id: 'harry-ai-film-studio' }));
      if (j.node_errors && Object.keys(j.node_errors).length) throw new ProviderError('invalid_request', `ComfyUI rejected the graph: ${JSON.stringify(j.node_errors).slice(0, 400)}`);
      // Keep what collect() needs to restore the source soundtrack.
      return { task_id: `${j.prompt_id}|${encodeURIComponent(v.asset.path)}` };
    },

    async poll(taskId) {
      const [pid] = taskId.split('|');
      const hist = await call('GET', `/history/${pid}`);
      const h = hist?.[pid];
      if (!h) {
        const q = await call('GET', '/queue');
        const inQueue = [...(q.queue_running ?? []), ...(q.queue_pending ?? [])].some((x) => x[1] === pid);
        if (inQueue) return { status: 'running' };
        return { status: 'failed', error: { category: 'provider', message: 'job vanished from the ComfyUI queue (engine restarted?)' } };
      }
      if (h.status?.status_str === 'error') {
        const msg = (h.status.messages ?? []).find((m) => m[0] === 'execution_error')?.[1];
        const oom = /out of memory|OutOfMemory|CUDA error/i.test(msg?.exception_message ?? '');
        return { status: 'failed', error: { category: oom ? 'provider' : 'invalid_request', message: oom ? 'GPU out of memory — try 480p or a shorter clip' : `${msg?.node_type ?? 'node'}: ${msg?.exception_message ?? 'execution error'}`.slice(0, 400) } };
      }
      if (!h.status?.completed) return { status: 'running' };
      const files = Object.values(h.outputs ?? {}).flatMap((o) => [...(o.videos ?? []), ...(o.gifs ?? []), ...(o.images ?? [])]).filter((x) => /\.(mp4|mov|webm)$/i.test(x.filename));
      if (!files.length) return { status: 'failed', error: { category: 'provider', message: 'finished without a video output' } };
      return { status: 'succeeded', result: { file: files[0], source_path: decodeURIComponent(taskId.split('|')[1] ?? ''), output_format: path.extname(files[0].filename).slice(1) }, usage: { usd: 0 } };
    },

    async cancel(taskId) {
      const [pid] = taskId.split('|');
      await call('POST', '/queue', JSON.stringify({ delete: [pid] }));
      const q = await call('GET', '/queue');
      if ((q.queue_running ?? []).some((x) => x[1] === pid)) await call('POST', '/interrupt', JSON.stringify({ prompt_id: pid }));
    },

    async download(result, destPath) {
      const { filename, subfolder = '', type = 'output' } = result.file;
      const res = await call('GET', `/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${type}`, undefined, { raw: true, timeoutMs: 600000 });
      if (!res.ok) throw new ProviderError('provider', `download from engine failed: HTTP ${res.status}`, { retryable: true });
      const tmp = destPath + '.engine' + path.extname(filename);
      await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
      // Put the original soundtrack back (picture stream copied, not re-encoded).
      const srcHasAudio = result.source_path && fs.existsSync(result.source_path) && (await probe(result.source_path)).audio;
      if (settings().keep_source_audio && srcHasAudio) {
        await tool('ffmpeg', ['-y', '-v', 'error', '-i', f(tmp), '-i', f(result.source_path), '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-shortest', f(destPath)]);
        fs.rmSync(tmp, { force: true });
      } else fs.renameSync(tmp, destPath);
      return destPath;
    },

    async testConnection() {
      const s = await call('GET', '/system_stats', undefined, { timeoutMs: 5000 });
      const dev = s.devices?.[0];
      const tpl = fs.existsSync(templatePath());
      return { ok: tpl, detail: `ComfyUI ${s.system?.comfyui_version ?? '?'} · ${dev?.name ?? 'no GPU'} · VRAM ${dev ? (dev.vram_total / 2 ** 30).toFixed(1) + ' GB' : '?'}${tpl ? '' : ' · workflow template MISSING'}` };
    },
  };
}

function nearest(v) {
  if (!v?.width) return '16:9';
  const r = v.width / v.height;
  const opts = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1, '4:3': 4 / 3, '3:4': 3 / 4, '21:9': 21 / 9 };
  return Object.entries(opts).reduce((b, [k, x]) => (Math.abs(Math.log(x / r)) < Math.abs(Math.log(opts[b] / r)) ? k : b), '16:9');
}
