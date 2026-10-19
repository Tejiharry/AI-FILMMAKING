import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyzeSoundtrack, alignCuts } from '../../server/engine/beats.js';
import { tool, f } from '../../server/media.js';

let tmp;
const clicks = async (name, bpm, seconds = 10) => {
  const p = path.join(tmp, name);
  const period = 60 / bpm;
  // 12 ms 2 kHz blips every beat, over a quiet pink-ish noise bed so it is not trivially clean.
  await tool('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `aevalsrc='if(lt(mod(t,${period}),0.012),0.8*sin(2*PI*2000*t),0)':s=44100:d=${seconds}`,
    '-f', 'lavfi', '-i', `anoisesrc=color=pink:amplitude=0.02:d=${seconds}:seed=42`, '-filter_complex', 'amix=inputs=2:normalize=0', f(p)]);
  return p;
};

before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beats-')); });
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('tempo and beat grid on a 120 BPM click track', async () => {
  const r = await analyzeSoundtrack(await clicks('c120.wav', 120), 10);
  assert.equal(r.silent, false);
  assert.ok(Math.abs(r.bpm - 120) <= 2, `bpm ${r.bpm}`);
  assert.ok(Math.abs(r.beats[0]) < 0.05, `first beat at ${r.beats[0]}`);
  // Recall: every click (0, 0.5, … 9.5 s) has an onset within 40 ms. Precision: ≤ 3 spurious onsets from the noise bed.
  const clicksAt = Array.from({ length: 20 }, (_, i) => i * 0.5);
  const missed = clicksAt.filter((c) => !r.onsets.some((o) => Math.abs(o.t - c) <= 0.04));
  assert.deepEqual(missed, [], `missed clicks at ${missed.join(', ')}`);
  const spurious = r.onsets.filter((o) => !clicksAt.some((c) => Math.abs(o.t - c) <= 0.04));
  assert.ok(spurious.length <= 3, `${spurious.length} spurious onsets`);
});

test('tempo on a 90 BPM click track (no octave error)', async () => {
  const r = await analyzeSoundtrack(await clicks('c90.wav', 90), 12);
  assert.ok(Math.abs(r.bpm - 90) <= 2, `bpm ${r.bpm}`);
});

test('silence is reported as silent, not as a tempo', async () => {
  const p = path.join(tmp, 'silence.wav');
  await tool('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', '4', f(p)]);
  assert.deepEqual(await analyzeSoundtrack(p, 4), { silent: true });
});

test('cut-to-beat alignment', () => {
  const beats = [0, 0.5, 1, 1.5, 2, 2.5, 3];
  const a = alignCuts([1.02, 1.74, 2.5], beats);
  assert.equal(a.tolerance_ms, 100);
  assert.equal(a.on_beat, 2);
  assert.deepEqual(a.cuts.map((c) => c.offset_ms), [20, 240, 0], '1.74 s is nearest the 1.5 s beat (+240 ms)');
});
