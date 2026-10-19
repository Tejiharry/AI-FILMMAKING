// Cinematography vocabulary. Each option carries the phrasing the prompt compiler
// uses. None of these are physical camera controls: unless a provider adapter maps
// a field to a documented API parameter, it is delivered as a best-effort prompt
// instruction and the compile report says so.

const o = (id, label, phrase) => ({ id, label, phrase });

export const VOCAB = {
  shot_size: [
    o('EWS', 'Extreme wide', 'extreme wide shot, subject small in a vast frame'),
    o('WS', 'Wide', 'wide shot showing the whole space'),
    o('FS', 'Full', 'full shot, subject head to toe filling the frame height'),
    o('MWS', 'Medium wide', 'medium wide shot, framed from the knees up'),
    o('MS', 'Medium', 'medium shot, framed from the waist up'),
    o('MCU', 'Medium close-up', 'medium close-up, framed from mid-chest up'),
    o('CU', 'Close-up', 'close-up, face fills most of the frame'),
    o('ECU', 'Extreme close-up', 'extreme close-up on a single detail'),
    o('INSERT', 'Insert', 'insert shot of a specific object or detail'),
    o('OTS', 'Over-the-shoulder', 'over-the-shoulder shot, foreground shoulder soft in frame'),
    o('2S', 'Two-shot', 'two-shot, both characters in frame'),
  ],
  angle: [
    o('eye_level', 'Eye level', 'eye-level camera'),
    o('low', 'Low angle', 'low-angle camera looking up at the subject'),
    o('high', 'High angle', 'high-angle camera looking down at the subject'),
    o('overhead', 'Overhead / top-down', 'top-down overhead camera'),
    o('dutch', 'Dutch tilt', 'dutch angle, horizon tilted'),
    o('ground', 'Ground level', 'camera at ground level'),
    o('pov', 'POV', 'point-of-view shot from the character\'s eyes'),
  ],
  movement: [
    o('static', 'Locked off', 'locked-off static camera, no camera movement'),
    o('push_in', 'Push in (dolly in)', 'dolly push-in toward the subject'),
    o('pull_out', 'Pull out (dolly out)', 'dolly pull-back away from the subject'),
    o('truck_left', 'Truck left', 'camera trucks sideways to the left'),
    o('truck_right', 'Truck right', 'camera trucks sideways to the right'),
    o('pan_left', 'Pan left', 'camera pans left on a fixed axis'),
    o('pan_right', 'Pan right', 'camera pans right on a fixed axis'),
    o('tilt_up', 'Tilt up', 'camera tilts up'),
    o('tilt_down', 'Tilt down', 'camera tilts down'),
    o('pedestal_up', 'Pedestal / crane up', 'camera cranes upward'),
    o('crane_down', 'Crane down', 'camera cranes down'),
    o('orbit', 'Orbit / arc', 'camera arcs around the subject'),
    o('tracking', 'Tracking / follow', 'camera tracks alongside the moving subject'),
    o('lead', 'Leading', 'camera leads the subject, moving backward as they walk toward it'),
    o('handheld', 'Handheld', 'handheld camera with subtle natural shake'),
    o('crash_zoom', 'Crash zoom', 'fast crash zoom into the subject'),
    o('dolly_zoom', 'Dolly zoom (vertigo)', 'dolly zoom, background perspective warps while subject size holds'),
    o('fpv', 'FPV drone', 'fast FPV drone flight through the space'),
    o('aerial', 'Aerial', 'smooth aerial drone shot'),
    o('whip_pan', 'Whip pan', 'fast whip pan with motion blur'),
  ],
  speed: [o('very_slow', 'Very slow', 'very slow, barely perceptible'), o('slow', 'Slow', 'slow and deliberate'),
    o('medium', 'Medium', 'measured pace'), o('fast', 'Fast', 'fast and energetic')],
  rig: [o('tripod', 'Tripod', 'on a tripod'), o('dolly', 'Dolly', 'on a dolly track'), o('steadicam', 'Steadicam', 'on a steadicam, floating and smooth'),
    o('gimbal', 'Gimbal', 'on a gimbal'), o('handheld', 'Handheld', 'handheld'), o('crane', 'Crane', 'on a crane'), o('drone', 'Drone', 'from a drone')],
  lens_character: [o('spherical', 'Spherical (clean)', 'clean spherical lens rendering'),
    o('anamorphic', 'Anamorphic', 'anamorphic lens, oval bokeh, horizontal flares, slight edge distortion'),
    o('vintage', 'Vintage glass', 'vintage lens with soft contrast and gentle halation'),
    o('macro', 'Macro', 'macro lens, extreme close focus'),
    o('fisheye', 'Fisheye', 'fisheye lens, strong barrel distortion')],
  dof: [o('deep', 'Deep focus', 'deep focus, foreground to background sharp'), o('medium', 'Moderate', 'moderate depth of field'),
    o('shallow', 'Shallow', 'shallow depth of field, background softly blurred'), o('very_shallow', 'Very shallow', 'razor-thin depth of field, creamy bokeh')],
  key_direction: [o('front', 'Front', 'frontal key light'), o('side_left', 'Side (left)', 'key light from camera left, side-lit'),
    o('side_right', 'Side (right)', 'key light from camera right, side-lit'), o('back', 'Back / rim', 'strong backlight rimming the subject'),
    o('top', 'Top', 'overhead top light'), o('under', 'Under', 'underlighting from below'),
    o('rembrandt', 'Rembrandt', 'Rembrandt lighting with a triangle of light on the shadow cheek'),
    o('silhouette', 'Silhouette', 'subject silhouetted against a bright background')],
  light_quality: [o('soft', 'Soft', 'soft diffused light'), o('hard', 'Hard', 'hard light with crisp shadows'), o('mixed', 'Mixed', 'mixed soft key with hard accents')],
  contrast: [o('low_key', 'Low key', 'low-key lighting, deep shadows, high contrast'), o('high_key', 'High key', 'high-key lighting, bright and low contrast'),
    o('natural', 'Naturalistic', 'naturalistic motivated lighting')],
  time_of_day: [o('dawn', 'Dawn', 'at dawn, cool blue light'), o('golden', 'Golden hour', 'golden hour, warm low sun'),
    o('day', 'Midday', 'midday daylight'), o('overcast', 'Overcast', 'overcast diffuse daylight'),
    o('blue_hour', 'Blue hour', 'blue hour twilight'), o('night', 'Night', 'at night'), o('interior', 'Interior practicals', 'interior lit by practical lamps')],
  atmosphere: [o('clear', 'Clear', 'clear air'), o('haze', 'Haze', 'light atmospheric haze catching the light'), o('fog', 'Fog', 'dense fog'),
    o('rain', 'Rain', 'falling rain, wet reflective surfaces'), o('snow', 'Snow', 'falling snow'), o('dust', 'Dust motes', 'dust motes floating in shafts of light'),
    o('smoke', 'Smoke', 'drifting smoke')],
  tempo: [o('still', 'Still', 'still, contemplative pacing'), o('slow', 'Slow', 'slow, unhurried pacing'), o('measured', 'Measured', 'measured natural pacing'),
    o('brisk', 'Brisk', 'brisk pacing'), o('frenetic', 'Frenetic', 'frenetic, high-energy pacing')],
  genre: ['drama', 'comedy', 'dramedy', 'thriller', 'horror', 'romance', 'action', 'sci-fi', 'documentary', 'music video', 'commercial', 'noir', 'western', 'fantasy']
    .map((g) => o(g, g[0].toUpperCase() + g.slice(1), `${g} film`)),
  era: [o('contemporary', 'Contemporary', 'contemporary setting'), o('80s', '1980s', '1980s period look'), o('70s', '1970s', '1970s period look'),
    o('50s', '1950s', '1950s period look'), o('future', 'Near future', 'near-future setting')],
  texture: [o('digital_clean', 'Clean digital', 'clean modern digital cinema image'), o('35mm', '35mm film', 'shot on 35mm film, fine natural grain'),
    o('16mm', '16mm film', '16mm film texture, visible grain'), o('vhs', 'VHS', 'VHS tape texture, chroma bleed')],
  camera_body: [
    // Sensor-style presets: purely an aesthetic prompt hint. No model emulates a sensor deterministically.
    o('large_format', 'Large-format digital', 'large-format digital cinema look, wide dynamic range'),
    o('super35', 'Super 35 digital', 'Super 35 digital cinema look'),
    o('film_35', '35mm film camera', '35mm motion-picture film camera look'),
    o('16mm', '16mm film camera', '16mm film camera look'),
    o('phone', 'Smartphone', 'smartphone camera look, deep focus, slight sharpening'),
    o('vhs_cam', 'Camcorder', 'consumer camcorder look'),
  ],
};

