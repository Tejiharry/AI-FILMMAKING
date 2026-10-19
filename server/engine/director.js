// AI Director, deterministic tier: screenplay -> scenes -> coverage shots.
// Works offline with no LLM. It applies standard coverage grammar (establish,
// cover each speaker, inserts for handled objects, closer sizes for emotional
// beats) and emits provider-independent ShotSpec partials. An optional LLM tier
// (director-llm.js) can refine the result; this tier is the reproducible baseline.

const HEADING = /^(?:\d+[.)]?\s*)?(INT\.?\/EXT\.?|EXT\.?\/INT\.?|INT\.?|EXT\.?|I\/E\.?)\s+(.+?)(?:\s+[-–—]\s+(.+))?$/i;
const SCENE_WORD = /^SCENE\s+(\d+)\s*[:.-]?\s*(.*)$/i;
const CUE = /^([A-Z][A-Z0-9 .'\-]{1,30})(\s*\((?:V\.O\.|O\.S\.|O\.C\.|CONT'D|CONT’D)\))?$/;
const TRANSITION = /^(CUT TO:|FADE (IN|OUT)[.:]?|DISSOLVE TO:|SMASH CUT TO:|MATCH CUT TO:)$/i;

const TOD = { DAY: 'day', NIGHT: 'night', MORNING: 'dawn', DAWN: 'dawn', DUSK: 'golden', EVENING: 'blue_hour', SUNSET: 'golden', 'GOLDEN HOUR': 'golden', CONTINUOUS: '', LATER: '' };

const EMOTION_WORDS = /\b(cries|crying|tears|sob|whisper|whispers|trembl|furious|angry|screams?|shout|panic|shock|stunned|breaks down|smiles? softly|hesitat|swallows|realiz|devastat|terrified)\w*/i;
const MOVE_WORDS = /\b(walks?|runs?|enters?|exits?|crosses|paces|follows?|chases?|drives?|rushes|storms? (in|out|off))\b/i;
const LOOK_WORDS = /\b(looks?|stares?|glances?|watches|notices|sees|eyes)\b/i;
const OBJECT_WORDS = /\b(phone|letter|ring|photo|photograph|key|keys|gun|knife|note|envelope|screen|laptop|watch|document|file|card|bottle|glass|cup|money|cash|degree|certificate)\b/i;

export function parseScreenplay(text) {
  const lines = String(text).replace(/\r/g, '').split('\n');
  const scenes = [];
  let cur = null;
  let speaker = null;
  const ensure = () => { if (!cur) { cur = { heading: 'UNTITLED SCENE', int_ext: '', location: '', time: '', elements: [] }; scenes.push(cur); } };
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line) { speaker = null; continue; }
    let m;
    if ((m = HEADING.exec(line)) && line === line.toUpperCase()) {
      cur = { heading: line, int_ext: m[1].toUpperCase().replace(/\.$/, ''), location: m[2].trim(), time: (m[3] ?? '').trim().toUpperCase(), elements: [] };
      scenes.push(cur); speaker = null; continue;
    }
    if ((m = SCENE_WORD.exec(line))) {
      cur = { heading: line, int_ext: '', location: m[2].trim(), time: '', elements: [] };
      scenes.push(cur); speaker = null; continue;
    }
    if (TRANSITION.test(line)) { ensure(); cur.elements.push({ type: 'transition', text: line }); speaker = null; continue; }
    if (CUE.test(line) && line === line.toUpperCase() && !/[.!?]$/.test(line.replace(/\((V\.O\.|O\.S\.|O\.C\.)\)/, '')) && lines[i + 1]?.trim()) {
      ensure(); speaker = CUE.exec(line)[1].trim(); continue;
    }
    ensure();
    if (speaker) {
      if (/^\(.*\)$/.test(line)) { cur.elements.push({ type: 'parenthetical', speaker, text: line.slice(1, -1) }); continue; }
      const last = cur.elements.at(-1);
      if (last?.type === 'dialogue' && last.speaker === speaker) last.text += ' ' + line;
      else cur.elements.push({ type: 'dialogue', speaker, text: line });
    } else {
      const last = cur.elements.at(-1);
      if (last?.type === 'action' && !/^\s*$/.test(lines[i - 1] ?? '')) last.text += ' ' + line;
      else cur.elements.push({ type: 'action', text: line });
    }
  }
  return scenes;
}

