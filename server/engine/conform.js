// Conform a Katana recreation to its reference: each selected take is trimmed (or held on its last
// frame) to the exact length of the reference shot it replaces, scaled/padded to the reference
// frame size and rate, concatenated, and laid over the reference soundtrack. The result is a new
// derived file; takes and the reference are never modified.
import { tool, f } from '../media.js';

// items: [{ file | null, duration_s }] in edit order. file null → black slate of that length.
export async function conformToReference({ items, width, height, fps, soundtrackFile, out }) {
  if (!items.length) throw Object.assign(new Error('nothing to conform'), { status: 409 });
  const W = Math.round(width / 2) * 2, H = Math.round(height / 2) * 2, FPS = fps || 24;
  const args = ['-y', '-v', 'error'];
  const chains = [];
  let inputIndex = 0;
  for (const [i, it] of items.entries()) {
    const d = Number(it.duration_s).toFixed(3);
    if (it.file) {
      args.push('-i', f(it.file));
      chains.push(`[${inputIndex}:v]setpts=PTS-STARTPTS,scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${FPS},tpad=stop_mode=clone:stop_duration=${d},trim=duration=${d},setpts=PTS-STARTPTS[v${i}]`);
    } else {
      args.push('-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}:r=${FPS}:d=${d}`);
      chains.push(`[${inputIndex}:v]setsar=1,trim=duration=${d},setpts=PTS-STARTPTS[v${i}]`);
    }
    inputIndex++;
  }
  const total = items.reduce((s, it) => s + Number(it.duration_s), 0);
  const fc = `${chains.join(';')};${items.map((_, i) => `[v${i}]`).join('')}concat=n=${items.length}:v=1:a=0[v]`;
  args.push('-filter_complex', fc, '-map', '[v]');
  if (soundtrackFile) { args.splice(args.indexOf('-filter_complex'), 0, '-i', f(soundtrackFile)); args.push('-map', `${inputIndex}:a:0?`, '-c:a', 'aac', '-b:a', '320k'); }
  args.push('-c:v', 'libx264', '-crf', '16', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-t', total.toFixed(3), '-movflags', '+faststart', f(out));
  await tool('ffmpeg', args);
  return { out, total_s: Math.round(total * 1000) / 1000, width: W, height: H, fps: FPS };
}
