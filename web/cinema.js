// OG Cinema Studio composer: setting tiles, @-mention prompt, chip toolbar, live cost,
// and the setting modals (reels, move grid + ordered stack, lighting, palettes).
// Own design; UX patterns informed by docs/research/higgsfield-ui-study.md.

// ------------------------------------------------------------------ option metadata (our wording)
export const GENRE_INFO = {
  drama: 'grounded light, patient coverage', comedy: 'brighter key, wider frames for timing', dramedy: 'warm naturalism, room for reactions',
  thriller: 'low key, tight frames, tension', horror: 'deep shadow, negative space', romance: 'soft key, warm glow, shallow focus',
  action: 'wide lenses, dynamic moves', 'sci-fi': 'cool palette, graphic composition', documentary: 'handheld, available light',
  'music video': 'stylised light, bold colour', commercial: 'clean, bright, product-forward', noir: 'hard top light, smoke, contrast',
  western: 'sun-baked, wide vistas', fantasy: 'lush colour, glow, scale',
};
export const FOCALS = [
  [14, 'Ultra-wide · exaggerated space'], [18, 'Ultra-wide · environment'], [24, 'Wide · establishing'], [28, 'Wide · walk-and-talk'],
  [35, 'Natural wide · documentary feel'], [40, 'Normal-wide · intimate group'], [50, 'Normal · human eye'], [65, 'Short tele · flattering'],
  [85, 'Portrait · close-ups'], [100, 'Portrait tele · isolation'], [135, 'Tele · compression'], [200, 'Long tele · stacked background'],
];
export const APERTURES = [
  [1.4, 'Wide open · razor focus, creamy background'], [2, 'Very shallow · subject pops'], [2.8, 'Shallow · portrait standard'], [4, 'Balanced · some context'],
  [5.6, 'Moderate · group in focus'], [8, 'Deep · most of the scene sharp'], [11, 'Very deep · landscapes'], [16, 'Maximum depth · everything sharp'],
];
export const PALETTES = [
  { name: 'Warm dramedy', colors: ['#E8B07A', '#2F4A5A', '#F3E6D3', '#8C3B2E'], grade: 'warm skin, gentle contrast' },
  { name: 'Teal & sodium night', colors: ['#0F2A33', '#1F6F78', '#E39B3B', '#0A0A0C'], grade: 'teal shadows, sodium practicals' },
  { name: 'Pastel romance', colors: ['#F2C6C2', '#F7E7CE', '#9DB4A0', '#5E4B56'], grade: 'lifted blacks, soft highlights' },
  { name: 'Bleach bypass', colors: ['#3B3F3F', '#8A8F8C', '#C9C6BD', '#1C1E1E'], grade: 'desaturated, hard contrast' },
  { name: 'Desert noon', colors: ['#D9A066', '#F2D7A6', '#7A5230', '#9CC2D9'], grade: 'hot highlights, dusty mids' },
  { name: 'Neon noir', colors: ['#0B0B14', '#FF2E88', '#21E6C1', '#3A0CA3'], grade: 'deep blacks, saturated neon' },
  { name: 'Punjab golden hour', colors: ['#F2A541', '#B5651D', '#2E5E4E', '#F7E3C3'], grade: 'golden sun, green fields, warm skin' },
  { name: 'Monochrome', colors: ['#111111', '#555555', '#AAAAAA', '#EEEEEE'], grade: 'black and white, rich greys' },
];
const MOVE_ANIM = {
  static: [null, null], push_in: ['mvZoomIn', 'mvZoomIn'], pull_out: ['mvZoomOut', 'mvZoomOut'], truck_left: ['mvLeft', 'mvLeft'], truck_right: ['mvRight', 'mvRight'],
  pan_left: ['mvLeft', 'mvLeft'], pan_right: ['mvRight', 'mvRight'], tilt_up: ['mvUp', 'mvUp'], tilt_down: ['mvDown', 'mvDown'], pedestal_up: ['mvUp', 'mvUp'],
  crane_down: ['mvDown', 'mvDown'], orbit: ['mvRight', 'mvOrbit'], tracking: ['mvRight', null], lead: ['mvZoomOut', null], handheld: ['mvShake', 'mvShake'],
  crash_zoom: ['mvZoomIn', 'mvZoomIn', '.7s'], dolly_zoom: ['mvVertigo', null], fpv: ['mvFly', 'mvFly', '1.4s'], aerial: ['mvFly', null, '4s'], whip_pan: ['mvWhip', 'mvWhip', '1.6s'],
};
const LIGHT_POS = { front: '50% 35%', side_left: '8% 50%', side_right: '92% 50%', top: '50% 0%', under: '50% 100%', rembrandt: '22% 22%' };

