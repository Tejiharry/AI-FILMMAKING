// Soundtrack rhythm analysis for OG Katana — pure JS on decoded PCM (ffmpeg only decodes).
// onsets: energy-flux peaks; tempo: autocorrelation of the onset envelope (60–180 BPM, mild
// prior around 110 BPM against octave errors); beat grid: phase that best fits the onsets.
// Heuristic, not a music-information-retrieval library — results carry a confidence value.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { tool, f } from '../media.js';

export const SR = 11025;
export const HOP = 256; // ≈ 23 ms
// Envelope frame i covers samples [i·HOP, i·HOP + 2·HOP); a transient shows up ~1.5 hops after the
// frame start, so frame times are centred by this offset.
const frameTime = (i) => (i * HOP + 1.5 * HOP) / SR;

export async function decodeMono(file, { maxSeconds = 600 } = {}) {
  const out = path.join(os.tmpdir(), `pcm_${randomUUID()}.raw`);
  try {
    await tool('ffmpeg', ['-y', '-v', 'error', '-i', f(file), '-t', String(maxSeconds), '-vn', '-ac', '1', '-ar', String(SR), '-f', 's16le', f(out)]);
    const buf = fs.readFileSync(out);
    const pcm = new Float32Array(buf.length / 2);
    for (let i = 0; i < pcm.length; i++) pcm[i] = buf.readInt16LE(i * 2) / 32768;
    return pcm;
  } finally { fs.rmSync(out, { force: true }); }
}

// Onset strength envelope: positive change in log energy per hop.
export function onsetEnvelope(pcm) {
  const n = Math.floor((pcm.length - 2 * HOP) / HOP);
  const energy = new Float32Array(Math.max(0, n));
  for (let i = 0; i < n; i++) {
    let e = 0;
    for (let j = i * HOP; j < i * HOP + 2 * HOP; j++) e += pcm[j] * pcm[j];
    energy[i] = Math.log10(1e-10 + e / (2 * HOP));
  }
  const flux = new Float32Array(energy.length);
  // The first frame is compared with the clip's quietest level, so a hit right at 0 s still counts.
  const floor = energy.reduce((m, v) => (v < m ? v : m), Infinity);
  if (energy.length) flux[0] = Math.max(0, energy[0] - floor);
  for (let i = 1; i < energy.length; i++) flux[i] = Math.max(0, energy[i] - energy[i - 1]);
  const max = flux.reduce((m, v) => (v > m ? v : m), 0) || 1;
  for (let i = 0; i < flux.length; i++) flux[i] /= max;
  return flux;
}

export function pickOnsets(env, { minGapS = 0.08, delta = 0.08 } = {}) {
  const t = frameTime;
  const minGap = Math.round((minGapS * SR) / HOP);
  const onsets = [];
  for (let i = 0; i < env.length - 1; i++) {
    if (env[i] < (env[i - 1] ?? 0) || env[i] < env[i + 1]) continue;
    const lo = Math.max(0, i - 8), hi = Math.min(env.length, i + 9);
    const win = Array.from(env.slice(lo, hi)).sort((a, b) => a - b);
    const median = win[Math.floor(win.length / 2)];
    if (env[i] < median + delta) continue;
    if (onsets.length && i - onsets.at(-1).i < minGap) { if (env[i] > onsets.at(-1).s) onsets[onsets.length - 1] = { i, s: env[i] }; continue; }
    onsets.push({ i, s: env[i] });
  }
  return onsets.map((o) => ({ t: Math.round(t(o.i) * 1000) / 1000, strength: Math.round(o.s * 100) / 100 }));
}

