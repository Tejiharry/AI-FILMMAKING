// Shot Specification: the provider-independent description of a shot.
// Project settings -> scene settings -> shot spec are deep-merged (later wins;
// arrays replace) so a shot inherits the project's look and the scene's location
// and lighting unless it overrides them.
import { VOCAB } from './cinematography.js';

export const SPEC_VERSION = 1;

export function defaultSpec() {
  return {
    version: SPEC_VERSION,
    intent: { summary: '', action: '', emotion: '', beat: '' },
    duration_s: 5,
    aspect: '16:9',
    resolution: '1080p',
    // Unset = not mentioned in the prompt. Only choices the filmmaker (or a
    // preset / the Director) actually made are compiled.
    framing: { shot_size: '', angle: '', composition: '' },
    camera: { movement: '', speed: '', rig: '', notes: '' },
    lens: { focal_mm: null, character: '', aperture: null, dof: '', focus_notes: '' },
    lighting: { key_direction: '', quality: '', contrast: '', color_temp_k: null, time_of_day: '', motivation: '' },
    look: { genre: '', era: '', texture: '', camera_body: '', palette: [], grade_notes: '' },
    atmosphere: { type: '', notes: '' },
    pacing: { tempo: '' },
    subjects: [],          // [{ ref: '@handle', blocking: '', wardrobe: '' }]
    location: '',          // '@handle' or free text
    references: [],        // [{ asset_id | ref, role: first_frame|last_frame|reference_image|reference_video|reference_audio, note }]
    dialogue: [],          // [{ speaker: '@handle', line: '', start_s, end_s }]
    audio: { generate: false, ambience: '', sfx: '', music: '' },
    timeline: [],          // optional timed beats [{ start_s, end_s, action, camera }]
    negative: [],
    seed: null,
    workflow: '',          // '' = infer from inputs; or generate | image_to_video | first_last_frame | reference_to_video | edit | extend
    model_pref: { provider: '', model: '' },
  };
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

// Merge `over` into `base`. Empty strings / null / empty arrays in `over` do NOT
// override inherited values: a blank shot field means "inherit".
export function deepMerge(base, over) {
  if (!isObj(base)) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over ?? {})) {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) continue;
    out[k] = isObj(v) && isObj(base[k]) ? deepMerge(base[k], v) : v;
  }
  return out;
}

// Resolve the effective spec for a shot, plus a trace of where each top-level
// group came from (useful for the UI's "inherited" badges).
export function resolveSpec(projectSettings = {}, sceneSettings = {}, shotSpec = {}) {
  const projDefaults = projectSettings.shot_defaults ?? {};
  const sceneDefaults = sceneSettings.shot_defaults ?? {};
  const effective = deepMerge(deepMerge(deepMerge(defaultSpec(), projDefaults), sceneDefaults), shotSpec);
  // Project-wide references (e.g. a palette ref) are appended, not replaced.
  const inheritedRefs = [...(projectSettings.references ?? []), ...(sceneSettings.references ?? [])];
  if (inheritedRefs.length) {
    const seen = new Set(effective.references.map((r) => r.asset_id ?? r.ref));
    for (const r of inheritedRefs) if (!seen.has(r.asset_id ?? r.ref)) effective.references.push({ ...r, inherited: true });
  }
  return effective;
}

const ENUM_FIELDS = [
  ['framing.shot_size', 'shot_size'], ['framing.angle', 'angle'], ['camera.movement', 'movement'],
  ['camera.speed', 'speed'], ['camera.rig', 'rig'], ['lens.character', 'lens_character'], ['lens.dof', 'dof'],
  ['lighting.key_direction', 'key_direction'], ['lighting.quality', 'light_quality'], ['lighting.contrast', 'contrast'],
  ['lighting.time_of_day', 'time_of_day'], ['atmosphere.type', 'atmosphere'], ['pacing.tempo', 'tempo'],
  ['look.genre', 'genre'], ['look.era', 'era'], ['look.texture', 'texture'], ['look.camera_body', 'camera_body'],
];

export const get = (obj, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), obj);

const REF_ROLES = new Set(['first_frame', 'last_frame', 'reference_image', 'reference_video', 'reference_audio']);

