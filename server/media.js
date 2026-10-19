// ffmpeg / ffprobe bridge. Uses native binaries if on PATH, otherwise WSL
// (`wsl.exe -e ffmpeg`), translating Windows paths to /mnt/<drive>/...
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let mode = null; // 'native' | 'wsl' | 'none'

function run(cmd, args, { timeout = 10 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) { err.stderr = String(stderr); return reject(err); }
      resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

export async function detectMode() {
  if (mode) return mode;
  try { await run('ffmpeg', ['-version'], { timeout: 15000 }); mode = 'native'; return mode; } catch {}
  if (process.platform === 'win32') {
    try { await run('wsl.exe', ['-e', 'ffmpeg', '-version'], { timeout: 30000 }); mode = 'wsl'; return mode; } catch {}
  }
  mode = 'none';
  return mode;
}

export const toWsl = (p) => {
  const abs = path.resolve(p);
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(abs);
  return m ? `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}` : abs.replace(/\\/g, '/');
};

// Run ffmpeg/ffprobe. File arguments must be wrapped with f() so they are path-translated.
export async function tool(bin, args) {
  const m = await detectMode();
  if (m === 'none') throw new Error('ffmpeg not available (install natively or in WSL)');
  const conv = args.map((a) => (a && typeof a === 'object' && a.file ? (m === 'wsl' ? toWsl(a.file) : a.file) : a));
  return m === 'wsl' ? run('wsl.exe', ['-e', bin, ...conv]) : run(bin, conv);
}
export const f = (file) => ({ file });

export async function probe(file) {
  const { stdout } = await tool('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', f(file)]);
  const j = JSON.parse(stdout);
  const v = j.streams.find((s) => s.codec_type === 'video');
  const a = j.streams.find((s) => s.codec_type === 'audio');
  const rate = v?.avg_frame_rate && v.avg_frame_rate !== '0/0' ? v.avg_frame_rate : v?.r_frame_rate;
  const fps = rate ? rate.split('/').reduce((n, d) => Number(n) / Number(d)) : null;
  return {
    duration_s: Number(j.format?.duration ?? v?.duration ?? a?.duration ?? 0) || null,
    format: j.format?.format_name,
    bit_rate: Number(j.format?.bit_rate) || null,
    video: v ? { codec: v.codec_name, width: v.width, height: v.height, fps: fps ? Math.round(fps * 1000) / 1000 : null, pix_fmt: v.pix_fmt, frames: Number(v.nb_frames) || null } : null,
    audio: a ? { codec: a.codec_name, channels: a.channels, sample_rate: Number(a.sample_rate) } : null,
  };
}

// ffmpeg 8: '-ss 0' before a still-image input yields zero frames (exit code 0),
// so only seek when there is something to seek to.
const seek = (t) => (Number(t) > 0 ? ['-ss', String(t)] : []);

export async function thumbnail(file, out, atSeconds = 0) {
  await tool('ffmpeg', ['-y', '-v', 'error', ...seek(atSeconds), '-i', f(file), '-frames:v', '1', '-vf', 'scale=480:-2', f(out)]);
  if (!fs.existsSync(out)) throw new Error(`thumbnail not written for ${path.basename(file)}`);
  return out;
}

export async function extractFrame(file, out, atSeconds) {
  await tool('ffmpeg', ['-y', '-v', 'error', ...seek(atSeconds), '-i', f(file), '-frames:v', '1', f(out)]);
  if (!fs.existsSync(out)) throw new Error(`frame not written for ${path.basename(file)} at ${atSeconds}s`);
  return out;
}

// Mock-provider clip: test pattern + burned-in label so it is unmistakably NOT a real generation.
export async function makeMockVideo(out, { duration_s = 5, width = 1280, height = 720, fps = 24, label = 'MOCK', audio = false }) {
  const txt = path.join(os.tmpdir(), `mock-label-${process.pid}-${Date.now()}.txt`);
  fs.writeFileSync(txt, label.slice(0, 120));
  const font = (await detectMode()) === 'wsl' || process.platform !== 'win32' ? '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf' : 'C\\:/Windows/Fonts/arial.ttf';
  const txtPath = (await detectMode()) === 'wsl' ? toWsl(txt) : txt.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1\\:');
  const vf = `drawtext=fontfile=${font}:textfile=${txtPath}:fontcolor=white:fontsize=${Math.round(height / 18)}:box=1:boxcolor=black@0.6:boxborderw=12:x=(w-text_w)/2:y=h-text_h-40,` +
    `drawtext=fontfile=${font}:text='MOCK PROVIDER %{pts\\:hms}':fontcolor=yellow:fontsize=${Math.round(height / 24)}:x=30:y=30`;
  const args = ['-y', '-v', 'error', '-f', 'lavfi', '-i', `testsrc2=size=${width}x${height}:rate=${fps}:duration=${duration_s}`];
  if (audio) args.push('-f', 'lavfi', '-i', `sine=frequency=440:duration=${duration_s}`);
  args.push('-vf', vf, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '23');
  if (audio) args.push('-c:a', 'aac', '-b:a', '128k', '-shortest');
  args.push('-movflags', '+faststart', f(out));
  try { await tool('ffmpeg', args); } finally { fs.rmSync(txt, { force: true }); }
  return out;
}

// Shot segmentation: frame times where the scene-change score exceeds threshold.
export async function detectCuts(file, threshold = 0.3) {
  const { stderr } = await tool('ffmpeg', ['-v', 'info', '-i', f(file), '-filter:v', `select='gt(scene,${threshold})',showinfo`, '-an', '-f', 'null', '-']);
  const times = [];
  for (const m of stderr.matchAll(/pts_time:([0-9.]+)/g)) times.push(Number(m[1]));
  return times;
}

// Per-frame luma statistics for flicker / black-frame analysis.
export async function lumaStats(file) {
  const { stderr } = await tool('ffmpeg', ['-v', 'info', '-i', f(file), '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.YAVG', '-an', '-f', 'null', '-']);
  const out = [];
  for (const m of stderr.matchAll(/lavfi\.signalstats\.YAVG=([0-9.]+)/g)) out.push(Number(m[1]));
  return out;
}

// Mean SSIM between two clips (scaled to a common size). Used for version
// comparison and preservation checks in edit workflows.
export async function ssim(a, b, { width = 640, height = 360 } = {}) {
  const fc = `[0:v]scale=${width}:${height},setsar=1[a];[1:v]scale=${width}:${height},setsar=1[b];[a][b]ssim`;
  const { stderr } = await tool('ffmpeg', ['-v', 'info', '-i', f(a), '-i', f(b), '-filter_complex', fc, '-f', 'null', '-']);
  const m = /SSIM .*All:([0-9.]+)/.exec(stderr);
  return m ? Number(m[1]) : null;
}

// Colour histogram signature of a still/frame (for reference-similarity heuristics):
// mean R,G,B and luma via signalstats on a single frame.
export async function frameColorStats(file, atSeconds = 0) {
  const { stderr } = await tool('ffmpeg', ['-v', 'info', ...seek(atSeconds), '-i', f(file), '-frames:v', '1', '-vf', 'signalstats,metadata=print', '-f', 'null', '-']);
  const g = (k) => Number((new RegExp(`lavfi\\.signalstats\\.${k}=([0-9.]+)`).exec(stderr) ?? [])[1]);
  return { yavg: g('YAVG'), uavg: g('UAVG'), vavg: g('VAVG'), satavg: g('SATAVG'), hueavg: g('HUEAVG') };
}
