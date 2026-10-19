// Prompt compiler: effective ShotSpec -> provider-neutral GenerationRequest plus a
// compile report that states, field by field, whether the setting is delivered
// as a documented API parameter (guaranteed to be honoured as a parameter), as a
// reference input, or only as best-effort prompt text.
import { phraseFor, focalPhrase, aperturePhrase, colorTempPhrase } from './cinematography.js';

// refsByHandle: { '@mira': { type, name, description, attrs, assets: [{id, kind}] } }
// caps: adapter capability descriptor for the chosen model (see providers/base.js)
export function compileShot(spec, { refsByHandle = {}, caps, assetsById = {} }) {
  const report = [];
  const note = (field, value, delivered_as, extra = '') =>
    report.push({ field, value, delivered_as, guaranteed: delivered_as === 'api_param', note: extra });

  const native = new Set(caps?.native_params ?? []);
  const params = {};
  const parts = [];
  const handleText = (h) => {
    const r = refsByHandle[h];
    if (!r) return h;
    return r.description ? `${h} (${r.name}: ${r.description})` : `${h} (${r.name})`;
  };

  // --- API-level parameters (only those the adapter documents as native) ----
  const setParam = (key, value, field) => {
    if (value == null || value === '') return false;
    if (native.has(key)) { params[key] = value; note(field, value, 'api_param'); return true; }
    return false;
  };
  let durationText = '';
  if (!setParam('duration_s', Number(spec.duration_s), 'duration_s')) { durationText = `Duration ${spec.duration_s} seconds.`; note('duration_s', spec.duration_s, 'prompt', 'model may not honour exact length'); }
  if (!setParam('aspect', spec.aspect, 'aspect')) note('aspect', spec.aspect, 'prompt');
  if (!setParam('resolution', spec.resolution, 'resolution')) note('resolution', spec.resolution, 'unsupported', 'not a parameter for this model');
  if (spec.seed != null) { if (!setParam('seed', Number(spec.seed), 'seed')) note('seed', spec.seed, 'unsupported'); }
  if (spec.camera?.movement === 'static' && native.has('camera_fixed')) { params.camera_fixed = true; note('camera.movement', 'static', 'api_param', 'mapped to camera_fixed'); }
  if (spec.audio?.generate) { if (!setParam('generate_audio', true, 'audio.generate')) note('audio.generate', true, 'unsupported', 'model has no audio output'); }
  else if (native.has('generate_audio')) params.generate_audio = false;

  // --- Reference inputs ------------------------------------------------------
  const inputs = [];
  for (const r of spec.references ?? []) {
    if (r.asset_id) {
      const a = assetsById[r.asset_id];
      inputs.push({ asset_id: r.asset_id, role: r.role, kind: a?.kind, label: r.note || a?.filename });
      note(`references.${r.role}`, a?.filename ?? r.asset_id, 'reference');
    } else if (r.ref && refsByHandle[r.ref]) {
      // A library reference: attach its first asset of the matching kind.
      const want = r.role === 'reference_video' ? 'video' : r.role === 'reference_audio' ? 'audio' : 'image';
      const a = refsByHandle[r.ref].assets.find((x) => x.kind === want);
      if (a) { inputs.push({ asset_id: a.id, role: r.role, kind: a.kind, handle: r.ref, label: r.ref }); note(`references.${r.role}`, r.ref, 'reference'); }
      else note(`references.${r.role}`, r.ref, 'unsupported', `${r.ref} has no ${want} asset`);
    }
  }
  // Subjects with library refs contribute a reference image automatically when
  // the model supports reference images and none was given for that handle.
  if (caps?.max_refs?.image) {
    for (const s of spec.subjects ?? []) {
      const ref = refsByHandle[s.ref];
      if (!ref || inputs.some((i) => i.handle === s.ref)) continue;
      const img = ref.assets.find((x) => x.kind === 'image');
      if (img) { inputs.push({ asset_id: img.id, role: 'reference_image', kind: 'image', handle: s.ref, label: s.ref, auto: true }); note('subjects', s.ref, 'reference', 'auto-attached library image'); }
    }
  }

  // --- Prompt text (best-effort) ---------------------------------------------
  const opener = [phraseFor('shot_size', spec.framing?.shot_size), phraseFor('angle', spec.framing?.angle)].filter(Boolean).join(', ');
  if (opener) { parts.push(cap(opener) + '.'); note('framing', `${spec.framing.shot_size}/${spec.framing.angle}`, 'prompt'); }
  if (spec.intent?.summary) parts.push(endDot(spec.intent.summary));
  if (spec.location) parts.push(`Location: ${handleText(spec.location)}.`);
  for (const s of spec.subjects ?? []) {
    const bits = [handleText(s.ref)];
    if (s.wardrobe) bits.push(`wearing ${s.wardrobe}`);
    if (s.blocking) bits.push(s.blocking);
    parts.push(endDot(bits.join(', ')));
  }
  if (spec.intent?.action) parts.push(endDot(spec.intent.action));
  if (spec.framing?.composition) parts.push(endDot(`Composition: ${spec.framing.composition}`));

  if (spec.timeline?.length) {
    note('timeline', `${spec.timeline.length} beats`, 'prompt', 'timing is best-effort');
    for (const b of spec.timeline) {
      const cam = b.camera ? ` Camera: ${phraseFor('movement', b.camera) ?? b.camera}.` : '';
      parts.push(`[${fmtT(b.start_s)}–${fmtT(b.end_s)}] ${endDot(b.action)}${cam}`);
    }
  }

  // Camera
  const cam = [];
  // Ordered move stack (2+ moves): "first X, then Y" — order matters.
  const stack = (spec.camera?.moves ?? []).map((m) => phraseFor('movement', m)).filter(Boolean);
  const mv = stack.length > 1 ? `first ${stack[0]}${stack.slice(1).map((p) => `, then ${p}`).join('')}` : phraseFor('movement', spec.camera?.movement);
  if (mv) cam.push(mv); // kept even when camera_fixed is set: helps adherence
  if (spec.camera?.movement && spec.camera.movement !== 'static') {
    const sp = phraseFor('speed', spec.camera.speed); if (sp) cam.push(sp);
    const rigConflict = spec.camera.rig === 'tripod' && !['pan_left', 'pan_right', 'tilt_up', 'tilt_down'].includes(spec.camera.movement);
    const rig = phraseFor('rig', spec.camera.rig); if (rig && !rigConflict) cam.push(rig);
  }
  if (spec.camera?.notes) cam.push(spec.camera.notes);
  if (cam.length) {
    parts.push(`Camera: ${cam.join(', ')}.`);
    if (!params.camera_fixed) note('camera', spec.camera.movement, 'prompt', 'camera motion is interpreted, not physically controlled');
  }

  const lens = [focalPhrase(spec.lens?.focal_mm), phraseFor('lens_character', spec.lens?.character), aperturePhrase(spec.lens?.aperture), phraseFor('dof', spec.lens?.dof), spec.lens?.focus_notes].filter(Boolean);
  if (lens.length) { parts.push(`Lens: ${lens.join(', ')}.`); note('lens', [spec.lens.focal_mm && `${spec.lens.focal_mm}mm`, spec.lens.aperture && `f/${spec.lens.aperture}`, spec.lens.character, spec.lens.dof].filter(Boolean).join(' '), 'prompt', 'focal length/aperture are aesthetic hints'); }

  const L = spec.lighting ?? {};
  const light = [phraseFor('key_direction', L.key_direction), phraseFor('light_quality', L.quality), phraseFor('contrast', L.contrast), colorTempPhrase(L.color_temp_k), phraseFor('time_of_day', L.time_of_day), L.motivation].filter(Boolean);
  const atmo = [phraseFor('atmosphere', spec.atmosphere?.type), spec.atmosphere?.notes].filter(Boolean);
  if (light.length) { parts.push(`Lighting: ${light.join(', ')}.`); note('lighting', Object.fromEntries(Object.entries(L).filter(([, v]) => v !== '' && v != null)), 'prompt'); }
  if (atmo.length) { parts.push(`Atmosphere: ${atmo.join(', ')}.`); note('atmosphere', spec.atmosphere.type, 'prompt'); }

  const lk = spec.look ?? {};
  const look = [phraseFor('genre', lk.genre), phraseFor('era', lk.era), phraseFor('camera_body', lk.camera_body), phraseFor('texture', lk.texture), lk.grade_notes].filter(Boolean);
  if (lk.palette?.length) look.push(`colour palette ${lk.palette.join(', ')}`);
  if (look.length) { parts.push(`Look: ${look.join(', ')}.`); note('look', lk, 'prompt', lk.palette?.length ? 'hex palette is a guide; verify in QC' : ''); }

  const tempo = phraseFor('tempo', spec.pacing?.tempo);
  const mood = [spec.intent?.emotion && `emotional tone: ${spec.intent.emotion}`, tempo].filter(Boolean);
  if (mood.length) parts.push(cap(endDot(mood.join(', '))));

  for (const d of spec.dialogue ?? []) {
    const t = d.start_s != null ? ` [${fmtT(d.start_s)}${d.end_s != null ? '–' + fmtT(d.end_s) : ''}]` : '';
    parts.push(`${d.speaker ? handleText(d.speaker) : 'Character'} says${t}: "${d.line}"`);
  }
  if (spec.dialogue?.length) note('dialogue', spec.dialogue.length, spec.audio?.generate && native.has('generate_audio') ? 'prompt' : 'prompt', 'lip-sync and wording are best-effort; verify by ear');

  if (spec.audio?.generate) {
    const snd = [spec.audio.ambience && `ambience: ${spec.audio.ambience}`, spec.audio.sfx && `sound effects: ${spec.audio.sfx}`, spec.audio.music && `music: ${spec.audio.music}`].filter(Boolean);
    if (snd.length) parts.push(`Sound: ${snd.join('; ')}.`);
  }

  let negative = (spec.negative ?? []).filter(Boolean).join(', ');
  if (negative) {
    if (native.has('negative_prompt')) { params.negative_prompt = negative; note('negative', negative, 'api_param'); }
    else { parts.push(`Avoid: ${negative}.`); note('negative', negative, 'prompt', 'negative phrasing in prompt is weak'); }
  }

  if (durationText) parts.push(durationText);
  const prompt = parts.join(' ').replace(/\s+/g, ' ').trim();
  return { prompt, params, inputs, report };
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const endDot = (s) => { s = String(s).trim(); return /[.!?"]$/.test(s) ? s : s + '.'; };
const fmtT = (s) => `${Number(s)}s`;