// Provider-independent validation. Provider-specific limits are checked by the adapter.
export function validateSpec(spec) {
  const errors = [];
  const warnings = [];
  if (!spec.intent?.summary && !spec.intent?.action && !spec.timeline?.length) errors.push('intent.summary or intent.action is required');
  if (!(Number(spec.duration_s) > 0)) errors.push('duration_s must be > 0');
  if (!/^\d+:\d+$/.test(spec.aspect ?? '') && spec.aspect !== 'adaptive') errors.push(`aspect "${spec.aspect}" must look like 16:9`);
  for (const [p, cat] of ENUM_FIELDS) {
    const v = get(spec, p);
    if (v && !VOCAB[cat].some((x) => x.id === v)) errors.push(`${p}: unknown value "${v}"`);
  }
  const ap = Number(spec.lens?.aperture);
  if (ap && ap <= 2.8 && spec.lens?.dof === 'deep') warnings.push(`aperture f/${ap} contradicts "deep focus" — the prompt will say both; pick one`);
  if (ap && ap >= 8 && ['shallow', 'very_shallow'].includes(spec.lens?.dof)) warnings.push(`aperture f/${ap} contradicts "${spec.lens.dof}" depth of field`);
  const moves = spec.camera?.moves ?? [];
  if (!Array.isArray(moves)) errors.push('camera.moves must be a list');
  else {
    for (const m of moves) if (!VOCAB.movement.some((x) => x.id === m)) errors.push(`camera.moves: unknown move "${m}"`);
    if (moves.length > 4) warnings.push(`${moves.length} camera moves in one shot — models rarely follow more than 2–3; consider splitting the shot`);
  }
  if (spec.lens?.focal_mm != null && !(spec.lens.focal_mm >= 4 && spec.lens.focal_mm <= 1200)) errors.push('lens.focal_mm out of range 4–1200');
  if (spec.lens?.aperture != null && !(spec.lens.aperture >= 0.7 && spec.lens.aperture <= 32)) errors.push('lens.aperture out of range f/0.7–f/32');
  for (const hex of spec.look?.palette ?? []) if (!/^#[0-9a-f]{6}$/i.test(hex)) errors.push(`look.palette: "${hex}" is not #RRGGBB`);
  for (const r of spec.references ?? []) {
    if (!REF_ROLES.has(r.role)) errors.push(`reference role "${r.role}" is not one of ${[...REF_ROLES].join(', ')}`);
    if (!r.asset_id && !r.ref) errors.push('each reference needs asset_id or ref');
  }
  const ff = (spec.references ?? []).filter((r) => r.role === 'first_frame').length;
  const lf = (spec.references ?? []).filter((r) => r.role === 'last_frame').length;
  if (ff > 1) errors.push('only one first_frame reference allowed');
  if (lf > 1) errors.push('only one last_frame reference allowed');
  if (lf && !ff) errors.push('last_frame requires a first_frame');

  // Timed beats must be contiguous (no gaps/overlaps) and end at the declared duration.
  const tl = spec.timeline ?? [];
  if (tl.length) {
    if (Number(tl[0].start_s) !== 0) errors.push('timeline must start at 0s');
    for (let i = 0; i < tl.length; i++) {
      const b = tl[i];
      if (!(Number(b.end_s) > Number(b.start_s))) errors.push(`timeline beat ${i + 1}: end must be after start`);
      if (i > 0 && Number(tl[i - 1].end_s) !== Number(b.start_s)) errors.push(`timeline beat ${i + 1} starts at ${b.start_s}s but previous ends at ${tl[i - 1].end_s}s`);
    }
    if (Number(tl.at(-1).end_s) !== Number(spec.duration_s)) errors.push(`timeline ends at ${tl.at(-1).end_s}s but duration is ${spec.duration_s}s`);
  }
  for (const d of spec.dialogue ?? []) {
    if (!d.line) errors.push('dialogue entries need a line');
    if (d.end_s != null && Number(d.end_s) > Number(spec.duration_s)) errors.push(`dialogue "${d.line?.slice(0, 20)}" ends after the shot`);
  }
  if ((spec.dialogue ?? []).length && !spec.audio?.generate) warnings.push('dialogue present but audio.generate is off: lines will be described visually only');
  if (spec.camera?.movement && spec.camera.movement !== 'static' && spec.camera.rig === 'tripod' && !['pan_left', 'pan_right', 'tilt_up', 'tilt_down'].includes(spec.camera.movement))
    warnings.push(`camera.rig "tripod" conflicts with movement "${spec.camera.movement}" — rig phrase will be dropped`);
  return { ok: errors.length === 0, errors, warnings };
}
