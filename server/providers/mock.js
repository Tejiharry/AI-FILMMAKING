// Mock provider: exercises the full job lifecycle with no network and no cost.
// Output is an ffmpeg test pattern with the shot label burned in and a "MOCK
// PROVIDER" banner, so it can never be mistaken for a real generation.
// Prompt tokens for deterministic failure testing:
//   [mock:fail]        -> task fails (provider error)
//   [mock:moderation]  -> task rejected by "moderation"
//   [mock:transient]   -> first submit attempt throws a retryable pre-send error
//   [mock:slow]        -> takes 3x longer
import { ProviderError, validateAgainstCaps } from './base.js';
import { makeMockVideo } from '../media.js';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';

const CAPS = {
  native_params: ['duration_s', 'aspect', 'resolution', 'seed', 'camera_fixed', 'generate_audio'],
  workflows: ['generate', 'image_to_video', 'first_last_frame', 'reference_to_video', 'edit', 'extend'],
  durations: { min: 2, max: 30, integer: true },
  resolutions: ['480p', '720p', '1080p'],
  aspects: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'],
  max_refs: { image: 9, video: 3, audio: 3 },
  frames_exclusive_with_refs: true,
  audio: true,
};

const DIMS = { '480p': 480, '720p': 720, '1080p': 1080 };

export function createMockProvider({ delayMs = 4000 } = {}) {
  const tasks = new Map();
  const transientSeen = new Set();

  return {
    id: 'mock',
    label: 'Mock provider (free, offline)',
    billable: false,
    description: 'Simulates a video model end-to-end for testing. Produces labelled test-pattern clips.',
    models: () => [{ id: 'mock-video-1', label: 'Mock Video 1', workflows: CAPS.workflows, caps: CAPS }],
    caps: () => CAPS,
    validate: (_m, req) => validateAgainstCaps(CAPS, req),
    estimate: (_m, req) => ({ usd: 0, basis: `mock: ${req.params.duration_s ?? 5}s at ${req.params.resolution ?? '720p'} (would be priced by the real provider)`, confidence: 'documented' }),
    // Mock references are referred to by their library handle, unchanged.
    refToken: (input, index) => input.handle ?? `[ref ${index + 1}]`,

    async submit(_m, req) {
      const key = req.prompt;
      if (req.prompt.includes('[mock:transient]') && !transientSeen.has(key)) {
        transientSeen.add(key);
        throw new ProviderError('network_pre_send', 'mock: connection refused before send', { retryable: true });
      }
      const id = `mock-${randomUUID()}`;
      const slow = req.prompt.includes('[mock:slow]') ? 3 : 1;
      tasks.set(id, { req, started: Date.now(), dur: delayMs * slow, cancelled: false });
      return { task_id: id };
    },

    async poll(taskId) {
      const t = tasks.get(taskId);
      if (!t) throw new ProviderError('invalid_request', `mock: unknown task ${taskId}`);
      if (t.cancelled) return { status: 'failed', error: { category: 'cancelled', message: 'cancelled' } };
      const elapsed = Date.now() - t.started;
      if (elapsed < t.dur) return { status: 'running', progress: Math.min(0.99, elapsed / t.dur) };
      if (t.req.prompt.includes('[mock:moderation]')) return { status: 'failed', error: { category: 'moderation', message: 'mock: input rejected by content moderation' } };
      if (t.req.prompt.includes('[mock:fail]')) return { status: 'failed', error: { category: 'provider', message: 'mock: generation failed' } };
      const p = t.req.params;
      return {
        status: 'succeeded',
        result: { mock: true, duration_s: p.duration_s ?? 5, resolution: p.resolution ?? '720p', aspect: p.aspect ?? '16:9', audio: !!p.generate_audio, label: t.req.label ?? 'shot' },
        usage: { tokens: 0, usd: 0 },
      };
    },

    async cancel(taskId) { const t = tasks.get(taskId); if (t) t.cancelled = true; },

    async download(result, destPath) {
      const h = DIMS[result.resolution] ?? 720;
      const [aw, ah] = result.aspect === 'adaptive' ? [16, 9] : result.aspect.split(':').map(Number);
      let w = Math.round((h * aw) / ah / 2) * 2;
      let hh = h;
      if (ah > aw) { w = h; hh = Math.round((h * ah) / aw / 2) * 2; }
      // keep test clips small/fast
      const scale = Math.min(1, 720 / Math.max(w, hh));
      await makeMockVideo(destPath, {
        duration_s: result.duration_s, width: Math.round((w * scale) / 2) * 2, height: Math.round((hh * scale) / 2) * 2,
        label: `MOCK · ${result.label}`, audio: result.audio,
      });
      if (!fs.existsSync(destPath)) throw new ProviderError('provider', 'mock: render produced no file');
      return destPath;
    },

    async testConnection() { return { ok: true, detail: 'mock provider is always available' }; },
  };
}