export function estimateTempo(env, { minBpm = 60, maxBpm = 180 } = {}) {
  const fr = SR / HOP;
  const lagMin = Math.floor((60 / maxBpm) * fr), lagMax = Math.ceil((60 / minBpm) * fr);
  if (env.length < lagMax * 3) return null;
  // Smooth first: a beat period that falls between envelope frames would otherwise smear its peak
  // and let the (sharper) double period win — the classic half-tempo error.
  const sm = smooth(smooth(Array.from(env)));
  const mean = sm.reduce((a, b) => a + b, 0) / sm.length;
  const x = sm.map((v) => v - mean);
  const acAt = (lag) => { let s = 0; for (let i = lag; i < x.length; i++) s += x[i] * x[i - lag]; return s; };
  const ac = [];
  for (let lag = lagMin; lag <= lagMax; lag++) {
    const s = acAt(lag);
    const bpm = (60 * fr) / lag;
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 110) / 0.9) ** 2); // gentle preference for 70–170 BPM
    ac.push({ lag, s: s * prior, raw: s });
  }
  let best = ac.reduce((a, b) => (b.s > a.s ? b : a));
  // Octave check: if half the lag is nearly as periodic, the true beat is twice as fast.
  const half = ac.find((a) => Math.abs(a.lag - best.lag / 2) <= 1);
  if (half && half.raw >= 0.6 * best.raw) best = ac.filter((a) => Math.abs(a.lag - best.lag / 2) <= 1).reduce((a, b) => (b.raw > a.raw ? b : a));
  // parabolic refinement of the lag
  const k = ac.indexOf(best);
  let lag = best.lag;
  if (k > 0 && k < ac.length - 1) {
    const [a, b, c] = [ac[k - 1].s, ac[k].s, ac[k + 1].s];
    const d = a - 2 * b + c;
    if (d) lag += 0.5 * (a - c) / d;
  }
  const zero = x.reduce((s, v) => s + v * v, 0) || 1;
  const confidence = Math.max(0, Math.min(1, best.raw / zero));
  return { bpm: Math.round((60 * fr / lag) * 10) / 10, period_s: lag / fr, confidence: Math.round(confidence * 100) / 100 };
}

const smooth = (a) => a.map((v, i) => 0.25 * (a[i - 1] ?? v) + 0.5 * v + 0.25 * (a[i + 1] ?? v));

export function beatGrid(env, period_s, duration_s) {
  const fr = SR / HOP;
  const lag = period_s * fr;
  let bestPhase = 0, bestScore = -1;
  for (let ph = 0; ph < lag; ph += 0.5) {
    let s = 0;
    for (let p = ph; p < env.length; p += lag) s += env[Math.round(p)] ?? 0;
    if (s > bestScore) { bestScore = s; bestPhase = ph; }
  }
  let start = frameTime(bestPhase);
  while (start - period_s > -0.03) start -= period_s; // extend the grid back to the start of the clip
  const beats = [];
  for (let t = start; t <= duration_s + 1e-6; t += period_s) beats.push(Math.max(0, Math.round(t * 1000) / 1000));
  return beats;
}

// Cut-to-beat alignment: how many cuts land within tolerance of a beat.
export function alignCuts(cuts, beats, { toleranceS } = {}) {
  if (!beats?.length) return null;
  const period = beats.length > 1 ? beats[1] - beats[0] : 0.5;
  const tol = toleranceS ?? Math.min(0.1, period * 0.2);
  const rows = cuts.map((c) => {
    const nearest = beats.reduce((a, b) => (Math.abs(b - c) < Math.abs(a - c) ? b : a));
    const off = Math.round((c - nearest) * 1000);
    return { cut_s: c, nearest_beat_s: nearest, offset_ms: off, on_beat: Math.abs(c - nearest) <= tol };
  });
  return { tolerance_ms: Math.round(tol * 1000), on_beat: rows.filter((r) => r.on_beat).length, total: rows.length, cuts: rows };
}

export async function analyzeSoundtrack(file, duration_s) {
  const pcm = await decodeMono(file);
  if (pcm.length < SR) return null; // < 1 s of audio
  let peak = 0; for (const v of pcm) if (Math.abs(v) > peak) peak = Math.abs(v);
  if (peak < 0.003) return { silent: true };
  const env = onsetEnvelope(pcm);
  const onsets = pickOnsets(env);
  const tempo = estimateTempo(env);
  const beats = tempo ? beatGrid(env, tempo.period_s, duration_s ?? pcm.length / SR) : [];
  return { silent: false, bpm: tempo?.bpm ?? null, tempo_confidence: tempo?.confidence ?? 0, beat_period_s: tempo ? Math.round(tempo.period_s * 1000) / 1000 : null, beats, onsets: onsets.slice(0, 2000),
    method: 'log-energy flux onsets; autocorrelation tempo 60–180 BPM; phase-fit beat grid (heuristic)' };
}
