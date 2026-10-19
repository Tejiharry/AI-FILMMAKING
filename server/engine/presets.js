// Built-in, partial ShotSpecs. Applying a preset deep-merges it into the shot.
import { now, uid } from '../db.js';

export const BUILTIN_PRESETS = [
  { kind: 'shot', name: 'Intimate confession (CU, slow push)', data: {
    framing: { shot_size: 'CU', angle: 'eye_level' }, camera: { movement: 'push_in', speed: 'very_slow', rig: 'dolly' },
    lens: { focal_mm: 85, character: 'spherical', aperture: 1.8, dof: 'very_shallow' },
    lighting: { key_direction: 'rembrandt', quality: 'soft', contrast: 'low_key', color_temp_k: 3200 }, pacing: { tempo: 'still' } } },
  { kind: 'shot', name: 'Establishing wide (golden hour)', data: {
    framing: { shot_size: 'EWS', angle: 'high' }, camera: { movement: 'aerial', speed: 'slow', rig: 'drone' },
    lens: { focal_mm: 24, dof: 'deep', aperture: 8 }, lighting: { time_of_day: 'golden', quality: 'soft', color_temp_k: 3800 }, atmosphere: { type: 'haze' } } },
  { kind: 'shot', name: 'Dialogue over-the-shoulder', data: {
    framing: { shot_size: 'OTS', angle: 'eye_level' }, camera: { movement: 'static', rig: 'tripod' },
    lens: { focal_mm: 50, aperture: 2.8, dof: 'shallow' }, lighting: { key_direction: 'side_left', quality: 'soft', contrast: 'natural' } } },
  { kind: 'shot', name: 'Handheld tension (MCU)', data: {
    framing: { shot_size: 'MCU', angle: 'eye_level' }, camera: { movement: 'handheld', speed: 'medium', rig: 'handheld' },
    lens: { focal_mm: 35, aperture: 2.8, dof: 'shallow' }, lighting: { contrast: 'low_key', quality: 'hard' }, pacing: { tempo: 'brisk' } } },
  { kind: 'shot', name: 'Realization (dolly zoom)', data: {
    framing: { shot_size: 'MCU', angle: 'eye_level' }, camera: { movement: 'dolly_zoom', speed: 'slow', rig: 'dolly' },
    lens: { focal_mm: 35, dof: 'medium' }, pacing: { tempo: 'slow' } } },
  { kind: 'shot', name: 'Walk-and-talk (leading steadicam)', data: {
    framing: { shot_size: 'MS', angle: 'eye_level' }, camera: { movement: 'lead', speed: 'medium', rig: 'steadicam' },
    lens: { focal_mm: 32, aperture: 2.8, dof: 'medium' }, lighting: { contrast: 'natural' } } },
  { kind: 'shot', name: 'Product hero orbit', data: {
    framing: { shot_size: 'CU', angle: 'low' }, camera: { movement: 'orbit', speed: 'slow', rig: 'crane' },
    lens: { focal_mm: 100, character: 'macro', aperture: 4, dof: 'shallow' }, lighting: { key_direction: 'back', quality: 'hard', contrast: 'low_key' }, atmosphere: { type: 'haze' } } },
  { kind: 'shot', name: 'Noir interrogation', data: {
    framing: { shot_size: 'MCU', angle: 'low' }, camera: { movement: 'static', rig: 'tripod' },
    lighting: { key_direction: 'top', quality: 'hard', contrast: 'low_key', color_temp_k: 3000 }, atmosphere: { type: 'smoke' }, look: { genre: 'noir', texture: '35mm' } } },
  { kind: 'look', name: 'Warm dramedy', data: {
    look: { genre: 'dramedy', texture: '35mm', camera_body: 'large_format', palette: ['#E8B07A', '#2F4A5A', '#F3E6D3', '#8C3B2E'], grade_notes: 'warm skin, gentle contrast, soft highlight roll-off' },
    lighting: { contrast: 'natural', quality: 'soft' } } },
  { kind: 'look', name: 'Night thriller (teal/sodium)', data: {
    look: { genre: 'thriller', texture: 'digital_clean', camera_body: 'super35', palette: ['#0F2A33', '#1F6F78', '#E39B3B', '#0A0A0C'], grade_notes: 'teal shadows, sodium-orange practicals, crushed blacks' },
    lighting: { time_of_day: 'night', contrast: 'low_key' }, atmosphere: { type: 'rain' } } },
  { kind: 'look', name: 'Soft romance', data: {
    lens: { character: 'vintage' },
    look: { genre: 'romance', texture: '35mm', palette: ['#F2C6C2', '#F7E7CE', '#9DB4A0', '#5E4B56'], grade_notes: 'lifted blacks, pastel highlights, gentle halation' },
    lighting: { time_of_day: 'golden', quality: 'soft', contrast: 'high_key' } } },
];

export function seedPresets(db) {
  const have = db.prepare('SELECT COUNT(*) n FROM presets WHERE builtin = 1').get().n;
  if (have) return;
  const ins = db.prepare('INSERT INTO presets (id, project_id, kind, name, data_json, builtin, created_at) VALUES (?,?,?,?,?,1,?)');
  for (const p of BUILTIN_PRESETS) ins.run(uid(), null, p.kind, p.name, JSON.stringify(p.data), now());
}
