// Local post tools (ffmpeg): reframe to another aspect and resample-upscale.
// Outputs are new files; sources are never modified. Upscale is high-quality resampling,
// not AI super-resolution — it cannot invent detail. Generative outpainting is not available
// with the current models (Seedance edit keeps the source ratio; the local H3 graph is swap-only).
import { tool, f, probe } from '../media.js';

export const ASPECTS = { '9:16': 9 / 16, '4:5': 4 / 5, '1:1': 1, '4:3': 4 / 3, '16:9': 16 / 9, '1.85:1': 1.85, '21:9': 21 / 9, '2.39:1': 2.39 };
const even = (n) => Math.max(2, Math.round(n / 2) * 2);

// mode: crop (lose edges; position 0..1 along the free axis), pad (black bars), blur (blurred fill).
export function reframeGeometry(W, H, aspect, mode) {
  const a = ASPECTS[aspect];
  if (!a) throw Object.assign(new Error(`aspect must be one of ${Object.keys(ASPECTS).join(', ')}`), { status: 400 });
  const src = W / H;
  if (mode === 'crop') return src > a ? { w: even(H * a), h: even(H), axis: 'x' } : { w: even(W), h: even(W / a), axis: 'y' };
  return src > a ? { w: even(W), h: even(W / a) } : { w: even(H * a), h: even(H) }; // canvas that contains the whole source
}

export async function reframe(file, out, { aspect = '9:16', mode = 'crop', position = 0.5 } = {}) {
  const p = await probe(file);
  if (!p.video) throw Object.assign(new Error('not a video'), { status: 400 });
  const { width: W, height: H } = p.video;
  const g = reframeGeometry(W, H, aspect, mode);
  const pos = Math.max(0, Math.min(1, Number(position)));
  let vf, fc;
  if (mode === 'crop') vf = `crop=${g.w}:${g.h}:${g.axis === 'x' ? `(iw-${g.w})*${pos}` : 0}:${g.axis === 'y' ? `(ih-${g.h})*${pos}` : 0},setsar=1`;
  else if (mode === 'pad') vf = `scale=${g.w}:${g.h}:force_original_aspect_ratio=decrease,pad=${g.w}:${g.h}:(ow-iw)/2:(oh-ih)/2:black,setsar=1`;
  else if (mode === 'blur') fc = `[0:v]split=2[bgsrc][fg];[bgsrc]scale=${g.w}:${g.h}:force_original_aspect_ratio=increase,crop=${g.w}:${g.h},boxblur=24:2,eq=brightness=-0.08[bg];[fg]scale=${g.w}:${g.h}:force_original_aspect_ratio=decrease[fgs];[bg][fgs]overlay=(W-w)/2:(H-h)/2,setsar=1[v]`;
  else throw Object.assign(new Error('mode must be crop, pad or blur'), { status: 400 });
  const args = ['-y', '-v', 'error', '-i', f(file)];
  if (fc) args.push('-filter_complex', fc, '-map', '[v]', '-map', '0:a?'); else args.push('-vf', vf, '-map', '0:v:0', '-map', '0:a?');
  args.push('-c:v', 'libx264', '-crf', '16', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', f(out));
  await tool('ffmpeg', args);
  return { width: g.w, height: g.h, aspect, mode, position: mode === 'crop' ? pos : null, source: `${W}×${H}` };
}

const TARGET_H = { '1080p': 1080, '1440p': 1440, '2160p': 2160 };
export async function upscale(file, out, { target = '1080p', sharpen = true } = {}) {
  const p = await probe(file);
  if (!p.video) throw Object.assign(new Error('not a video'), { status: 400 });
  const { width: W, height: H } = p.video;
  const short = Math.min(W, H);
  const factor = target === 'x2' ? 2 : TARGET_H[target] ? TARGET_H[target] / short : null;
  if (!factor) throw Object.assign(new Error('target must be 1080p, 1440p, 2160p or x2'), { status: 400 });
  if (factor <= 1) throw Object.assign(new Error(`source is already ${W}×${H} — ${target} would not upscale`), { status: 409 });
  const w = even(W * factor), h = even(H * factor);
  const vf = `scale=${w}:${h}:flags=lanczos+accurate_rnd+full_chroma_int${sharpen ? ',unsharp=5:5:0.6:5:5:0.0' : ''},setsar=1`;
  await tool('ffmpeg', ['-y', '-v', 'error', '-i', f(file), '-vf', vf, '-map', '0:v:0', '-map', '0:a?', '-c:v', 'libx264', '-crf', '14', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', f(out)]);
  return { width: w, height: h, factor: Math.round(factor * 100) / 100, method: `lanczos resample${sharpen ? ' + light unsharp' : ''} (not AI super-resolution)`, source: `${W}×${H}` };
}
