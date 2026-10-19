// Blender previz → motion reference. Imports a render (image sequence folder or video) and, if a
// camera.json exported from Blender is present, derives the camera move stack and focal length.
// camera.json: { fps, frames: [{ frame, location:[x,y,z], rotation_euler:[x,y,z] (rad, XYZ), lens_mm }] }
// (exported by docs/blender/export_camera_json.py). Blender: Z up, camera looks down its local −Z.
import fs from 'node:fs';
import path from 'node:path';
import { tool, f } from '../media.js';

const deg = (r) => (r * 180) / Math.PI;
const sub = (a, b) => a.map((v, i) => v - b[i]);
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); };

// Camera forward vector for Blender XYZ euler (R = Rz·Ry·Rx applied to (0,0,−1)).
export function forward([rx, ry, rz]) {
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(rx), Math.sin(rx), Math.cos(ry), Math.sin(ry), Math.cos(rz), Math.sin(rz)];
  // columns of R; forward = −(third column)
  return [-(cz * sy * cx + sz * sx), -(sz * sy * cx - cz * sx), -(cy * cx)];
}
const heading = (fw) => deg(Math.atan2(fw[1], fw[0]));            // yaw in the XY plane
const pitch = (fw) => deg(Math.asin(Math.max(-1, Math.min(1, fw[2]))));
const wrap = (d) => ((d + 540) % 360) - 180;

// Classify one stretch of camera motion.
function classify(a, b, dt) {
  const f0 = norm(forward(a.rotation_euler));
  const right = norm(cross(f0, [0, 0, 1]));
  const d = sub(b.location, a.location);
  const dolly = dot(d, f0), truck = dot(d, right), ped = d[2];
  const pan = -wrap(heading(forward(b.rotation_euler)) - heading(f0)); // + = pan right
  const tilt = pitch(forward(b.rotation_euler)) - pitch(f0);
  const lensRatio = (b.lens_mm ?? 50) / (a.lens_mm ?? 50);
  const travel = Math.hypot(...d);
  const comps = [];
  // Orbit: sideways travel while turning back toward the subject (pan opposite to the truck).
  // The arc's forward travel is part of the orbit, not a separate push.
  const orbit = Math.abs(pan) > 15 && Math.abs(truck) > 0.2 && Math.sign(pan) === -Math.sign(truck);
  if (orbit) comps.push(['orbit', 100]);
  else {
    if (Math.abs(pan) > 4) comps.push([pan > 0 ? 'pan_right' : 'pan_left', Math.abs(pan) / 20]);
    if (Math.abs(truck) > Math.max(0.15, travel * 0.3)) comps.push([truck > 0 ? 'truck_right' : 'truck_left', Math.abs(truck)]);
  }
  if (lensRatio > 1.3 && dolly < -0.2) comps.push(['dolly_zoom', 2]);
  else if (!orbit) {
    if (Math.abs(dolly) > Math.max(0.15, travel * 0.3)) comps.push([dolly > 0 ? 'push_in' : 'pull_out', Math.abs(dolly)]);
    if (lensRatio > 1.6 && dt < 1.2) comps.push(['crash_zoom', 2]);
  }
  if (Math.abs(tilt) > 4) comps.push([tilt > 0 ? 'tilt_up' : 'tilt_down', Math.abs(tilt) / 20]);
  if (Math.abs(ped) > Math.max(0.15, travel * 0.3)) comps.push([ped > 0 ? 'pedestal_up' : 'crane_down', Math.abs(ped)]);
  comps.sort((x, y) => y[1] - x[1]);
  const angRate = Math.max(Math.abs(pan), Math.abs(tilt)) / (dt || 1);
  return { moves: comps.map((c) => c[0]), dolly, truck, pedestal: ped, pan_deg: pan, tilt_deg: tilt, lens_ratio: lensRatio, ang_rate: angRate, travel };
}

export function analyzeCameraPath(cam) {
  const fr = (cam.frames ?? []).filter((x) => x.location && x.rotation_euler).sort((a, b) => a.frame - b.frame);
  if (fr.length < 2) return { moves: ['static'], focal_mm: Math.round(fr[0]?.lens_mm ?? 0) || null, note: 'single camera pose — locked off' };
  const fps = cam.fps || 24;
  const first = fr[0], mid = fr[Math.floor(fr.length / 2)], last = fr.at(-1);
  const whole = classify(first, last, (last.frame - first.frame) / fps);
  const h1 = classify(first, mid, (mid.frame - first.frame) / fps), h2 = classify(mid, last, (last.frame - mid.frame) / fps);
  // A two-phase stack only when the halves really differ (e.g. push in, then pan).
  let moves = h1.moves[0] && h2.moves[0] && h1.moves[0] !== h2.moves[0] ? [h1.moves[0], h2.moves[0]] : whole.moves.slice(0, 1);
  if (!moves.length || !moves[0]) moves = ['static'];
  const lenses = fr.map((x) => x.lens_mm).filter(Boolean).sort((a, b) => a - b);
  const focal = lenses.length ? Math.round(lenses[Math.floor(lenses.length / 2)]) : null;
  const speed = whole.ang_rate > 25 ? 'fast' : whole.ang_rate > 8 ? 'medium' : 'slow';
  return { moves, speed, focal_mm: focal, frames: fr.length, duration_s: Math.round(((last.frame - first.frame + 1) / fps) * 100) / 100,
    details: { dolly: round(whole.dolly), truck: round(whole.truck), pedestal: round(whole.pedestal), pan_deg: round(whole.pan_deg), tilt_deg: round(whole.tilt_deg), lens_change: round(whole.lens_ratio) },
    note: 'derived from the Blender camera path (heuristic); check the Movement tile' };
}
const round = (n) => Math.round(n * 100) / 100;

// Folder of frames → pattern for ffmpeg (prefix + zero-padded number + ext).
export function framePattern(dir) {
  const files = fs.readdirSync(dir).filter((n) => /\.(png|jpe?g|exr|tiff?)$/i.test(n)).sort();
  if (!files.length) return null;
  const m = /^(.*?)(\d+)(\.\w+)$/.exec(files[0]);
  if (!m) throw Object.assign(new Error(`frame names must end in a number (e.g. frame_0001.png), got ${files[0]}`), { status: 400 });
  const [, prefix, digits, ext] = m;
  const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d{${digits.length}})${ext.replace('.', '\\.')}$`);
  const nums = files.map((n) => re.exec(n)?.[1]).filter(Boolean).map(Number);
  if (nums.length !== files.length) throw Object.assign(new Error('mixed frame names in the folder — keep one image sequence per folder'), { status: 400 });
  return { pattern: path.join(dir, `${prefix}%0${digits.length}d${ext}`), start: Math.min(...nums), count: nums.length, ext };
}

export async function encodeSequence(seq, out, fps) {
  await tool('ffmpeg', ['-y', '-v', 'error', '-framerate', String(fps), '-start_number', String(seq.start), '-i', f(seq.pattern),
    '-c:v', 'libx264', '-crf', '16', '-pix_fmt', 'yuv420p', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-movflags', '+faststart', f(out)]);
  return out;
}
