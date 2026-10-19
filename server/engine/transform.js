// Video transformation planning (Genjutsu-/Katana-like workflows, original logic).
// 1. analyzeReference: segment a reference video into shots, measure timing,
//    extract a keyframe per shot (derived assets; the original is untouched).
// 2. planTransform: turn the analysis + a creative brief into ShotSpecs whose
//    references and workflow match what the provider documents.
// Everything regenerated is labelled as regenerated — never as an untouched edit.
import path from 'node:path';
import fs from 'node:fs';
import { probe, detectCuts, extractFrame } from '../media.js';
import { analyzeSoundtrack, alignCuts } from './beats.js';

export async function analyzeReference(asset, { threshold = 0.3, minShot = 0.5 } = {}) {
  const p = await probe(asset.path);
  const dur = p.duration_s ?? 0;
  const raw = await detectCuts(asset.path, threshold);
  const cuts = [];
  for (const t of raw) if (t - (cuts.at(-1) ?? 0) >= minShot && dur - t >= minShot) cuts.push(t);
  const bounds = [0, ...cuts, dur];
  const segments = [];
  const dir = path.join(path.dirname(asset.path), `${asset.id}.analysis`);
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < bounds.length - 1; i++) {
    const start = bounds[i], end = bounds[i + 1];
    const mid = start + (end - start) / 2;
    const kf = path.join(dir, `seg${String(i + 1).padStart(2, '0')}.jpg`);
    await extractFrame(asset.path, kf, mid);
    segments.push({ index: i + 1, start_s: round(start), end_s: round(end), duration_s: round(end - start), keyframe_file: kf });
  }
  const avg = segments.length ? dur / segments.length : 0;
  // Soundtrack rhythm: tempo, beat grid and how the reference's cuts sit on the beat.
  let soundtrack = null, cutAlignment = null;
  if (p.audio) {
    try {
      const s = await analyzeSoundtrack(asset.path, dur);
      if (s && !s.silent) {
        soundtrack = { bpm: s.bpm, tempo_confidence: s.tempo_confidence, beat_period_s: s.beat_period_s, beats: s.beats, onset_count: s.onsets.length, onsets: s.onsets.slice(0, 400), method: s.method };
        cutAlignment = alignCuts(segments.slice(1).map((x) => x.start_s), s.beats);
      } else if (s?.silent) soundtrack = { silent: true };
    } catch (e) { soundtrack = { error: e.message.slice(0, 200) }; }
  }
  return {
    soundtrack, cut_alignment: cutAlignment,
    source: { asset_id: asset.id, filename: asset.filename, duration_s: round(dur), width: p.video?.width, height: p.video?.height, fps: p.video?.fps, has_audio: !!p.audio },
    segments,
    edit_rhythm: { shot_count: segments.length, average_shot_s: round(avg), cuts_per_minute: dur ? round((segments.length - 1) / (dur / 60)) : 0,
      pacing: avg < 1.5 ? 'frenetic' : avg < 3 ? 'brisk' : avg < 6 ? 'measured' : 'slow' },
    method: `ffmpeg scene-change score > ${threshold}; keyframe at each segment midpoint`,
  };
}

const round = (n) => Math.round(n * 100) / 100;

export const TRANSFORMS = {
  recreate: { studio: 'katana', label: 'Reference-driven recreation', classification: 'Orchestrated', note: 'One new shot per reference segment, guided by that segment\'s keyframe and timing; output is newly generated footage.' },
  motion_transfer: { studio: 'genjutsu', label: 'Motion transfer', classification: 'Experimental', note: 'Reference video drives camera/motion; new subject from reference images. Motion fidelity is not guaranteed — verify by comparison.' },
  object_swap: { studio: 'genjutsu', label: 'Subject / product / object swap', classification: 'Orchestrated (provider edit task)', note: 'Provider edit task regenerates the clip; unaffected areas are NOT pixel-preserved. Use QC preservation SSIM to judge.' },
  selective_change: { studio: 'genjutsu', label: 'Selective scene change', classification: 'Orchestrated (provider edit task)', note: 'Text-directed edit of one element (weather, time of day, prop). Regenerated footage.' },
  style_transfer: { studio: 'katana', label: 'Style transfer', classification: 'Orchestrated (provider edit task)', note: 'Restyles the whole clip; motion is guided by the source but not frame-exact.' },
  character_swap: { studio: 'genjutsu', label: 'Character / face swap', classification: 'Experimental (local MiniMax H3 + swap LoRA, or provider edit task)', note: 'Keeps the source performance, camera and timing; replaces one person with a reference character. Regenerated footage — identity, expression and timing can drift; source audio is kept.' },
  extend: { studio: 'katana', label: 'Extend shot', classification: 'API-native (extend)', note: 'Continues the source clip forward/backward; new frames only.' },
};

