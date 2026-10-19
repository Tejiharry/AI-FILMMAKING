import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeCameraPath, forward } from '../../server/engine/previz.js';

// Blender camera looking down +Y (rotation_euler = [90°, 0, 0]) — the default "front" camera pose.
const R = Math.PI / 2;
const pose = (frame, loc, rz = 0, rx = R, lens = 35) => ({ frame, location: loc, rotation_euler: [rx, 0, rz], lens_mm: lens });
const path = (fn, n = 48) => ({ fps: 24, frames: Array.from({ length: n }, (_, i) => fn(i / (n - 1), i + 1)) });

test('forward vector for the standard Blender camera pose looks down +Y', () => {
  const f = forward([R, 0, 0]);
  assert.ok(Math.abs(f[0]) < 1e-9 && Math.abs(f[1] - 1) < 1e-9 && Math.abs(f[2]) < 1e-9, JSON.stringify(f));
});

test('push in, pull out, truck, pedestal', () => {
  assert.deepEqual(analyzeCameraPath(path((t, fr) => pose(fr, [0, -10 + 4 * t, 1.6]))).moves, ['push_in']);
  assert.deepEqual(analyzeCameraPath(path((t, fr) => pose(fr, [0, -6 - 4 * t, 1.6]))).moves, ['pull_out']);
  assert.deepEqual(analyzeCameraPath(path((t, fr) => pose(fr, [3 * t, -8, 1.6]))).moves, ['truck_right']);
  assert.deepEqual(analyzeCameraPath(path((t, fr) => pose(fr, [0, -8, 1 + 2 * t]))).moves, ['pedestal_up']);
});

test('pan and tilt from rotation only', () => {
  assert.deepEqual(analyzeCameraPath(path((t, fr) => pose(fr, [0, -8, 1.6], -0.6 * t))).moves, ['pan_right'], 'negative Z rotation turns the camera to the right');
  assert.deepEqual(analyzeCameraPath(path((t, fr) => pose(fr, [0, -8, 1.6], 0, R + 0.4 * t))).moves, ['tilt_up']);
});

test('orbit: circling the subject while turning to keep it in frame', () => {
  const r = analyzeCameraPath(path((t, fr) => { const a = -Math.PI / 2 + 1.2 * t; return pose(fr, [6 * Math.cos(a), 6 * Math.sin(a), 1.6], 1.2 * t); }));
  assert.equal(r.moves[0], 'orbit', JSON.stringify(r));
});

test('two phases become an ordered stack; focal length and static', () => {
  const r = analyzeCameraPath(path((t, fr) => (t < 0.5 ? pose(fr, [0, -10 + 6 * t, 1.6], 0, R, 50) : pose(fr, [0, -7, 1.6], -1.2 * (t - 0.5), R, 50))));
  assert.deepEqual(r.moves, ['push_in', 'pan_right']);
  assert.equal(r.focal_mm, 50);
  assert.deepEqual(analyzeCameraPath(path((t, fr) => pose(fr, [0, -8, 1.6]))).moves, ['static']);
});
