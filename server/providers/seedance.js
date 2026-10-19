// BytePlus ModelArk — Dreamina Seedance 2.5 adapter.
// Built ONLY from documented fields (docs/research/seedance-2.5-api.md, docs read 2026-10-18).
// Anything not documented for 2.5 (seed, camera_fixed, frames, service_tier=flex) is never sent.
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ProviderError, validateAgainstCaps } from './base.js';

export const SEEDANCE_25 = 'dreamina-seedance-2-5-260628';
export const DEFAULT_BASE_URL = 'https://ark.ap-southeast.bytepluses.com/api/v3';

// USD per 1M output tokens (ModelArk pricing page, read 2026-10-18). Overridable in settings.
export const DEFAULT_PRICING = {
  source: 'BytePlus ModelArk pricing, read 2026-10-18',
  per_million: { '480p': { no_video: 10.7, with_video: 6.4 }, '720p': { no_video: 10.7, with_video: 6.4 }, '1080p': { no_video: 11.7, with_video: 7.0 } },
};

// Documented 2.5 output sizes.
export const OUTPUT_DIMS = {
  '480p': { '16:9': [854, 480], '4:3': [752, 560], '1:1': [640, 640], '3:4': [560, 752], '9:16': [480, 854], '21:9': [992, 432] },
  '720p': { '16:9': [1280, 720], '4:3': [1112, 834], '1:1': [960, 960], '3:4': [834, 1112], '9:16': [720, 1280], '21:9': [1470, 630] },
  '1080p': { '16:9': [1920, 1080], '4:3': [1664, 1248], '1:1': [1440, 1440], '3:4': [1248, 1664], '9:16': [1080, 1920], '21:9': [2206, 946] },
};
const FPS = 24;

const CAPS = {
  // seed is NOT listed for 2.5 in the docs (UNKNOWN) -> not native; delivered nowhere.
  native_params: ['duration_s', 'aspect', 'resolution', 'generate_audio'],
  workflows: ['generate', 'image_to_video', 'first_last_frame', 'reference_to_video', 'edit', 'extend'],
  durations: { min: 4, max: 30, integer: true },
  resolutions: ['480p', '720p', '1080p'],
  aspects: ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive'],
  max_refs: { image: 30, video: 10, audio: 10 },
  frames_exclusive_with_refs: true,
  audio: true,
  notes: [
    'ratio is forced to "adaptive" for first-frame, first+last-frame, edit and extend tasks',
    'edit tasks use duration -1 (output ≈ source length)',
    'reference images/videos containing real faces are refused unless they are asset:// IDs or recent trusted Seedance outputs',
    'output is 24 fps; 1080p output is 10-bit HEVC; audio is mono',
    'Punjabi is not a documented prompt/dialogue language',
  ],
};

const TASK_TYPE = { reference_to_video: 'reference', edit: 'edit', extend: 'extend' };
const ADAPTIVE_WORKFLOWS = new Set(['image_to_video', 'first_last_frame', 'edit', 'extend']);
const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/bmp', 'image/tiff', 'image/gif', 'image/heic', 'image/heif']);
const AUDIO_MIME = new Set(['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/mpeg', 'audio/mp3']);

// The remote URL for an input, if the user (or a previous generation) provided one.
function remoteUrl(inp) {
  const m = inp.asset?.meta ?? {};
  if (m.remote_url) return m.remote_url;
  // A recent Seedance output can be referenced by its provider URL while it is valid (24 h).
  if (m.provider_url && m.provider_url_valid_until && Date.parse(m.provider_url_valid_until) > Date.now()) return m.provider_url;
  return null;
}