// Returns [{ title, spec }] ready to insert as shots. `source` is the source video
// asset; `swapRefs` are library handles (characters/products) to bring in.
export function planTransform(type, { analysis, source, brief = '', swapRefs = [], target = '', replacement = '', direction = 'forward', extendSeconds = 5, aspect = '16:9', scope = 'character' }) {
  if (!TRANSFORMS[type]) throw Object.assign(new Error(`unknown transform ${type}`), { status: 400 });
  const handles = swapRefs.map((h) => h.handle ?? h);
  const subjects = handles.map((h) => ({ ref: h }));
  // No resolution here: transform shots inherit the project/scene default (blank = inherit).
  const base = { aspect, model_pref: {}, audio: { generate: false } };
  const label = TRANSFORMS[type];

  if (type === 'recreate') {
    if (!analysis?.segments?.length) throw Object.assign(new Error('recreate needs a reference analysis'), { status: 400 });
    return analysis.segments.map((s) => ({
      title: `Recreate seg ${s.index} (${s.start_s}–${s.end_s}s)`,
      keyframe_file: s.keyframe_file,
      spec: { ...base, workflow: 'reference_to_video', duration_s: Math.max(4, Math.min(30, Math.round(s.duration_s))),
        intent: { summary: `Recreate the composition, framing and camera movement of the reference keyframe. ${brief}`.trim(), beat: `ref segment ${s.index}` },
        subjects, transform: { type, label: label.label, source_asset_id: source.id, segment: s, original_duration_s: s.duration_s },
        // keyframe is attached as reference_image by the route once it is registered as an asset
      },
    }));
  }
  if (type === 'motion_transfer') {
    const ref = { role: 'reference_video', asset_id: source.id, note: 'motion and camera source' };
    return [{ title: `Motion transfer — ${source.filename}`, spec: { ...base, workflow: 'reference_to_video', duration_s: Math.max(4, Math.min(30, Math.round(source.meta?.duration_s ?? 5))),
      intent: { summary: `Follow the exact camera movement, timing and body motion of the reference video, frame for frame. ${handles.length ? `The performer is replaced by ${handles.join(' and ')}.` : ''} ${brief}`.trim(), beat: 'motion transfer' },
      subjects, references: [ref], transform: { type, label: label.label, source_asset_id: source.id } } }];
  }
  if (type === 'extend') {
    return [{ title: `Extend ${direction} — ${source.filename}`, spec: { ...base, aspect: 'adaptive', workflow: 'extend', duration_s: Math.max(4, Math.min(30, extendSeconds)),
      intent: { summary: `Extend the video ${direction}${direction === 'backward' ? ', showing what happened just before' : ', continuing the action naturally'}. ${brief}`.trim() },
      references: [{ role: 'reference_video', asset_id: source.id, note: 'clip to extend' }], transform: { type, label: label.label, source_asset_id: source.id, direction } } }];
  }
  if (type === 'character_swap') {
    const who = target || 'the person in the foreground';
    const repl = handles[0] ?? 'the reference character';
    // scope "face": best-effort face-only replacement (the swap LoRA was trained on whole-character swaps).
    const summary = scope === 'face'
      ? `Replace only the face of ${who} in the source video with the face of ${repl}. Keep ${who}'s body, build, clothing, hair and headwear, hands, pose and movement exactly as in the source; change only facial identity and features, matching the source expression, lip movement and head turns. Preserve the camera, framing, background, lighting, objects and all other people. Do not show the reference photo or its background. ${brief}`
      : `Replace only ${who} in the source video with ${repl}. Keep the replacement character's identity, outfit and look from ${repl}. Preserve the source video's camera, framing, background, lighting, objects and all other people. Match the replaced person's position, scale, pose and movement throughout the clip. Do not show the reference sheet or its background. ${brief}`;
    return [{ title: `${scope === 'face' ? 'Face swap' : 'Character swap'} — ${source.filename}`, spec: { ...base, aspect: 'adaptive', workflow: 'edit', duration_s: Math.max(2, Math.min(15, Math.round(source.meta?.duration_s ?? 5))),
      intent: { summary: summary.trim() },
      subjects: [], references: [{ role: 'reference_video', asset_id: source.id, note: 'source performance' }, ...(handles[0] ? [{ role: 'reference_image', ref: handles[0], note: `replacement: ${repl}` }] : [])],
      model_pref: { provider: 'local-h3', model: '' }, transform: { type, label: label.label, source_asset_id: source.id, target: who, replacement: repl, scope } } }];
  }
  // edit-task family
  const what = {
    object_swap: `Edit the video: replace ${target || 'the indicated subject'} with ${replacement || handles.join(' and ') || 'the reference'}. Keep everything else — camera, timing, other people, background, lighting — unchanged.`,
    selective_change: `Edit the video: ${brief || 'change only the specified element'}. Keep composition, camera movement, timing and all other elements unchanged.`,
    style_transfer: `Edit the video: restyle the whole clip as ${brief || 'the reference style'}, keeping the original composition, camera movement and timing.`,
  }[type];
  return [{ title: `${label.label} — ${source.filename}`, spec: { ...base, aspect: 'adaptive', workflow: 'edit', duration_s: Math.max(4, Math.min(30, Math.round(source.meta?.duration_s ?? 5))),
    intent: { summary: what }, subjects: type === 'object_swap' ? subjects : [],
    references: [{ role: 'reference_video', asset_id: source.id, note: 'source to edit' }],
    transform: { type, label: label.label, source_asset_id: source.id, target, replacement } } }];
}