export function phraseFor(category, id) {
  const opt = VOCAB[category]?.find((x) => x.id === id);
  return opt ? opt.phrase : null;
}

export function focalPhrase(mm) {
  if (!mm) return null;
  const n = Number(mm);
  if (n <= 16) return `${n}mm ultra-wide lens, exaggerated perspective`;
  if (n <= 28) return `${n}mm wide lens`;
  if (n <= 40) return `${n}mm lens, natural wide-normal perspective`;
  if (n <= 60) return `${n}mm normal lens`;
  if (n <= 100) return `${n}mm portrait lens, gentle compression`;
  return `${n}mm telephoto lens, strong background compression`;
}

export function aperturePhrase(f) {
  if (!f) return null;
  const n = Number(f);
  if (n <= 2) return `shot wide open around f/${n}`;
  if (n <= 4) return `around f/${n}`;
  return `stopped down to about f/${n}`;
}

export function colorTempPhrase(k) {
  if (!k) return null;
  const n = Number(k);
  if (n < 3000) return `very warm ${n}K tungsten-candle light`;
  if (n < 4000) return `warm ${n}K tungsten light`;
  if (n < 5000) return `neutral-warm ${n}K light`;
  if (n < 6500) return `neutral daylight around ${n}K`;
  return `cool ${n}K blue-toned light`;
}
