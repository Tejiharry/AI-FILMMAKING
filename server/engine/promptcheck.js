// Pre-send prompt checks: catch problems before a generation is queued (and before money is spent).
// errors block the request; warnings are shown in the plan. Our own rules — heuristic where noted.

const WORDS = (s) => String(s ?? '').split(/\s+/).filter(Boolean).length;
const has = (text, re) => re.test(String(text ?? ''));

// Free-text fields where a filmmaker might type @handles.
function textFields(spec) {
  const out = [['intent.summary', spec.intent?.summary], ['intent.action', spec.intent?.action], ['framing.composition', spec.framing?.composition],
    ['camera.notes', spec.camera?.notes], ['location', spec.location], ['lighting.motivation', spec.lighting?.motivation]];
  (spec.subjects ?? []).forEach((s, i) => out.push([`subjects[${i}].blocking`, s.blocking], [`subjects[${i}].wardrobe`, s.wardrobe]));
  (spec.timeline ?? []).forEach((b, i) => out.push([`timeline[${i}].action`, b.action]));
  return out.filter(([, v]) => v);
}

export function checkPrompt(spec, { refsByHandle = {}, caps = {}, prompt = '' } = {}) {
  const errors = [], warnings = [];

  // 1. Every @handle must exist in the reference library (else "@name" leaks into the prompt as literal text).
  const known = new Set(Object.keys(refsByHandle));
  for (const [field, text] of textFields(spec)) {
    for (const m of String(text).matchAll(/@[a-z0-9_]+/gi)) {
      const hnd = m[0].toLowerCase();
      if (!known.has(hnd)) errors.push(`${field}: ${m[0]} is not in Reference Studio — create it or remove the @`);
    }
  }
  for (const s of spec.subjects ?? []) if (s.ref && !known.has(s.ref)) errors.push(`subject ${s.ref} is not in Reference Studio`);
  for (const d of spec.dialogue ?? []) if (d.speaker && !known.has(d.speaker)) errors.push(`dialogue speaker ${d.speaker} is not in Reference Studio`);

  // 2. Word budget: long prompts dilute adherence; providers may document a ceiling.
  const words = WORDS(prompt);
  const ceiling = caps.prompt_words_max ?? 1000;
  if (words > ceiling) errors.push(`prompt is ${words} words — over this model's ${ceiling}-word limit`);
  else if (words > 220) warnings.push(`prompt is ${words} words — past ~200 words models start dropping details; move story into timed beats or split the shot`);

  // 3. Dialogue vs sound: speakers on screen, no overlapping lines, quoted speech listed.
  const subjects = new Set((spec.subjects ?? []).map((s) => s.ref));
  for (const d of spec.dialogue ?? []) if (d.speaker && !subjects.has(d.speaker)) warnings.push(`${d.speaker} speaks but is not a subject of this shot — add them or mark the line as off-screen`);
  const timed = (spec.dialogue ?? []).filter((d) => d.start_s != null && d.end_s != null).sort((a, b) => a.start_s - b.start_s);
  for (let i = 1; i < timed.length; i++) if (timed[i].start_s < timed[i - 1].end_s && timed[i].speaker !== timed[i - 1].speaker)
    warnings.push(`dialogue overlaps: "${timed[i - 1].line.slice(0, 24)}…" and "${timed[i].line.slice(0, 24)}…" — overlapping speech is rarely rendered cleanly`);
  const quoted = [...String(spec.intent?.summary ?? '').matchAll(/"([^"]{3,})"/g)].map((m) => m[1].trim());
  for (const q of quoted) if (!(spec.dialogue ?? []).some((d) => d.line?.trim() === q)) warnings.push(`quoted line "${q.slice(0, 40)}" is in the description but not in the dialogue list — it won't be timed or voiced as dialogue`);
  if ((spec.dialogue ?? []).length && spec.audio?.generate && caps.audio === false) errors.push('dialogue with audio requested, but this model has no audio output');

  // 4. Contradictions between settings and the written description (heuristic word checks).
  const text = `${spec.intent?.summary ?? ''} ${spec.intent?.action ?? ''}`.toLowerCase();
  const tod = spec.lighting?.time_of_day;
  if (tod === 'night' && has(text, /\b(sunlight|sunny|midday|noon|daylight|sun-drenched)\b/)) warnings.push('time of day is Night but the description mentions daylight');
  if (['day', 'golden', 'overcast'].includes(tod) && has(text, /\b(moonlight|midnight|starry|pitch[- ]dark)\b/)) warnings.push(`time of day is ${tod} but the description mentions night`);
  const size = spec.framing?.shot_size;
  if (['CU', 'ECU', 'INSERT'].includes(size) && has(text, /\b(full[- ]body|head to toe|wide shot|whole room|establishing)\b/)) warnings.push(`shot size ${size} conflicts with "wide/full body" wording in the description`);
  if (['EWS', 'WS'].includes(size) && has(text, /\b(close[- ]up|extreme close|macro)\b/)) warnings.push(`shot size ${size} conflicts with close-up wording in the description`);
  if (spec.camera?.movement === 'static' && ((spec.camera?.moves ?? []).some((m) => m !== 'static') || (spec.timeline ?? []).some((b) => b.camera && b.camera !== 'static')))
    warnings.push('camera is Locked off but the move stack / timed beats ask for movement');
  if (spec.camera?.movement === 'static' && has(text, /\b(camera (pushes|pulls|pans|tilts|tracks|follows|orbits|cranes)|dolly|tracking shot|handheld)\b/)) warnings.push('camera is Locked off but the description describes camera movement');
  if (Number(spec.lens?.focal_mm) >= 85 && size === 'EWS') warnings.push(`${spec.lens.focal_mm}mm telephoto on an extreme wide shot — unusual; check the lens or the size`);
  for (const n of spec.negative ?? []) {
    const w = String(n).toLowerCase().trim();
    if (w.length > 2 && new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text)) warnings.push(`"${n}" is in Avoid but also in the description`);
  }
  if (has(text, /\b(no cuts?|one continuous|single take|oner)\b/) && (spec.timeline ?? []).some((b) => has(b.action, /\bcut to\b/i))) warnings.push('description asks for one continuous take but a timed beat says "cut to"');
  return { errors, warnings, words };
}