const get = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
const setp = (o, p, v) => { const ks = p.split('.'); let x = o; for (const k of ks.slice(0, -1)) x = x[k] ??= {}; x[ks.at(-1)] = v; };
const blank = (v) => v == null || v === '' || (Array.isArray(v) && !v.length);

export function kelvinColor(k) {
  const stops = [[1800, [255, 138, 42]], [3200, [255, 194, 122]], [4500, [255, 241, 220]], [5600, [244, 247, 255]], [8000, [185, 210, 255]]];
  k = Math.max(1800, Math.min(8000, Number(k) || 5600));
  for (let i = 1; i < stops.length; i++) if (k <= stops[i][0]) {
    const [k0, c0] = stops[i - 1], [k1, c1] = stops[i], t = (k - k0) / (k1 - k0);
    return `rgb(${c0.map((c, j) => Math.round(c + (c1[j] - c) * t)).join(',')})`;
  }
  return 'rgb(185,210,255)';
}

// ------------------------------------------------------------------ composer
export function buildComposer(ui, ctx) {
  const { h, POST, guard, usd, toast } = ui;
  const { shot, spec, E, refs, assets, V, providers, save, rerender, onPlan } = ctx;
  const providerId = () => spec.model_pref?.provider || 'mock';
  const prov = () => providers.find((p) => p.id === providerId()) ?? providers[0];
  const caps = () => prov().models[0]?.caps ?? {};
  const eff = (p) => (blank(get(spec, p)) ? get(E, p) : get(spec, p));
  const inherited = (p) => blank(get(spec, p)) && !blank(get(E, p));
  const label = (cat, id) => V[cat]?.find((o) => o.id === id)?.label ?? id;

  // ---- tiles
  const tileVal = (parts, keys) => {
    const shown = parts.filter((x) => !blank(x));
    const inh = keys.some(inherited) && keys.every((k) => blank(get(spec, k)));
    return h('span', { class: `v ${shown.length ? '' : 'auto'}` }, shown.length ? shown.join(' · ') : 'Auto', inh && shown.length ? h('span', { class: 'inh' }, 'inherited') : null);
  };
  const refCount = () => (spec.subjects ?? []).filter((s) => refs.find((r) => r.handle === s.ref)?.asset_ids?.length).length + (spec.references ?? []).length;
  const refLimit = () => { const m = caps().max_refs ?? {}; return (m.image ?? 0) + (m.video ?? 0) + (m.audio ?? 0); };
  const tiles = () => h('div', { class: 'tiles' },
    tile('References', h('span', { class: 'v' }, `${refCount()} / ${refLimit() || '—'}`), () => refsModal()),
    tile('Film', tileVal([label('genre', eff('look.genre')), label('era', eff('look.era')), label('tempo', eff('pacing.tempo'))].filter((x) => x), ['look.genre', 'look.era', 'pacing.tempo']), () => filmModal()),
    tile('Camera', tileVal([label('shot_size', eff('framing.shot_size')), eff('lens.focal_mm') && `${eff('lens.focal_mm')}mm`, eff('lens.aperture') && `f/${eff('lens.aperture')}`, label('camera_body', eff('look.camera_body'))], ['framing.shot_size', 'lens.focal_mm', 'lens.aperture', 'look.camera_body']), () => cameraModal()),
    tile('Movement', tileVal((eff('camera.moves')?.length ? eff('camera.moves') : [eff('camera.movement')]).filter(Boolean).map((m) => label('movement', m)), ['camera.movement', 'camera.moves']), () => movesModal()),
    tile('Lighting', tileVal([label('key_direction', eff('lighting.key_direction')), eff('lighting.color_temp_k') && `${eff('lighting.color_temp_k')}K`, label('time_of_day', eff('lighting.time_of_day'))], ['lighting.key_direction', 'lighting.color_temp_k', 'lighting.time_of_day']), () => lightModal()),
    tile('Palette', eff('look.palette')?.length ? h('span', { class: 'v' }, h('span', { class: 'swatches', style: 'height:14px;width:100%' }, eff('look.palette').map((c) => h('i', { style: `background:${c}` })))) : h('span', { class: 'v auto' }, 'Auto'), () => paletteModal()));
  function tile(k, v, onclick) { return h('button', { class: 'tile', onclick }, h('span', { class: 'k' }, k), v); }

  // ---- prompt with @-mentions
  const ta = h('textarea', { placeholder: 'Describe the shot. Type @ to bring in a character, location or prop from Reference Studio.', value: spec.intent?.summary ?? '' });
  const menu = h('div', { class: 'mention-menu hidden' });
  let mentionIdx = 0, mentionList = [];
  const mentionQuery = () => { const m = /@([a-z0-9_]*)$/i.exec(ta.value.slice(0, ta.selectionStart)); return m ? m[1].toLowerCase() : null; };
  const drawMenu = () => {
    const q = mentionQuery();
    mentionList = q == null ? [] : refs.filter((r) => r.handle.slice(1).includes(q)).slice(0, 8);
    menu.classList.toggle('hidden', !mentionList.length);
    menu.replaceChildren(...mentionList.map((r, i) => h('div', { class: i === mentionIdx ? 'on' : '', onmousedown: (e) => { e.preventDefault(); insertMention(r); } },
      r.asset_ids?.[0] ? h('img', { src: `/api/assets/${r.asset_ids[0]}/thumb` }) : h('span', { class: 'badge' }, r.type[0].toUpperCase()),
      h('span', {}, h('b', {}, r.handle), ' ', h('span', { class: 'muted' }, `${r.type} · ${r.name}`)))));
  };
  function insertMention(r) {
    const pos = ta.selectionStart;
    const before = ta.value.slice(0, pos).replace(/@([a-z0-9_]*)$/i, r.handle + ' ');
    ta.value = before + ta.value.slice(pos);
    ta.selectionStart = ta.selectionEnd = before.length;
    setp(spec, 'intent.summary', ta.value);
    if (['character', 'wardrobe', 'prop'].includes(r.type) && !(spec.subjects ?? []).some((s) => s.ref === r.handle)) (spec.subjects ??= []).push({ ref: r.handle });
    if (r.type === 'location' && blank(spec.location)) spec.location = r.handle;
    menu.classList.add('hidden');
    redrawTiles(); refreshPlan();
    toast(`${r.handle} attached to this shot`, 'ok');
  }
  ta.addEventListener('input', () => { setp(spec, 'intent.summary', ta.value); mentionIdx = 0; drawMenu(); refreshPlan(); });
  ta.addEventListener('keydown', (e) => {
    if (menu.classList.contains('hidden')) return;
    if (e.key === 'ArrowDown') { mentionIdx = (mentionIdx + 1) % mentionList.length; drawMenu(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { mentionIdx = (mentionIdx - 1 + mentionList.length) % mentionList.length; drawMenu(); e.preventDefault(); }
    else if (e.key === 'Enter' || e.key === 'Tab') { insertMention(mentionList[mentionIdx]); e.preventDefault(); }
    else if (e.key === 'Escape') menu.classList.add('hidden');
  });
  ta.addEventListener('blur', () => setTimeout(() => menu.classList.add('hidden'), 150));

  // ---- chip toolbar
  let takes = 1;
  const chipbar = h('div', { class: 'chipbar' });
  const genBtn = h('button', { class: 'primary gen-btn' }, 'Generate', h('small', {}, '…'));
  const issues = h('div', { class: 'err', style: 'font-size:12px' });
  function popChip(text, sub, options, onPick) {
    const c = h('span', { class: 'chip', tabindex: 0 }, text, sub ? h('span', { class: 'sub' }, sub) : null);
    c.onclick = (e) => {
      e.stopPropagation();
      document.querySelectorAll('.pop').forEach((p) => p.remove());
      const pop = h('div', { class: 'pop' }, options.map((o) => h('div', { class: `opt ${o.on ? 'on' : ''}`, onclick: (ev) => { ev.stopPropagation(); pop.remove(); onPick(o.value); } }, o.label, o.sub ? h('small', {}, o.sub) : null)));
      c.append(pop);
      setTimeout(() => document.addEventListener('click', () => pop.remove(), { once: true }));
    };
    return c;
  }
  function drawChips() {
    const cp = caps(), p = prov();
    const res = eff('resolution'), asp = eff('aspect'), dur = Number(eff('duration_s') ?? 5);
    const dmin = cp.durations?.min ?? 1, dmax = cp.durations?.max ?? 30;
    const audioOn = !!eff('audio.generate');
    chipbar.replaceChildren(
      popChip(p.label.split('·').pop().trim(), p.billable ? 'paid' : 'free', providers.map((x) => {
        const c = x.models[0]?.caps ?? {};
        return { value: x.id, on: x.id === p.id, label: x.label, sub: `${c.durations ? `${c.durations.min}–${c.durations.max}s` : ''} · ${(c.resolutions ?? []).join('/')} · ${x.billable ? 'paid' : 'free'}${x.id !== 'mock' && !x.credentials?.configured ? ' · not set up' : ''}` };
      }), (v) => { spec.model_pref = { ...(spec.model_pref ?? {}), provider: v }; ctx.onProvider?.(v); drawChips(); redrawTiles(); refreshPlan(); }),
      popChip(res || 'Auto', inherited('resolution') ? 'inh' : '', (cp.resolutions ?? ['480p', '720p', '1080p']).map((r) => ({ value: r, label: r, on: r === res })), (v) => { spec.resolution = v; drawChips(); refreshPlan(); }),
      popChip(asp || 'Auto', inherited('aspect') ? 'inh' : '', (cp.aspects ?? ['16:9', '9:16', '1:1', '21:9']).map((a) => ({ value: a, label: a, on: a === asp })), (v) => { spec.aspect = v; drawChips(); refreshPlan(); }),
      h('span', { class: 'stepper' }, h('button', { onclick: () => { spec.duration_s = Math.max(dmin, dur - 1); drawChips(); refreshPlan(); } }, '−'), h('span', {}, `${dur}s`), h('button', { onclick: () => { spec.duration_s = Math.min(dmax, dur + 1); drawChips(); refreshPlan(); } }, '+')),
      h('span', { class: `chip ${audioOn ? 'on' : ''}`, title: cp.audio ? '' : 'this model has no audio output', onclick: () => { if (!cp.audio && !audioOn) return toast('This model cannot generate audio', 'err'); setp(spec, 'audio.generate', !audioOn); drawChips(); refreshPlan(); } }, audioOn ? '♪ Audio on' : '♪ Audio off'),
      h('span', { class: 'stepper', title: 'takes: variants generated in one go' }, h('button', { onclick: () => { takes = Math.max(1, takes - 1); drawChips(); refreshPlan(); } }, '−'), h('span', {}, `${takes} take${takes > 1 ? 's' : ''}`), h('button', { onclick: () => { takes = Math.min(4, takes + 1); drawChips(); refreshPlan(); } }, '+')),
      genBtn);
  }

  // ---- live plan / cost
  let planTimer, lastPlan = null;
  function refreshPlan() {
    clearTimeout(planTimer);
    planTimer = setTimeout(async () => {
      try {
        lastPlan = await POST(`/api/shots/${shot.id}/plan`, { provider: providerId(), spec });
        const est = lastPlan.estimate ?? {};
        const each = Number(est.usd ?? 0);
        genBtn.lastChild.textContent = lastPlan.errors.length ? `${lastPlan.errors.length} issue${lastPlan.errors.length > 1 ? 's' : ''}` : each ? `${usd(each * takes)} est.${takes > 1 ? ` (${takes}×)` : ''}` : `free${prov().id === 'local-h3' ? ' · local GPU' : ''}`;
        genBtn.disabled = !!lastPlan.errors.length;
        issues.replaceChildren(...lastPlan.errors.map((e) => h('div', {}, '⛔ ', e)), ...lastPlan.warnings.map((w) => h('div', { class: 'warnc' }, '⚠ ', w)));
        onPlan?.(lastPlan);
      } catch (e) { genBtn.lastChild.textContent = 'plan error'; issues.textContent = e.message; }
    }, 450);
  }

  genBtn.onclick = guard(async () => {
    await save();
    const r = await POST(`/api/shots/${shot.id}/generate`, { provider: providerId(), takes });
    const pending = (r.takes ?? [r]).filter((t) => t.job.status === 'awaiting_approval' && !t.duplicate);
    if (r.duplicate && takes === 1) toast(`An identical request already exists (${r.job.status}) — not resubmitted.`);
    if (pending.length === 1) ui.approvalDialog(pending[0].job, r.plan);
    else if (pending.length > 1) ui.batchApproval(pending.map((t) => t.job));
    else if (!r.duplicate || takes > 1) toast(`${takes > 1 ? `${takes} takes` : 'Shot'} queued`, 'ok');
    rerender();
  });

  // ---- settings modal framework
  function settingsModal(title, tabs, resetPaths) {
    const draft = structuredClone(spec);
    let cur = tabs[0].id;
    const body = h('div', { class: 'body' });
    const tabBar = h('div', { class: 'tabs-v' });
    const draw = () => {
      tabBar.replaceChildren(...tabs.map((t) => h('button', { class: t.id === cur ? 'on' : '', onclick: () => { cur = t.id; draw(); } }, t.label)));
      body.replaceChildren(tabs.find((t) => t.id === cur).render(draft, draw));
    };
    draw();
    ui.modal(h('div', {}, h('h1', {}, title), h('p', { class: 'sub' }, 'Choices compile into prompt guidance (best effort, not physical camera control). Auto = inherit from scene/project or leave to the model.'),
      h('div', { class: 'smodal' }, tabBar, body),
      h('div', { class: 'mfoot' },
        h('button', { onclick: () => { for (const p of resetPaths) setp(draft, p, Array.isArray(get(draft, p)) ? [] : ''); for (const p of resetPaths) if (/focal_mm|aperture|color_temp_k/.test(p)) setp(draft, p, null); draw(); } }, 'Reset all to Auto'),
        h('div', { class: 'row' }, h('button', { onclick: ui.closeModal }, 'Cancel'),
          h('button', { class: 'primary', onclick: guard(async () => { Object.keys(spec).forEach((k) => delete spec[k]); Object.assign(spec, draft); ui.closeModal(); await save(); rerender(); }) }, 'Apply')))), { wide: true });
  }
  const pickCards = (draft, path, items, redraw, { render: extra } = {}) => h('div', { class: 'optgrid' },
    h('div', { class: `ocard ${blank(get(draft, path)) ? 'on' : ''}`, onclick: () => { setp(draft, path, ''); redraw(); } }, h('b', {}, 'Auto'), h('small', {}, inherited(path) ? `inherits: ${label(path.split('.').pop() === 'shot_size' ? 'shot_size' : path.split('.').pop(), get(E, path)) ?? get(E, path)}` : 'let the scene/model decide')),
    items.map((it) => h('div', { class: `ocard ${get(draft, path) === it.id ? 'on' : ''}`, onclick: () => { setp(draft, path, it.id); redraw(); } }, extra ? extra(it) : null, h('b', {}, it.label), it.sub ? h('small', {}, it.sub) : null)));
  const reel = (title, draft, path, items, redraw) => h('div', { class: 'reel' }, h('h4', {}, title),
    h('div', { class: `ri ${blank(get(draft, path)) ? 'on' : ''}`, onclick: () => { setp(draft, path, path.match(/focal|aperture/) ? null : ''); redraw(); } }, 'Auto', h('small', {}, inherited(path) ? `inherits ${get(E, path)}` : 'model decides')),
    items.map(([v, l, s]) => h('div', { class: `ri ${get(draft, path) === v ? 'on' : ''}`, onclick: () => { setp(draft, path, v); redraw(); } }, l, s ? h('small', {}, s) : null)));

  function filmModal() {
    const eras = ['50s', '70s', '80s', 'contemporary', 'future'];
    settingsModal('Film setup', [
      { id: 'genre', label: 'Genre', render: (d, r) => pickCards(d, 'look.genre', V.genre.map((g) => ({ id: g.id, label: g.label, sub: GENRE_INFO[g.id] })), r) },
      { id: 'era', label: 'Era', render: (d, r) => h('div', {}, h('p', { class: 'muted' }, 'Period look: grain, grade and lens style.'),
        h('div', { class: 'ruler' }, h('button', { class: blank(d.look?.era) ? 'on' : '', onclick: () => { setp(d, 'look.era', ''); r(); } }, 'Auto'),
          eras.map((e) => h('button', { class: d.look?.era === e ? 'on' : '', onclick: () => { setp(d, 'look.era', e); r(); } }, label('era', e))))) },
      { id: 'tempo', label: 'Tempo', render: (d, r) => { const list = V.tempo.map((t) => t.id); const i = list.indexOf(d.pacing?.tempo);
        return h('div', {}, h('p', { class: 'muted' }, 'Pacing of action and camera inside the shot.'), h('div', { class: 'stepper', style: 'font-size:16px' },
          h('button', { onclick: () => { setp(d, 'pacing.tempo', list[Math.max(0, i - 1)] ?? list[0]); r(); } }, '−'), h('span', { style: 'min-width:160px' }, i < 0 ? 'Auto' : label('tempo', list[i])),
          h('button', { onclick: () => { setp(d, 'pacing.tempo', list[Math.min(list.length - 1, i + 1)]); r(); } }, '+')), ' ', h('button', { onclick: () => { setp(d, 'pacing.tempo', ''); r(); } }, 'Auto')); } },
      { id: 'texture', label: 'Texture', render: (d, r) => pickCards(d, 'look.texture', V.texture.map((t) => ({ id: t.id, label: t.label, sub: t.phrase })), r) },
    ], ['look.genre', 'look.era', 'pacing.tempo', 'look.texture']);
  }
  function cameraModal() {
    settingsModal('Camera', [
      { id: 'lens', label: 'Body & lens', render: (d, r) => h('div', { class: 'reels' },
        reel('Camera body', d, 'look.camera_body', V.camera_body.map((o) => [o.id, o.label, o.phrase.split(',')[0]]), r),
        reel('Lens', d, 'lens.character', V.lens_character.map((o) => [o.id, o.label, o.phrase.split(',').slice(0, 2).join(',')]), r),
        reel('Focal length', d, 'lens.focal_mm', FOCALS.map(([v, s]) => [v, `${v} mm`, s]), r),
        reel('Aperture', d, 'lens.aperture', APERTURES.map(([v, s]) => [v, `f/${v}`, s]), r),
        reel('Depth of field', d, 'lens.dof', V.dof.map((o) => [o.id, o.label, o.phrase]), r)) },
      { id: 'size', label: 'Shot size', render: (d, r) => pickCards(d, 'framing.shot_size', V.shot_size.map((o) => ({ id: o.id, label: `${o.id} · ${o.label}`, sub: o.phrase })), r) },
      { id: 'angle', label: 'Angle', render: (d, r) => pickCards(d, 'framing.angle', V.angle.map((o) => ({ id: o.id, label: o.label, sub: o.phrase })), r) },
    ], ['look.camera_body', 'lens.character', 'lens.focal_mm', 'lens.aperture', 'lens.dof', 'framing.shot_size', 'framing.angle']);
  }
  function movesModal() {
    settingsModal('Camera movement', [{ id: 'moves', label: 'Moves', render: (d, r) => {
      const stack = d.camera?.moves?.length ? [...d.camera.moves] : (d.camera?.movement ? [d.camera.movement] : []);
      const commit = (s) => { setp(d, 'camera.moves', s); setp(d, 'camera.movement', s[0] ?? ''); r(); };
      return h('div', {},
        h('h3', {}, 'Move stack — order matters (first … then …)'),
        h('div', { class: 'stack' }, stack.length ? stack.map((m, i) => h('span', { class: 'si' }, `${i + 1}. ${label('movement', m)}`,
          h('button', { title: 'earlier', onclick: () => { if (i) { [stack[i - 1], stack[i]] = [stack[i], stack[i - 1]]; commit(stack); } } }, '←'),
          h('button', { title: 'later', onclick: () => { if (i < stack.length - 1) { [stack[i + 1], stack[i]] = [stack[i], stack[i + 1]]; commit(stack); } } }, '→'),
          h('button', { title: 'remove', onclick: () => { stack.splice(i, 1); commit(stack); } }, '×'))) : h('span', { class: 'muted' }, 'Auto — no camera move specified. Click moves below to add them.')),
        stack.length > 2 ? h('p', { class: 'warnc' }, 'More than two moves in one shot is rarely followed — consider splitting the shot.') : null,
        h('div', { class: 'row', style: 'margin:10px 0' },
          h('label', {}, 'Speed', h('select', { onchange: (e) => { setp(d, 'camera.speed', e.target.value); } }, h('option', { value: '' }, 'Auto'), V.speed.map((o) => h('option', { value: o.id, selected: d.camera?.speed === o.id }, o.label)))),
          h('label', {}, 'Rig', h('select', { onchange: (e) => { setp(d, 'camera.rig', e.target.value); } }, h('option', { value: '' }, 'Auto'), V.rig.map((o) => h('option', { value: o.id, selected: d.camera?.rig === o.id }, o.label))))),
        h('div', { class: 'optgrid' }, V.movement.map((o) => {
          const [bgA, subA, dur] = MOVE_ANIM[o.id] ?? [];
          const st = (a) => (a ? `animation-name:${a};${dur ? `animation-duration:${dur};` : ''}` : '');
          return h('div', { class: `ocard ${stack.includes(o.id) ? 'on' : ''}`, title: 'hover to preview · click to add to the stack', onclick: () => { if (o.id === 'static') commit(['static']); else commit([...stack.filter((x) => x !== 'static'), o.id]); } },
            h('div', { class: 'mv' }, h('div', { class: 'bg', style: st(bgA) }), h('div', { class: 'subj', style: st(subA) }), h('div', { class: 'frame' })),
            h('b', {}, o.label), h('small', {}, o.phrase));
        })));
    } }], ['camera.moves', 'camera.movement', 'camera.speed', 'camera.rig']);
  }
  function lightModal() {
    const prev = (dir, k) => {
      const tint = kelvinColor(k);
      const face = dir === 'back' ? `radial-gradient(circle, #15161a 60%, ${tint} 66%, transparent 72%)`
        : dir === 'silhouette' ? '#050506' : `radial-gradient(circle at ${LIGHT_POS[dir] ?? '50% 35%'}, ${tint}, #2a2622 55%, #0d0d0f 80%)`;
      const bg = dir === 'silhouette' ? `linear-gradient(${tint}, #8b8b8b)` : '#0b0c0f';
      return h('div', { class: 'lightprev', style: `background:${bg}` }, h('div', { class: 'face', style: `background:${face}` }));
    };
    settingsModal('Lighting', [
      { id: 'key', label: 'Key light', render: (d, r) => pickCards(d, 'lighting.key_direction', V.key_direction.map((o) => ({ id: o.id, label: o.label, sub: o.phrase })), r, { render: (it) => prev(it.id, d.lighting?.color_temp_k ?? 4500) }) },
      { id: 'temp', label: 'Colour temperature', render: (d, r) => { const k = d.lighting?.color_temp_k ?? ''; return h('div', {},
        h('div', { class: 'kelvin' }), h('input', { type: 'range', min: 1800, max: 8000, step: 100, value: k || 5600, oninput: (e) => { setp(d, 'lighting.color_temp_k', Number(e.target.value)); r(); } }),
        h('div', { class: 'row' }, h('b', {}, k ? `${k} K` : 'Auto'), h('button', { onclick: () => { setp(d, 'lighting.color_temp_k', null); r(); } }, 'Auto'),
          ...[[2700, 'Candle/tungsten'], [3200, 'Tungsten'], [4300, 'Mixed'], [5600, 'Daylight'], [7000, 'Shade/overcast']].map(([v, l]) => h('button', { onclick: () => { setp(d, 'lighting.color_temp_k', v); r(); } }, `${l} ${v}K`))),
        prev(d.lighting?.key_direction || 'front', k || 5600)); } },
      { id: 'quality', label: 'Quality & contrast', render: (d, r) => h('div', {}, h('h3', {}, 'Quality'), pickCards(d, 'lighting.quality', V.light_quality.map((o) => ({ id: o.id, label: o.label, sub: o.phrase })), r),
        h('h3', {}, 'Contrast'), pickCards(d, 'lighting.contrast', V.contrast.map((o) => ({ id: o.id, label: o.label, sub: o.phrase })), r)) },
      { id: 'time', label: 'Time & atmosphere', render: (d, r) => h('div', {}, h('h3', {}, 'Time of day'), pickCards(d, 'lighting.time_of_day', V.time_of_day.map((o) => ({ id: o.id, label: o.label, sub: o.phrase })), r),
        h('h3', {}, 'Atmosphere'), pickCards(d, 'atmosphere.type', V.atmosphere.map((o) => ({ id: o.id, label: o.label, sub: o.phrase })), r),
        h('label', { style: 'margin-top:10px' }, 'Motivation (practicals, window, headlights…)', h('input', { value: d.lighting?.motivation ?? '', oninput: (e) => setp(d, 'lighting.motivation', e.target.value) }))) },
    ], ['lighting.key_direction', 'lighting.color_temp_k', 'lighting.quality', 'lighting.contrast', 'lighting.time_of_day', 'atmosphere.type', 'lighting.motivation']);
  }
  function paletteModal() {
    settingsModal('Colour palette', [{ id: 'pal', label: 'Palettes', render: (d, r) => {
      const cur = (d.look?.palette ?? []).join(',');
      return h('div', {}, h('div', { class: 'optgrid' },
        h('div', { class: 'ocard new', onclick: () => { const v = prompt('Hex colours, comma separated (e.g. #E8B07A, #2F4A5A)', cur.replace(/,/g, ', ')); if (v == null) return; setp(d, 'look.palette', v.split(/[\s,]+/).filter((x) => /^#[0-9a-f]{6}$/i.test(x))); r(); } }, '+ New palette'),
        h('div', { class: `ocard ${!cur ? 'on' : ''}`, onclick: () => { setp(d, 'look.palette', []); r(); } }, h('b', {}, 'Auto'), h('small', {}, inherited('look.palette') ? `inherits ${get(E, 'look.palette').join(' ')}` : 'no palette guidance')),
        PALETTES.map((p) => h('div', { class: `ocard ${cur === p.colors.join(',') ? 'on' : ''}`, onclick: () => { setp(d, 'look.palette', p.colors); setp(d, 'look.grade_notes', p.grade); r(); } },
          h('div', { class: 'swatches' }, p.colors.map((c) => h('i', { style: `background:${c}` }))), h('b', {}, p.name), h('small', {}, p.grade)))),
        cur && !PALETTES.some((p) => p.colors.join(',') === cur) ? h('div', { style: 'margin-top:10px' }, h('b', {}, 'Custom: '), h('span', { class: 'swatches', style: 'display:inline-flex;width:200px;vertical-align:middle' }, d.look.palette.map((c) => h('i', { style: `background:${c}` })))) : null,
        h('p', { class: 'muted' }, 'Palettes guide the generation; final grade belongs in Resolve. QC measures drift against references.'));
    } }], ['look.palette', 'look.grade_notes']);
  }
  function refsModal() {
    const media = assets.filter((a) => ['image', 'video', 'audio'].includes(a.kind));
    settingsModal(`References (${refCount()} / ${refLimit() || '—'})`, [
      { id: 'lib', label: 'Library (@)', render: (d, r) => h('div', {}, h('p', { class: 'muted' }, 'Click to attach or detach. Characters, wardrobe and props become subjects; their first image is sent as a reference.'),
        refs.length ? h('div', { class: 'optgrid' }, refs.map((ref) => { const on = (d.subjects ?? []).some((s) => s.ref === ref.handle) || d.location === ref.handle;
          return h('div', { class: `ocard ${on ? 'on' : ''}`, onclick: () => {
            if (ref.type === 'location') d.location = on ? '' : ref.handle;
            else d.subjects = on ? (d.subjects ?? []).filter((s) => s.ref !== ref.handle) : [...(d.subjects ?? []), { ref: ref.handle }];
            r(); } }, ref.asset_ids?.[0] ? ui.thumbFor(ref.asset_ids[0]) : h('div', { class: 'thumb' }), h('b', {}, ref.handle), h('small', {}, `${ref.type} · ${ref.description || ref.name}`)); }))
          : h('div', { class: 'empty' }, 'No references yet — create them in Reference Studio.')) },
      { id: 'inputs', label: 'Frames & media', render: (d, r) => h('div', {}, h('p', { class: 'muted' }, 'First/last frames lock the storyboard; reference media lock identity/motion. Some models cannot mix the two.'),
        ...(d.references ?? []).map((x, i) => h('div', { class: 'grid g3', style: 'margin-bottom:6px' },
          h('select', { onchange: (e) => { x.role = e.target.value; } }, ['first_frame', 'last_frame', 'reference_image', 'reference_video', 'reference_audio'].map((v) => h('option', { selected: x.role === v }, v))),
          h('select', { onchange: (e) => { x.asset_id = e.target.value; } }, media.map((a) => h('option', { value: a.id, selected: a.id === x.asset_id }, `${a.kind}: ${a.filename}`))),
          h('button', { class: 'danger', onclick: () => { d.references.splice(i, 1); r(); } }, 'Remove'))),
        h('button', { disabled: !media.length, onclick: () => { (d.references ??= []).push({ role: 'reference_image', asset_id: media[0].id }); r(); } }, '+ Add frame / media')) },
    ], ['subjects', 'references', 'location']);
  }

  // ---- assemble
  const tileHost = h('div');
  const redrawTiles = () => tileHost.replaceChildren(tiles());
  redrawTiles(); drawChips(); refreshPlan();
  const el = h('div', { class: 'composer' }, tileHost, h('div', { class: 'prompt-box' }, ta, menu), chipbar, issues);
  return { el, providerId, getPlan: () => lastPlan, refreshPlan };
}