export function createSeedanceProvider({ getCredentials, getPricing = () => DEFAULT_PRICING, fetchImpl = globalThis.fetch, getSettings = () => ({}) } = {}) {
  const creds = () => {
    const c = getCredentials();
    if (!c?.api_key) throw new ProviderError('auth', 'BytePlus ModelArk API key is not configured (Model Settings)');
    return { api_key: c.api_key, base_url: (c.base_url || DEFAULT_BASE_URL).replace(/\/+$/, ''), model_override: c.endpoint_id || null };
  };

  async function call(method, path, body, { timeoutMs = 60000 } = {}) {
    const { api_key, base_url } = creds();
    let res;
    try {
      res = await fetchImpl(`${base_url}${path}`, {
        method,
        headers: { Authorization: `Bearer ${api_key}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      const code = e.cause?.code ?? e.code;
      // Connection never established -> the request was definitely not received.
      if (['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET_BEFORE'].includes(code))
        throw new ProviderError('network_pre_send', `network error before send (${code})`, { retryable: true });
      throw new ProviderError('network_unknown', `network error: ${e.name === 'TimeoutError' ? 'request timed out' : e.message}`, { retryable: false });
    }
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : {}; } catch { /* non-JSON error page */ }
    if (!res.ok) {
      const err = json?.error ?? {};
      const code = err.code ?? `HTTP_${res.status}`;
      const msg = err.message ?? text.slice(0, 300);
      throw new ProviderError(categorize(res.status, code), `${code}: ${msg}`, { status: res.status, code, retryable: res.status === 429 }); // 429 = rejected, safe to retry
    }
    return json;
  }

  function modelId(m) { return creds().model_override || m || SEEDANCE_25; }

  function toWire(model, req) {
    const content = [];
    if (req.prompt?.trim()) content.push({ type: 'text', text: req.prompt });
    for (const inp of req.inputs) {
      const url = inputUrl(inp);
      if (inp.kind === 'image') content.push({ type: 'image_url', image_url: { url }, role: inp.role });
      else if (inp.kind === 'video') content.push({ type: 'video_url', video_url: { url }, role: 'reference_video' });
      else if (inp.kind === 'audio') content.push({ type: 'audio_url', audio_url: { url }, role: 'reference_audio' });
    }
    const p = req.params ?? {};
    const s = getSettings();
    const body = { model: modelId(model), content };
    if (p.resolution) body.resolution = p.resolution;
    body.ratio = ADAPTIVE_WORKFLOWS.has(req.workflow) ? 'adaptive' : (p.aspect ?? 'adaptive');
    body.duration = req.workflow === 'edit' ? -1 : (p.duration_s ?? -1);
    body.generate_audio = !!p.generate_audio;
    if (TASK_TYPE[req.workflow]) body.omni_reference_task_type = TASK_TYPE[req.workflow];
    body.output_format = s.output_format ?? 'mp4';
    body.watermark = s.watermark ?? false;
    body.return_last_frame = true; // used for shot-to-shot continuity chaining
    if (s.execution_expires_after) body.execution_expires_after = s.execution_expires_after;
    return body;
  }

  function inputUrl(inp) {
    const r = remoteUrl(inp);
    if (r) return r;
    if (inp.kind === 'video') throw new ProviderError('invalid_request', `video reference "${inp.label}" needs a hosted https:// or asset:// URL (ModelArk does not accept Base64 video)`);
    const mime = inp.asset?.mime;
    const data = fs.readFileSync(inp.asset.path).toString('base64');
    return `data:${mime};base64,${data}`;
  }

  function outputDims(req) {
    const res = req.params.resolution ?? '720p';
    let aspect = req.params.aspect;
    if (!aspect || aspect === 'adaptive' || ADAPTIVE_WORKFLOWS.has(req.workflow)) {
      // Adaptive: estimate from the first frame / source video if known, else 16:9.
      const src = req.inputs.find((i) => i.role === 'first_frame' || i.kind === 'video');
      const v = src?.asset?.meta?.video ?? src?.asset?.meta?.image;
      aspect = v ? nearestAspect(v.width / v.height) : '16:9';
    }
    return OUTPUT_DIMS[res]?.[aspect] ?? OUTPUT_DIMS['720p']['16:9'];
  }

  function estimate(_model, req) {
    const pricing = getPricing();
    const res = req.params.resolution ?? '720p';
    const videos = req.inputs.filter((i) => i.kind === 'video');
    const inputVideoS = videos.reduce((s, v) => s + (v.asset?.meta?.duration_s ?? 0), 0);
    let outS = req.params.duration_s;
    let confidence = 'documented';
    const caveats = [];
    if (req.workflow === 'edit') { outS = inputVideoS || 30; caveats.push('edit output ≈ source length'); }
    if (outS == null || outS === -1) { outS = 30; confidence = 'approximate'; caveats.push('duration chosen by model; priced at the 30 s maximum'); }
    if (videos.length) { confidence = 'approximate'; caveats.push('minimum token charge for video input is not documented in our research'); }
    if (videos.some((v) => !v.asset?.meta?.duration_s)) caveats.push('some input video durations unknown');
    const [w, h] = outputDims(req);
    const tokens = Math.round(((inputVideoS + outS) * w * h * FPS) / 1024);
    const rate = pricing.per_million[res]?.[videos.length ? 'with_video' : 'no_video'];
    if (rate == null) return { usd: 0, tokens, confidence: 'unknown', basis: `no price for ${res}` };
    const usd = Math.round((tokens / 1e6) * rate * 10000) / 10000;
    return { usd, tokens, confidence, basis: `${tokens.toLocaleString('en-US')} tokens = (${inputVideoS}s in + ${outS}s out) × ${w}×${h} × ${FPS}fps / 1024 at $${rate}/M (${pricing.source})${caveats.length ? '; ' + caveats.join('; ') : ''}` };
  }

  function validate(model, req) {
    const { errors, warnings } = validateAgainstCaps(CAPS, req);
    const videos = req.inputs.filter((i) => i.kind === 'video');
    const audios = req.inputs.filter((i) => i.kind === 'audio');
    const images = req.inputs.filter((i) => i.kind === 'image');
    const sumDur = (xs) => xs.reduce((s, x) => s + (x.asset?.meta?.duration_s ?? 0), 0);
    if (sumDur(videos) > 30) errors.push(`reference videos total ${sumDur(videos).toFixed(1)}s > 30s`);
    if (sumDur(audios) > 30) errors.push(`reference audio totals ${sumDur(audios).toFixed(1)}s > 30s`);
    let inlineBytes = 0;
    for (const v of videos) {
      const d = v.asset?.meta?.duration_s;
      const min = req.workflow === 'edit' ? 4 : 2;
      if (d != null && (d < min || d > 30)) errors.push(`${v.label}: video is ${d.toFixed(1)}s, must be ${min}–30s`);
      if ((v.asset?.bytes ?? 0) > 200 * 1024 ** 2) errors.push(`${v.label}: video exceeds 200 MB`);
      const fps = v.asset?.meta?.video?.fps;
      if (fps && (fps < 24 || fps > 60)) errors.push(`${v.label}: ${fps} fps outside 24–60`);
      if (!remoteUrl(v)) errors.push(`${v.label}: video references need a hosted https:// or asset:// URL — set "Remote URL" on the asset (ModelArk does not accept Base64 video)`);
    }
    for (const i of images) {
      if (remoteUrl(i)) continue;
      const m = i.asset?.meta?.image ?? i.asset?.meta?.video;
      if (i.asset && !IMAGE_MIME.has(i.asset.mime)) errors.push(`${i.label}: image type ${i.asset.mime} not accepted`);
      if ((i.asset?.bytes ?? 0) >= 30 * 1024 ** 2) errors.push(`${i.label}: image must be < 30 MB`);
      if (m?.width && (Math.min(m.width, m.height) < 300 || Math.max(m.width, m.height) > 6000)) errors.push(`${i.label}: sides must be 300–6000 px (is ${m.width}×${m.height})`);
      if (m?.width && (m.width / m.height < 0.4 || m.width / m.height > 2.5)) errors.push(`${i.label}: aspect ratio must be 0.4–2.5`);
      inlineBytes += Math.ceil((i.asset?.bytes ?? 0) * 4 / 3);
    }
    for (const a of audios) {
      if (remoteUrl(a)) continue;
      if (a.asset && !AUDIO_MIME.has(a.asset.mime)) errors.push(`${a.label}: audio must be wav or mp3`);
      if ((a.asset?.bytes ?? 0) > 15 * 1024 ** 2) errors.push(`${a.label}: audio exceeds 15 MB`);
      const d = a.asset?.meta?.duration_s;
      if (d != null && (d < 2 || d > 30)) errors.push(`${a.label}: audio is ${d.toFixed(1)}s, must be 2–30s`);
      inlineBytes += Math.ceil((a.asset?.bytes ?? 0) * 4 / 3);
    }
    if (inlineBytes > 60 * 1024 ** 2) errors.push(`inline (Base64) media totals ${(inlineBytes / 1024 ** 2).toFixed(1)} MB; request body limit is 64 MB — host large files and set Remote URL`);
    for (const i of [...images, ...videos]) {
      const r = i.asset?.rights;
      const url = remoteUrl(i) ?? '';
      if (r?.depicts_real_person && !url.startsWith('asset://') && !i.asset?.meta?.trusted_output)
        errors.push(`${i.label}: Seedance 2.5 refuses real-face references unless they are an authorized asset:// ID or a recent trusted Seedance output`);
    }
    if (ADAPTIVE_WORKFLOWS.has(req.workflow) && req.params.aspect && req.params.aspect !== 'adaptive')
      warnings.push(`aspect ${req.params.aspect} will be sent as "adaptive" (required for ${req.workflow})`);
    if (req.workflow === 'edit' && req.params.duration_s) warnings.push('edit tasks ignore duration (output ≈ source length)');
    const words = (req.prompt ?? '').split(/\s+/).filter(Boolean).length;
    if (words > 1000) warnings.push(`prompt is ${words} words; documented recommendation is ≤ 1000`);
    if (/[਀-੿]/.test(req.prompt ?? '')) warnings.push('Gurmukhi text detected — Punjabi is not a documented Seedance 2.5 language');
    return { errors, warnings };
  }

  return {
    id: 'seedance',
    label: 'BytePlus ModelArk · Seedance 2.5',
    billable: true,
    description: 'Dreamina Seedance 2.5 via BytePlus ModelArk (ap-southeast-1). Billed per output token.',
    models: () => [{ id: SEEDANCE_25, label: 'Dreamina Seedance 2.5', workflows: CAPS.workflows, caps: CAPS }],
    caps: (m) => (m === SEEDANCE_25 || !m ? CAPS : null),
    validate, estimate, toWire,
    refToken: (inp, index) => `@${{ image: 'Image', video: 'Video', audio: 'Audio' }[inp.kind] ?? 'Image'}${index + 1}`,

    async submit(model, req) {
      const body = toWire(model, req);
      const j = await call('POST', '/contents/generations/tasks', body);
      if (!j?.id) throw new ProviderError('network_unknown', 'create returned no task id');
      return { task_id: j.id };
    },

    async poll(taskId) {
      const j = await call('GET', `/contents/generations/tasks/${encodeURIComponent(taskId)}`, null, { timeoutMs: 30000 });
      const pricing = getPricing();
      if (j.status === 'queued' || j.status === 'running') return { status: 'running', provider_status: j.status };
      if (j.status === 'succeeded') {
        const tokens = j.usage?.completion_tokens ?? null;
        const rate = pricing.per_million[j.resolution]?.no_video; // input-video rate unknowable here; job keeps the estimate basis
        return {
          status: 'succeeded',
          result: { url: j.content?.video_url, last_frame_url: j.content?.last_frame_url, duration_s: j.duration, fps: j.framespersecond, resolution: j.resolution, ratio: j.ratio, output_format: j.output_format, seed: j.seed, raw_status: j.status },
          usage: { tokens, usd_upper_bound: tokens != null && rate ? Math.round((tokens / 1e6) * rate * 10000) / 10000 : null },
        };
      }
      const err = j.error ?? {};
      return { status: 'failed', error: { category: j.status === 'expired' ? 'timeout' : j.status === 'cancelled' ? 'cancelled' : categorize(400, err.code ?? ''), code: err.code, message: err.message ?? j.status } };
    },

    async cancel(taskId) { await call('DELETE', `/contents/generations/tasks/${encodeURIComponent(taskId)}`); },

    async download(result, destPath) {
      if (!result.url) throw new ProviderError('provider', 'succeeded task has no video_url');
      const res = await fetchImpl(result.url, { signal: AbortSignal.timeout(10 * 60 * 1000) });
      if (!res.ok) throw new ProviderError('provider', `download failed: HTTP ${res.status}`, { retryable: true });
      await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(destPath));
      return destPath;
    },

    async downloadLastFrame(result, destPath) {
      if (!result.last_frame_url) return null;
      const res = await fetchImpl(result.last_frame_url, { signal: AbortSignal.timeout(120000) });
      if (!res.ok) return null;
      await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(destPath));
      return destPath;
    },

    // Free call: listing tasks verifies the key, region and model access without generating.
    async testConnection() {
      const j = await call('GET', `/contents/generations/tasks?page_num=1&page_size=1&filter.model=${encodeURIComponent(modelId())}`, null, { timeoutMs: 20000 });
      return { ok: true, detail: `authenticated; ${j.total ?? 0} task(s) on record for ${modelId()}` };
    },

    // Used to reconcile a submit whose outcome is unknown (timeout after send).
    async listRecent({ sinceUnix } = {}) {
      const j = await call('GET', `/contents/generations/tasks?page_num=1&page_size=20&filter.model=${encodeURIComponent(modelId())}`, null, { timeoutMs: 20000 });
      return (j.items ?? []).filter((t) => !sinceUnix || t.created_at >= sinceUnix).map((t) => ({ id: t.id, status: t.status, created_at: t.created_at, duration: t.duration, resolution: t.resolution }));
    },
  };
}

export function categorize(status, code = '') {
  if (/SensitiveContent|PolicyViolation|PrivacyInformation|DeepFake/i.test(code)) return 'moderation';
  if (status === 401 || /Authentication/i.test(code)) return 'auth';
  if (status === 403 || status === 404 || /NotOpen|AccessDenied|Overdue/i.test(code)) return 'quota';
  if (status === 429) return 'rate_limit';
  if (status === 400) return 'invalid_request';
  return 'provider';
}

const ASPECTS = { '16:9': 16 / 9, '4:3': 4 / 3, '1:1': 1, '3:4': 3 / 4, '9:16': 9 / 16, '21:9': 21 / 9 };
export function nearestAspect(r) {
  return Object.entries(ASPECTS).reduce((best, [k, v]) => (Math.abs(Math.log(v / r)) < Math.abs(Math.log(ASPECTS[best] / r)) ? k : best), '16:9');
}