export const handleFor = (name) => '@' + String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

const clampDur = (s) => Math.max(4, Math.min(15, Math.round(s)));
const speechSeconds = (t) => t.split(/\s+/).filter(Boolean).length / 2.5 + 1.2;

// Build coverage shots for one parsed scene.
export function coverScene(scene, { knownHandles = new Set(), maxShots = 40 } = {}) {
  const shots = [];
  const tod = TOD[scene.time] ?? '';
  const location = scene.location ? `${scene.int_ext === 'EXT' ? 'exterior' : scene.int_ext === 'INT' ? 'interior' : ''} ${scene.location.toLowerCase()}`.trim() : '';
  const speakers = [...new Set(scene.elements.filter((e) => e.type === 'dialogue').map((e) => e.speaker))];
  const subj = (name, extra = {}) => ({ ref: handleFor(name), ...extra });
  const add = (title, spec, why) => { if (shots.length < maxShots) shots.push({ title, spec, rationale: why }); };
  const lighting = { time_of_day: scene.int_ext === 'INT' && !tod ? 'interior' : tod };

  add(`Establish — ${scene.location || 'location'}`, {
    intent: { summary: `Establishing view of ${location || 'the location'}${scene.time ? `, ${scene.time.toLowerCase()}` : ''}.`, beat: 'establish' },
    framing: { shot_size: scene.int_ext === 'EXT' ? 'EWS' : 'WS', angle: scene.int_ext === 'EXT' ? 'high' : 'eye_level' },
    camera: { movement: scene.int_ext === 'EXT' ? 'aerial' : 'push_in', speed: 'slow', rig: scene.int_ext === 'EXT' ? 'drone' : 'dolly' },
    lens: { focal_mm: 24, dof: 'deep' }, lighting, duration_s: 5,
  }, 'Every scene opens with geography so the audience knows where and when they are.');

  let lastSpeaker = null;
  let firstExchange = true;
  for (const e of scene.elements) {
    if (e.type === 'action') {
      const names = [...speakers, ...[...knownHandles].map((h) => h.slice(1).toUpperCase())].filter((n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(e.text));
      const who = [...new Set(names)].map((n) => subj(n));
      if (OBJECT_WORDS.test(e.text)) {
        const obj = OBJECT_WORDS.exec(e.text)[1];
        add(`Insert — ${obj}`, { intent: { summary: `Insert: ${obj}.`, action: e.text, beat: 'insert' }, framing: { shot_size: 'INSERT', angle: 'high' },
          camera: { movement: 'push_in', speed: 'very_slow', rig: 'dolly' }, lens: { focal_mm: 100, character: 'macro', dof: 'shallow', aperture: 2.8 }, lighting, subjects: who, duration_s: 4 },
          `Action handles an object (${obj}); an insert makes the plot point read.`);
      }
      const moving = MOVE_WORDS.test(e.text);
      const emotional = EMOTION_WORDS.test(e.text);
      const looking = LOOK_WORDS.test(e.text);
      add(emotional ? 'Reaction CU' : moving ? 'Movement' : 'Action', {
        intent: { summary: e.text.slice(0, 240), action: e.text, emotion: emotional ? EMOTION_WORDS.exec(e.text)[0] : '', beat: 'action' },
        framing: { shot_size: emotional ? 'CU' : moving ? 'MWS' : looking ? 'MCU' : 'MS', angle: 'eye_level' },
        camera: emotional ? { movement: 'push_in', speed: 'very_slow', rig: 'dolly' } : moving ? { movement: 'tracking', speed: 'medium', rig: 'steadicam' } : { movement: 'static', rig: 'tripod' },
        lens: { focal_mm: emotional ? 85 : moving ? 32 : 50, dof: emotional ? 'very_shallow' : 'shallow', aperture: emotional ? 1.8 : 2.8 },
        lighting, subjects: who, duration_s: clampDur(e.text.split(/\s+/).length / 4 + 3),
      }, emotional ? 'Emotional beat: the change has to play on the face, so go tight and slow.' : moving ? 'Physical movement: follow it so geography stays clear.' : 'Plain action: medium coverage.');
    } else if (e.type === 'dialogue') {
      const listener = speakers.find((s) => s !== e.speaker);
      const emotional = EMOTION_WORDS.test(e.text) || /!{1,}|\?!/.test(e.text);
      const dur = clampDur(speechSeconds(e.text));
      if (firstExchange && speakers.length >= 2) {
        add(`Two-shot — ${speakers.slice(0, 2).join(' & ')}`, {
          intent: { summary: `${speakers[0]} and ${speakers[1]} in conversation.`, beat: 'dialogue_geography' },
          framing: { shot_size: '2S', angle: 'eye_level' }, camera: { movement: 'static', rig: 'tripod' },
          lens: { focal_mm: 40, dof: 'medium' }, lighting, subjects: speakers.slice(0, 2).map((n) => subj(n)), duration_s: dur,
          dialogue: [{ speaker: handleFor(e.speaker), line: e.text }],
        }, 'First exchange: a two-shot sets the eyeline and screen direction before singles.');
        firstExchange = false; lastSpeaker = e.speaker; continue;
      }
      add(`${e.speaker} — ${emotional ? 'CU' : listener ? 'OTS' : 'MCU'}`, {
        intent: { summary: `${e.speaker} speaks${listener ? ` to ${listener}` : ''}.`, emotion: emotional ? 'heightened' : '', beat: 'dialogue' },
        framing: { shot_size: emotional ? 'CU' : listener ? 'OTS' : 'MCU', angle: 'eye_level', composition: listener ? `${listener} soft in the foreground` : '' },
        camera: emotional ? { movement: 'push_in', speed: 'very_slow', rig: 'dolly' } : { movement: 'static', rig: 'tripod' },
        lens: { focal_mm: emotional ? 85 : 50, dof: 'shallow', aperture: 2 }, lighting,
        subjects: [subj(e.speaker), ...(listener ? [subj(listener, { blocking: 'foreground, back to camera' })] : [])],
        dialogue: [{ speaker: handleFor(e.speaker), line: e.text }], duration_s: dur,
      }, emotional ? 'Heightened line: closer size and a slow push carry the emotion.' : 'Standard single for the speaker; over-the-shoulder keeps the listener present.');
      if (lastSpeaker && lastSpeaker !== e.speaker && emotional && listener) {
        add(`${listener} — reaction`, {
          intent: { summary: `${listener} reacts silently to ${e.speaker}.`, beat: 'reaction', emotion: 'reaction' },
          framing: { shot_size: 'CU', angle: 'eye_level' }, camera: { movement: 'static', rig: 'tripod' },
          lens: { focal_mm: 85, dof: 'very_shallow', aperture: 1.8 }, lighting, subjects: [subj(listener)], duration_s: 4,
        }, 'A strong line creates a reaction; cover the listener so the cut can land on their face.');
      }
      lastSpeaker = e.speaker;
    }
  }
  return shots;
}

export function breakdown(text, opts = {}) {
  const scenes = parseScreenplay(text);
  const characters = [...new Set(scenes.flatMap((s) => s.elements.filter((e) => e.type === 'dialogue').map((e) => e.speaker)))];
  return {
    characters: characters.map((c) => ({ name: c, handle: handleFor(c) })),
    scenes: scenes.map((s) => ({ heading: s.heading, location: s.location, time: s.time, int_ext: s.int_ext, element_count: s.elements.length, shots: coverScene(s, opts) })),
  };
}
