// Quality control. Splits findings into MEASURED (computer-verifiable, with the
// number) and MANUAL (needs a human eye/ear). Recommends targeted fixes instead
// of blind regeneration.
import { probe, lumaStats, detectCuts, ssim, frameColorStats } from '../media.js';
import { OUTPUT_DIMS } from '../providers/seedance.js';

const pct = (n) => `${Math.round(n * 100)}%`;

export async function runQc({ asset, job, spec, referenceAssets = [] }) {
  const measured = [];
  const manual = [];
  const recs = [];
  const add = (check, result, value, detail, fix) => { measured.push({ check, result, value, detail }); if (result !== 'PASS' && fix) recs.push({ check, fix }); };

  const p = await probe(asset.path);
  const v = p.video;
  if (!v) { add('video stream', 'FAIL', null, 'no video stream'); return { measured, manual, recommendations: recs, probe: p }; }

  const params = job?.request?.params ?? {};
  const isMock = !!asset.meta?.mock;
  // Encoding / format compliance against what was requested.
  if (params.resolution && params.aspect && params.aspect !== 'adaptive' && !isMock) {
    const exp = OUTPUT_DIMS[params.resolution]?.[params.aspect];
    if (exp) add('output dimensions', v.width === exp[0] && v.height === exp[1] ? 'PASS' : 'FAIL', `${v.width}×${v.height}`, `expected ${exp[0]}×${exp[1]} for ${params.resolution} ${params.aspect}`, 'Wrong size from provider — check request params; conform in post rather than regenerating.');
  } else if (spec?.aspect && spec.aspect !== 'adaptive') {
    const [aw, ah] = spec.aspect.split(':').map(Number);
    const ok = Math.abs(v.width / v.height - aw / ah) < 0.02;
    add('aspect ratio', ok ? 'PASS' : 'FAIL', (v.width / v.height).toFixed(3), `expected ${spec.aspect} (${(aw / ah).toFixed(3)})`, 'Aspect mismatch — reframe/crop in post or regenerate with explicit ratio.');
  }
  if (params.duration_s && params.duration_s > 0) {
    const d = p.duration_s ?? 0;
    const diff = Math.abs(d - params.duration_s);
    add('duration', diff <= 0.5 ? 'PASS' : 'WARN', `${d.toFixed(2)}s`, `requested ${params.duration_s}s (Δ ${diff.toFixed(2)}s)`, 'Trim in the edit; only regenerate if the action is truncated.');
  }
  add('frame rate', !v.fps || isMock || Math.abs(v.fps - 24) < 0.01 ? 'PASS' : 'WARN', v.fps, 'provider output is documented as 24 fps', 'Conform to 23.976/24 in the NLE; do not frame-blend.');
  if (params.generate_audio !== undefined) add('audio track', !!p.audio === !!params.generate_audio ? 'PASS' : 'FAIL', p.audio ? `${p.audio.codec} ${p.audio.channels}ch` : 'none', params.generate_audio ? 'audio requested' : 'no audio requested', 'Audio presence differs from request — check generate_audio.');

  // Temporal stability: luma per frame.
  const y = await lumaStats(asset.path);
  if (y.length > 2) {
    const deltas = y.slice(1).map((n, i) => Math.abs(n - y[i]));
    const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    const sd = Math.sqrt(deltas.reduce((a, b) => a + (b - mean) ** 2, 0) / deltas.length);
    const spikes = deltas.filter((d) => d > Math.max(6, mean + 4 * sd)).length;
    const black = y.filter((n) => n < 18).length;
    add('flicker (luma)', spikes === 0 ? 'PASS' : spikes <= 2 ? 'WARN' : 'FAIL', `${spikes} spikes`, `mean |ΔY| ${mean.toFixed(2)}, sd ${sd.toFixed(2)} over ${y.length} frames`,
      'Localised luminance jumps: try a deflicker pass in post (e.g. Resolve Deflicker) before regenerating; if regenerating, add "steady, consistent exposure" and avoid flickering practicals in the prompt.');
    add('black frames', black === 0 ? 'PASS' : 'WARN', `${black} frames`, 'frames with mean luma < 18/255', 'Check whether black frames are intended (fades); trim otherwise.');
  }
  // Unintended cuts inside a single generated shot.
  const cuts = await detectCuts(asset.path, 0.4);
  const wantsCuts = (spec?.timeline ?? []).some((b) => /cut|smash|match cut/i.test(b.action ?? ''));
  add('unintended cuts', cuts.length === 0 || wantsCuts ? 'PASS' : 'FAIL', `${cuts.length}`, cuts.length ? `scene changes at ${cuts.map((t) => t.toFixed(2) + 's').join(', ')}` : 'single continuous shot',
    'Model cut inside the shot: add "one continuous take, no cuts" to the prompt, or keep the usable segment and trim.');

  // Reference similarity (heuristic, never a guarantee).
  for (const ref of referenceAssets) {
    if (ref.role === 'first_frame' && ref.asset?.kind === 'image') {
      const s = await ssim(asset.path, ref.asset.path).catch(() => null);
      if (s != null) add('first-frame match (SSIM, frame 0)', s >= 0.6 ? 'PASS' : 'WARN', s.toFixed(3), 'structural similarity of the opening frame to the first_frame image', 'Opening frame drifts from the storyboard frame — check the frame image was accepted and is the same aspect.');
    }
    if (['reference_image', 'first_frame'].includes(ref.role) && ref.asset?.kind === 'image') {
      const [a, b] = await Promise.all([frameColorStats(asset.path, 0.5).catch(() => null), frameColorStats(ref.asset.path, 0).catch(() => null)]);
      if (a && b && Number.isFinite(a.uavg)) {
        const dist = Math.hypot(a.uavg - b.uavg, a.vavg - b.vavg) / 2.55;
        add(`colour similarity vs ${ref.asset.filename}`, dist < 8 ? 'PASS' : dist < 16 ? 'WARN' : 'FAIL', `${dist.toFixed(1)}%`, 'chroma-centre distance (UV mean), heuristic for palette/look drift',
          'Look drift vs reference: match in grade first (Resolve colour match); regenerate only if wardrobe/production colours are wrong.');
      }
    }
  }

  // What a computer cannot verify here.
  manual.push('Identity: does each character match their reference (face, hair, build)?');
  if (spec?.subjects?.some((s) => s.wardrobe)) manual.push('Wardrobe matches the spec and previous shots.');
  if (spec?.camera?.movement) manual.push(`Camera move reads as "${spec.camera.movement}" (motion is prompt-driven, not guaranteed).`);
  if (spec?.framing?.shot_size) manual.push(`Framing reads as ${spec.framing.shot_size} at ${spec.framing.angle ?? 'eye level'}.`);
  if (spec?.dialogue?.length) manual.push('Dialogue wording and lip-sync (listen on headphones).');
  manual.push('Hands, faces and object interactions free of morphing artefacts.', 'Requested visual elements present; nothing extra introduced.', 'Performance and emotion are believable.');

  const fails = measured.filter((m) => m.result === 'FAIL').length;
  const warns = measured.filter((m) => m.result === 'WARN').length;
  return { summary: { fails, warns, passes: measured.length - fails - warns, verdict: fails ? 'needs fix' : warns ? 'review' : 'technically clean' }, measured, manual, recommendations: recs, probe: p, mock_output: isMock };
}

export async function compareVersions(a, b) {
  const [pa, pb] = await Promise.all([probe(a.path), probe(b.path)]);
  const s = await ssim(a.path, b.path).catch(() => null);
  return {
    ssim: s, ssim_note: s == null ? 'not measurable' : s > 0.9 ? 'near-identical' : s > 0.6 ? `similar structure (${pct(s)})` : `substantially different (${pct(s)})`,
    a: { id: a.id, duration_s: pa.duration_s, size: `${pa.video?.width}×${pa.video?.height}` },
    b: { id: b.id, duration_s: pb.duration_s, size: `${pb.video?.width}×${pb.video?.height}` },
  };
}
