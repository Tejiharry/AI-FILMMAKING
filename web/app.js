import { buildComposer } from './cinema.js';
// Harry AI FILM STUDIO — single-page client. No framework: a tiny h() helper,
// one render function per view, all state fetched from the local API.
const $ = (s, el = document) => el.querySelector(s);
const main = $('#main');

const state = { projects: [], project: null, projectId: localStorage.getItem('projectId'), vocab: null, defaults: null, providers: [], view: 'projects', shotId: null, sceneId: null };

// ------------------------------------------------------------------ helpers
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value') el.value = v; // property, not attribute: textareas ignore the value attribute
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
async function api(method, url, body, raw = false) {
  const res = await fetch(url, { method, headers: raw ? {} : { 'Content-Type': 'application/json' }, body: raw ? body : body === undefined ? undefined : JSON.stringify(body) });
  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) { const e = new Error(data?.error ?? res.statusText); e.data = data; e.status = res.status; throw e; }
  return data;
}
const GET = (u) => api('GET', u), POST = (u, b) => api('POST', u, b ?? {}), PATCH = (u, b) => api('PATCH', u, b), PUT = (u, b) => api('PUT', u, b), DEL = (u) => api('DELETE', u);
function toast(msg, kind = '') { const t = h('div', { class: `toast ${kind}` }, msg); $('#toasts').append(t); setTimeout(() => t.remove(), kind === 'err' ? 9000 : 4500); }
const guard = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { toast(e.data?.errors ? `${e.message}: ${e.data.errors.join('; ')}` : e.message, 'err'); } };
const usd = (n) => (n == null ? '—' : `$${Number(n).toFixed(n < 1 ? 4 : 2)}`);
const ago = (iso) => { const s = (Date.now() - Date.parse(iso)) / 1000; return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(iso).toLocaleDateString(); };
const STATUS_CLASS = { succeeded: 'good', running: 'info', submitting: 'info', queued: 'info', awaiting_approval: 'warn', needs_review: 'warn', failed: 'bad', rejected: 'bad', cancelled: '', draft: '', generating: 'info', review: 'good', needs_attention: 'warn' };
const statusBadge = (s) => h('span', { class: `badge status ${STATUS_CLASS[s] ?? ''}` }, s.replace(/_/g, ' '));
const thumbFor = (assetId) => assetId ? h('img', { class: 'thumb', src: `/api/assets/${assetId}/thumb`, loading: 'lazy', onerror: (e) => e.target.replaceWith(h('div', { class: 'thumb' })) }) : h('div', { class: 'thumb' });
function modal(content, { wide } = {}) {
  const d = $('#modal'); const body = $('#modal-body'); body.replaceChildren(content);
  d.style.width = wide ? 'min(1000px, 94vw)' : ''; d.showModal(); return () => d.close();
}
const closeModal = () => $('#modal').close();
// Deep-merge `over` into `base` in place; blank values never override (same rule as the server's inheritance).
function mergeInto(base, over) {
  for (const [k, v] of Object.entries(over ?? {})) {
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) mergeInto(base[k] ??= {}, v); else base[k] = structuredClone(v);
  }
  return base;
}
const needProject = () => { if (!state.project) { main.replaceChildren(h('h1', {}, 'No project selected'), h('p', { class: 'sub' }, 'Create or open a project first.'), h('button', { class: 'primary', onclick: () => go('projects') }, 'Go to Projects')); return true; } return false; };

// ------------------------------------------------------------------ routing
const VIEW_ALIASES = { director: 'cinema', motion: 'genjutsu' }; // old links keep working
// Per-view state that lives in the URL (#view?key=value…), so a link reopens the same shot, model, preset, mode or filter.
const VIEW_PARAMS = {
  cinema: { project: 'projectId', shot: 'shotId', provider: 'urlProvider', preset: 'urlPreset' },
  scenes: { project: 'projectId', scene: 'sceneId' },
  genjutsu: { project: 'projectId', mode: 'genjutsuMode', src: 'motionSrc' },
  katana: { project: 'projectId', mode: 'katanaMode', src: 'motionSrc' },
  assets: { project: 'projectId', filter: 'assetFilter', layout: 'assetLayout', sort: 'assetSort', q: 'assetQuery' },
  jobs: { project: 'projectId', filter: 'jobFilter', layout: 'jobLayout', q: 'jobQuery' },
  qc: { project: 'projectId', asset: 'qcAsset' },
  edit: { project: 'projectId' }, references: { project: 'projectId' }, projects: { project: 'projectId' }, settings: {},
};
function urlFor(view) {
  const q = new URLSearchParams();
  for (const [k, sk] of Object.entries(VIEW_PARAMS[view] ?? {})) if (state[sk] != null && state[sk] !== '') q.set(k, state[sk]);
  return `#${view}${q.toString() ? `?${q}` : ''}`;
}
// replace=true updates the address without adding a history entry (used after every render / small changes).
function writeUrl(replace = true) { const u = urlFor(state.view); if (location.hash !== u) history[replace ? 'replaceState' : 'pushState'](null, '', u); }
function readUrl() {
  const [raw, qs] = location.hash.slice(1).split('?');
  const view = VIEW_ALIASES[raw] ?? raw;
  state.view = VIEWS[view] ? view : 'projects';
  const q = new URLSearchParams(qs ?? '');
  const prevProject = state.projectId;
  for (const [k, sk] of Object.entries(VIEW_PARAMS[state.view] ?? {})) if (q.has(k)) state[sk] = q.get(k);
  if (state.projectId !== prevProject) localStorage.setItem('projectId', state.projectId ?? '');
  return state.projectId !== prevProject;
}
function go(view, extra = {}) { Object.assign(state, extra); state.view = view; writeUrl(false); render(); }
// Unsaved form edits block live auto-refresh (a job finishing must never wipe your changes).
main.addEventListener('input', () => { state.dirty = true; });
main.addEventListener('change', () => { state.dirty = true; });
async function render() {
  state.dirty = false;
  for (const a of document.querySelectorAll('#nav a')) a.classList.toggle('active', a.dataset.view === state.view);
  main.replaceChildren(h('p', { class: 'muted' }, 'Loading…'));
  try { await (VIEWS[state.view] ?? VIEWS.projects)(); } catch (e) { main.replaceChildren(h('h1', {}, 'Something went wrong'), h('pre', {}, e.message)); }
  writeUrl(); // reflect what the view settled on (e.g. its default shot)
}
async function loadProjects() {
  state.projects = await GET('/api/projects');
  const sel = $('#project-select');
  sel.replaceChildren(h('option', { value: '' }, '— select project —'), ...state.projects.map((p) => h('option', { value: p.id, selected: p.id === state.projectId }, p.name)));
  if (state.projectId && state.projects.some((p) => p.id === state.projectId)) state.project = await GET(`/api/projects/${state.projectId}`);
  else { state.project = null; state.projectId = null; }
}
async function reloadProject() { if (state.projectId) state.project = await GET(`/api/projects/${state.projectId}`); }
$('#project-select').addEventListener('change', async (e) => {
  state.projectId = e.target.value || null; localStorage.setItem('projectId', state.projectId ?? '');
  Object.assign(state, { shotId: null, sceneId: null, motionSrc: null, qcAsset: null, urlProvider: null, urlPreset: null }); // per-project state
  await loadProjects(); render();
});
for (const a of document.querySelectorAll('#nav a')) a.addEventListener('click', () => go(a.dataset.view));
// Back/forward and pasted links: re-read the URL and re-render (reload the project if the link points at another one).
const onUrl = async () => { if (location.hash === urlFor(state.view)) return; if (readUrl()) await loadProjects(); render(); };
window.addEventListener('hashchange', onUrl);
window.addEventListener('popstate', onUrl);

// ------------------------------------------------------------------ live job updates
function connectStream() {
  const es = new EventSource('/api/stream');
  es.addEventListener('job', (ev) => {
    const j = JSON.parse(ev.data);
    if (j.status === 'succeeded') toast(`Generation finished: ${j.label || j.id.slice(0, 8)}`, 'ok');
    if (j.status === 'failed') toast(`Generation failed: ${j.label || ''} — ${j.error?.message ?? ''}`, 'err');
    if (j.status === 'needs_review') toast(`Job needs review: ${j.error?.message ?? ''}`, 'err');
    refreshBadges();
    if (['jobs', 'cinema', 'edit', 'scenes'].includes(state.view) && !$('#modal').open && !state.dirty && ['succeeded', 'failed', 'needs_review', 'running'].includes(j.status)) debounceRender();
  });
  es.onerror = () => { es.close(); setTimeout(connectStream, 3000); };
}
let rt; const debounceRender = () => { clearTimeout(rt); rt = setTimeout(render, 400); };
async function refreshBadges() {
  try {
    const b = await GET('/api/budget');
    $('#spend').replaceChildren(h('div', {}, `Today ${usd(b.spent_today_usd)} / ${usd(b.budget.daily_usd)}`), h('div', {}, `Month ${usd(b.spent_month_usd)} / ${usd(b.budget.monthly_usd)}`));
    if (state.projectId) {
      const jobs = await GET(`/api/projects/${state.projectId}/jobs`);
      const n = jobs.filter((j) => ['awaiting_approval', 'needs_review'].includes(j.status)).length;
      const badge = $('#jobs-badge'); badge.textContent = n; badge.classList.toggle('hidden', !n); badge.className = `badge warn ${n ? '' : 'hidden'}`;
    }
  } catch { /* offline */ }
}

// ------------------------------------------------------------------ approval flow (billable jobs)
function approvalDialog(job, plan) {
  const est = job.estimate?.usd ?? 0;
  const input = h('input', { placeholder: est.toFixed(4), inputmode: 'decimal' });
  const done = (msg) => { closeModal(); toast(msg, 'ok'); render(); refreshBadges(); };
  modal(h('div', {},
    h('h1', {}, 'Approve paid generation'),
    h('p', { class: 'sub' }, `${job.provider} · ${job.model} · ${job.workflow}`),
    h('div', { class: 'kv' }, h('div', {}, 'Estimated cost'), h('div', {}, h('b', {}, usd(est)), ' ', h('span', { class: `badge ${job.estimate?.confidence === 'documented' ? 'good' : 'warn'}` }, job.estimate?.confidence)),
      h('div', {}, 'Basis'), h('div', { class: 'mono' }, job.estimate?.basis ?? ''), h('div', {}, 'Billing'), h('div', {}, 'Only successful videos are billed by the provider (per its documentation). Nothing is sent until you approve.')),
    plan ? h('details', {}, h('summary', {}, 'Prompt that will be sent'), h('pre', {}, plan.prompt)) : null,
    h('p', {}, 'Type the exact estimate to approve:'), input,
    h('div', { class: 'row', style: 'margin-top:14px; justify-content:flex-end' },
      h('button', { onclick: guard(async () => { await POST(`/api/jobs/${job.id}/reject`); done('Rejected — nothing was sent.'); }) }, 'Reject'),
      h('button', { onclick: closeModal }, 'Later'),
      h('button', { class: 'primary', onclick: guard(async () => { await POST(`/api/jobs/${job.id}/approve`, { confirm_usd: Number(input.value) }); done('Approved and queued.'); }) }, `Approve ${usd(est)}`))));
}

// ------------------------------------------------------------------ batch approval (several paid takes at once)
function batchApproval(jobs) {
  const total = Math.round(jobs.reduce((s, j) => s + Number(j.estimate?.usd ?? 0), 0) * 10000) / 10000;
  const inp = h('input', { placeholder: total.toFixed(4) });
  modal(h('div', {}, h('h1', {}, `Approve ${jobs.length} paid takes`), h('p', { class: 'sub' }, `Total estimate ${usd(total)}. Nothing is sent until you approve.`),
    h('p', {}, 'Type the exact total to approve all:'), inp,
    h('div', { class: 'row', style: 'margin-top:12px;justify-content:flex-end' },
      h('button', { onclick: guard(async () => { for (const j of jobs) await POST(`/api/jobs/${j.id}/reject`); closeModal(); toast('Rejected — nothing was sent.', 'ok'); render(); }) }, 'Reject all'),
      h('button', { onclick: closeModal }, 'Later'),
      h('button', { class: 'primary', onclick: guard(async () => { const r = await POST('/api/jobs/approve-batch', { job_ids: jobs.map((j) => j.id), confirm_usd_total: Number(inp.value) }); closeModal(); toast(`Approved ${r.results.filter((x) => x.ok).length}/${jobs.length}`, 'ok'); render(); }) }, `Approve ${usd(total)}`))));
}
const UI = { h, GET, POST, PATCH, toast, guard, usd, modal, closeModal, thumbFor, approvalDialog, batchApproval };

// ------------------------------------------------------------------ VIEWS
const VIEWS = {};

VIEWS.projects = async () => {
  await loadProjects();
  const name = h('input', { placeholder: 'Project name' }), logline = h('input', { placeholder: 'Logline (optional)' });
  const aspect = h('select', {}, ...['16:9', '21:9', '9:16', '1:1', '4:3'].map((a) => h('option', {}, a)));
  const res = h('select', {}, ...['720p', '1080p', '480p'].map((a) => h('option', {}, a)));
  main.replaceChildren(
    h('h1', {}, 'Projects'), h('p', { class: 'sub' }, 'Each project holds scenes, shots, references, generations and its own look.'),
    h('div', { class: 'panel', style: 'margin-bottom:16px' }, h('div', { class: 'grid g4' }, name, logline, h('label', {}, 'Default aspect', aspect), h('label', {}, 'Default resolution', res)),
      h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { class: 'primary', onclick: guard(async () => {
        const p = await POST('/api/projects', { name: name.value, logline: logline.value, settings: { shot_defaults: { aspect: aspect.value, resolution: res.value } } });
        state.projectId = p.id; localStorage.setItem('projectId', p.id); await loadProjects(); go('scenes');
      }) }, 'Create project'))),
    state.project ? await projectFolders(state.project) : null,
    h('h2', {}, 'All projects'),
    state.projects.length ? h('div', { class: 'cards' }, state.projects.map((p) => h('div', { class: 'panel shot-card', onclick: async () => { Object.assign(state, { projectId: p.id, shotId: null, sceneId: null, motionSrc: null, qcAsset: null }); localStorage.setItem('projectId', p.id); await loadProjects(); render(); } },
      h('b', {}, p.name), h('div', { class: 'meta' }, p.logline || '—'), h('div', { class: 'meta' }, `${p.shot_count} shots · ${p.asset_count} assets · ${ago(p.updated_at)}`), p.id === state.projectId ? h('span', { class: 'badge accent', style: 'align-self:flex-start' }, 'open') : null)))
      : emptySteps([['Name it', 'Give the project a name and its default aspect and resolution.'], ['Break it down', 'Paste a script into Scene Builder → AI Director to get scenes and shots.'], ['Compose & generate', 'Shape each shot in OG Cinema Studio; swaps live in OG Genjutsu.']]));
};

// Scene folders (named by scene, with counts) + a bin of alternate takes ("regenerations").
async function projectFolders(p) {
  const jobs = await GET(`/api/projects/${p.id}/jobs`);
  const shotOf = Object.fromEntries(p.scenes.flatMap((sc) => sc.shots.map((s) => [s.id, { ...s, scene: sc }])));
  const done = jobs.filter((j) => j.status === 'succeeded' && j.output_asset_id);
  const alternates = done.filter((j) => !j.shot_id || shotOf[j.shot_id]?.selected_job_id !== j.id);
  const folder = (title, lines, onclick, extra) => h('div', { class: 'panel shot-card', onclick },
    h('div', { class: 'row', style: 'gap:8px' }, h('span', { style: 'font-size:20px' }, '▤'), h('b', {}, title)), ...lines.map((l) => h('div', { class: 'meta' }, l)), extra);
  return h('div', { style: 'margin-bottom:18px' },
    h('h2', {}, `${p.name} — folders`),
    p.scenes.length || alternates.length ? h('div', { class: 'cards' },
      ...p.scenes.map((sc) => {
        const takes = done.filter((j) => sc.shots.some((s) => s.id === j.shot_id)).length;
        const selected = sc.shots.filter((s) => s.selected_job_id).length;
        const thumb = sc.shots.find((s) => s.selected_output_asset_id)?.selected_output_asset_id;
        return folder(`Scene ${sc.idx} · ${sc.heading}`, [`${sc.shots.length} shots · ${takes} takes · ${selected}/${sc.shots.length} selected`],
          () => go('scenes', { sceneId: sc.id }), thumb ? h('div', { style: 'margin-top:6px' }, thumbFor(thumb)) : null);
      }),
      folder('Regenerations', [`${alternates.length} alternate take${alternates.length === 1 ? '' : 's'} — not selected for the edit`], () => regenerationsBin(alternates, shotOf)))
      : h('div', { class: 'empty' }, 'No scenes yet — open Scene Builder to add one or break down a script.'));
}

function regenerationsBin(alts, shotOf) {
  modal(h('div', {}, h('h1', {}, 'Regenerations'), h('p', { class: 'sub' }, 'Alternate takes kept for every shot. Hover to play; promote one to make it the take used in exports.'),
    alts.length ? h('div', { class: 'takes gridview', style: '--tile:200px' }, alts.map((j) => {
      const s = shotOf[j.shot_id];
      return h('div', { class: 'panel tight', style: 'padding:6px' },
        h('video', { src: `/api/assets/${j.output_asset_id}/file`, muted: true, loop: true, preload: 'metadata', onmouseenter: (e) => e.target.play(), onmouseleave: (e) => e.target.pause() }),
        h('b', { style: 'font-size:12px' }, s ? `${s.scene.idx}.${s.idx} ${s.title}` : j.label || 'untitled'),
        h('div', { class: 'muted', style: 'font-size:11.5px' }, `${j.provider} · ${ago(j.created_at)}`),
        s ? h('div', { class: 'row', style: 'margin-top:4px' },
          h('button', { onclick: guard(async () => { await PATCH(`/api/shots/${s.id}`, { selected_job_id: j.id }); closeModal(); toast(`Now the selected take for ${s.title}`, 'ok'); render(); }) }, 'Make selected'),
          h('button', { onclick: () => { closeModal(); go('cinema', { shotId: s.id }); } }, 'Open shot')) : null);
    })) : h('div', { class: 'empty' }, 'No alternates — every finished take is the selected one.'),
    h('div', { class: 'row', style: 'justify-content:flex-end;margin-top:12px' }, h('button', { onclick: closeModal }, 'Close'))), { wide: true });
}

// --- Scene Builder ------------------------------------------------------------
VIEWS.scenes = async () => {
  if (needProject()) return;
  await reloadProject();
  const p = state.project;
  if (!state.sceneId || !p.scenes.some((s) => s.id === state.sceneId)) state.sceneId = p.scenes[0]?.id ?? null;
  const scene = p.scenes.find((s) => s.id === state.sceneId);
  const providers = state.providers;
  const provSel = h('select', {}, providers.map((pr) => h('option', { value: pr.id }, pr.label)));

  const left = h('div', { class: 'panel tight' },
    h('div', { class: 'row', style: 'justify-content:space-between' }, h('h3', {}, 'Scenes'), h('button', { onclick: guard(async () => { const s = await POST(`/api/projects/${p.id}/scenes`, { heading: `Scene ${p.scenes.length + 1}` }); state.sceneId = s.id; render(); }) }, '+ Scene')),
    h('div', { class: 'scene-list' }, p.scenes.length ? p.scenes.map((s) => h('a', { class: s.id === state.sceneId ? 'active' : '', onclick: () => { state.sceneId = s.id; render(); } }, `${s.idx}. ${s.heading}`, h('span', { class: 'muted' }, ` · ${s.shots.length}`))) : h('p', { class: 'muted' }, 'No scenes.')),
    h('h3', {}, 'Script → shots (AI Director)'),
    h('button', { onclick: () => directorDialog() }, 'Break down a script…'),
    h('h3', {}, 'Export selected takes'),
    h('div', { class: 'row' }, ['edl', 'fcpxml', 'otio'].map((f) => h('a', { href: `/api/projects/${p.id}/export/${f}`, class: 'badge' }, f.toUpperCase()))),
    h('p', { class: 'muted', style: 'font-size:12px' }, 'Import in DaVinci Resolve via File › Import › Timeline.'));

  let right;
  if (!scene) right = emptySteps([['Add a scene', 'Use “+ Scene”, or paste a script into “Break down a script…”.'], ['Set the scene', 'Heading, location and time of day are inherited by every shot.'], ['Fill the storyboard', 'Add shots, then compose each one in OG Cinema Studio.']]);
  else {
    const heading = h('input', { value: scene.heading });
    const tod = h('select', {}, h('option', { value: '' }, '(inherit)'), state.vocab.time_of_day.map((o) => h('option', { value: o.id, selected: scene.settings?.shot_defaults?.lighting?.time_of_day === o.id }, o.label)));
    const loc = h('input', { value: scene.settings?.shot_defaults?.location ?? '', placeholder: '@location handle or description' });
    right = h('div', {},
      h('div', { class: 'panel' }, h('div', { class: 'grid g3' }, h('label', {}, 'Scene heading', heading), h('label', {}, 'Location (inherited by shots)', loc), h('label', {}, 'Time of day (inherited)', tod)),
        h('div', { class: 'row', style: 'margin-top:10px' },
          h('button', { onclick: guard(async () => { await PATCH(`/api/scenes/${scene.id}`, { heading: heading.value, settings: { ...scene.settings, shot_defaults: { ...(scene.settings?.shot_defaults ?? {}), location: loc.value, lighting: { ...(scene.settings?.shot_defaults?.lighting ?? {}), time_of_day: tod.value } } } }); toast('Scene saved', 'ok'); render(); }) }, 'Save scene'),
          h('button', { onclick: guard(async () => { const s = await POST(`/api/scenes/${scene.id}/shots`, { title: `Shot ${scene.shots.length + 1}`, spec: { intent: { summary: '' } } }); go('cinema', { shotId: s.id }); }) }, '+ Shot'),
          h('span', { style: 'flex:1' }), provSel,
          h('button', { class: 'primary', onclick: guard(async () => {
            const r = await POST(`/api/scenes/${scene.id}/generate-all`, { provider: provSel.value });
            const bad = r.results.filter((x) => !x.ok);
            const pending = r.results.filter((x) => x.ok && x.status === 'awaiting_approval');
            modal(h('div', {}, h('h1', {}, 'Batch generation'),
              h('table', {}, h('tr', {}, h('th', {}, 'Shot'), h('th', {}, 'Result')), r.results.map((x) => h('tr', {}, h('td', {}, x.title), h('td', {}, x.ok ? h('span', {}, statusBadge(x.status), x.duplicate ? ' (already generated)' : '', x.usd ? ` ${usd(x.usd)}` : '') : h('span', { class: 'err' }, x.errors.join('; ')))))),
              pending.length ? h('div', {}, h('p', {}, `${pending.length} paid jobs await approval, total ${usd(r.awaiting_approval_usd)}. Type the total to approve all:`), (() => {
                const inp = h('input', { placeholder: r.awaiting_approval_usd.toFixed(4) });
                return h('div', { class: 'row' }, inp, h('button', { class: 'primary', onclick: guard(async () => { const a = await POST('/api/jobs/approve-batch', { job_ids: pending.map((x) => x.job_id), confirm_usd_total: Number(inp.value) }); closeModal(); toast(`Approved ${a.results.filter((x) => x.ok).length}/${pending.length}`, 'ok'); }) }, 'Approve all'));
              })()) : null,
              bad.length ? h('p', { class: 'warnc' }, `${bad.length} shots need fixes before they can generate.`) : null,
              h('div', { class: 'row', style: 'justify-content:flex-end' }, h('button', { onclick: closeModal }, 'Close'))), { wide: true });
          }) }, 'Generate scene'))),
      h('h2', {}, 'Storyboard'),
      scene.shots.length ? h('div', { class: 'cards' }, scene.shots.map((s) => shotCard(s))) : emptySteps([['+ Shot', 'Add a shot to this scene (or let the AI Director plan coverage).'], ['Compose', 'Open it in OG Cinema Studio — camera, movement, light, look.'], ['Generate scene', 'Generate every shot at once; paid models ask once for the total.']]));
  }
  main.replaceChildren(h('h1', {}, 'Scene Builder'), h('p', { class: 'sub' }, `${p.name} — scenes, shot lists and storyboard.`), h('div', { class: 'split' }, left, right));
};

function shotCard(s) {
  const spec = s.spec ?? {};
  return h('div', { class: 'panel tight shot-card', onclick: () => go('cinema', { shotId: s.id }) },
    s.selected_output_asset_id ? thumbFor(s.selected_output_asset_id)
      : h('div', { class: 'thumb', style: 'display:flex;align-items:center;justify-content:center;color:#3c4250;font-size:22px' }, spec.framing?.shot_size ?? '—'),
    h('div', { class: 'row', style: 'justify-content:space-between' }, h('b', {}, `${s.idx}. ${s.title}`), statusBadge(s.status)),
    h('div', { class: 'meta' }, [spec.framing?.shot_size, spec.camera?.movement, spec.lens?.focal_mm && `${spec.lens.focal_mm}mm`, spec.duration_s && `${spec.duration_s}s`].filter(Boolean).join(' · ') || 'inherits scene/project'),
    h('div', { class: 'meta' }, (spec.intent?.summary ?? '').slice(0, 110)));
}

function directorDialog() {
  const ta = h('textarea', { class: 'script', placeholder: 'Paste a screenplay (INT./EXT. headings, CHARACTER cues, dialogue)…' });
  const out = h('div');
  let result = null;
  modal(h('div', {}, h('h1', {}, 'AI Director — script breakdown'),
    h('p', { class: 'sub' }, 'Deterministic coverage plan (no LLM, no cost). Creates new scenes and draft shots; never changes existing ones.'),
    ta, h('div', { class: 'row', style: 'margin:10px 0' },
      h('button', { onclick: guard(async () => {
        result = await POST('/api/director/breakdown', { script: ta.value, project_id: state.projectId });
        out.replaceChildren(h('p', {}, `${result.scenes.length} scenes · ${result.scenes.reduce((n, s) => n + s.shots.length, 0)} shots · characters: ${result.characters.map((c) => c.handle).join(', ') || '—'}`),
          ...result.scenes.map((s) => h('details', { open: result.scenes.length < 3 }, h('summary', {}, s.heading), h('table', {}, s.shots.map((sh) => h('tr', {}, h('td', {}, sh.title), h('td', { class: 'muted' }, sh.rationale)))))));
      }) }, 'Break down'),
      h('label', { class: 'inline' }, h('input', { type: 'checkbox', id: 'mkrefs', checked: true }), 'Create character references'),
      h('span', { style: 'flex:1' }),
      h('button', { class: 'primary', onclick: guard(async () => {
        if (!result) throw new Error('Break down first');
        await POST(`/api/projects/${state.projectId}/director/apply`, { breakdown: result, script: ta.value, create_character_refs: $('#mkrefs').checked });
        closeModal(); toast('Scenes and shots created', 'ok'); render();
      }) }, 'Create scenes & shots')), out), { wide: true });
}

// --- OG Cinema Studio -----------------------------------------------------------
VIEWS.cinema = async () => {
  if (needProject()) return;
  await reloadProject();
  const p = state.project;
  const allShots = p.scenes.flatMap((sc) => sc.shots.map((s) => ({ ...s, scene: sc })));
  if (!state.shotId || !allShots.some((s) => s.id === state.shotId)) state.shotId = allShots[0]?.id ?? null;
  const picker = h('select', { onchange: (e) => { Object.assign(state, { shotId: e.target.value, urlProvider: null, urlPreset: null }); writeUrl(false); render(); } }, allShots.map((s) => h('option', { value: s.id, selected: s.id === state.shotId }, `${s.scene.idx}.${s.idx} ${s.title}`)));
  if (!state.shotId) { main.replaceChildren(h('h1', {}, 'OG Cinema Studio'), emptySteps([['Plan scenes', 'Create a scene in Scene Builder, or break down a script with the AI Director.'], ['Add shots', 'Each shot gets its own spec; scenes pass down location and light.'], ['Compose here', 'Come back to set camera, movement, light and look, then generate.']]), h('button', { class: 'primary', style: 'margin-top:12px', onclick: () => go('scenes') }, 'Open Scene Builder')); return; }
  const [shot, eff, refs, assets, presets] = await Promise.all([GET(`/api/shots/${state.shotId}`), GET(`/api/shots/${state.shotId}/effective`), GET(`/api/projects/${p.id}/refs`), GET(`/api/projects/${p.id}/assets`), GET(`/api/presets?project_id=${p.id}`)]);
  const V = state.vocab;
  const spec = structuredClone(shot.spec ?? {});
  // URL → draft: a link's model and preset load as unsaved changes (Save or Generate keeps them).
  if (state.urlProvider && state.providers.some((pr) => pr.id === state.urlProvider) && state.urlProvider !== spec.model_pref?.provider) {
    spec.model_pref = { ...(spec.model_pref ?? {}), provider: state.urlProvider };
  } else state.urlProvider = spec.model_pref?.provider || null;
  const linkPreset = state.urlPreset && presets.find((x) => x.id === state.urlPreset);
  if (linkPreset && spec.preset_id !== linkPreset.id) {
    mergeInto(spec, linkPreset.data);
    spec.preset_id = linkPreset.id;
    toast(`Preset "${linkPreset.name}" loaded from the link — not saved yet`);
  } else if (!state.urlPreset && spec.preset_id) state.urlPreset = spec.preset_id;
  const E = eff.spec;
  const g = (path) => path.split('.').reduce((a, k) => a?.[k], spec);
  const ge = (path) => path.split('.').reduce((a, k) => a?.[k], E);
  const set = (path, val) => { const ks = path.split('.'); let o = spec; for (const k of ks.slice(0, -1)) o = o[k] ??= {}; o[ks.at(-1)] = val; };

  // Field builders: blank = inherit (placeholder shows the inherited value).
  const sel = (path, cat, label) => h('label', {}, label, h('select', { onchange: (e) => set(path, e.target.value) },
    h('option', { value: '' }, `(inherit${ge(path) && !g(path) ? `: ${V[cat].find((o) => o.id === ge(path))?.label ?? ge(path)}` : ''})`),
    V[cat].map((o) => h('option', { value: o.id, selected: g(path) === o.id }, o.label))));
  const num = (path, label, attrs = {}) => h('label', {}, label, h('input', { type: 'number', value: g(path) ?? '', placeholder: ge(path) ?? '', class: g(path) == null ? 'inherited' : '', oninput: (e) => set(path, e.target.value === '' ? null : Number(e.target.value)), ...attrs }));
  const txt = (path, label, attrs = {}) => h('label', {}, label, h(attrs.area ? 'textarea' : 'input', { value: g(path) ?? '', placeholder: ge(path) || attrs.ph || '', oninput: (e) => set(path, e.target.value) }));
  const plain = (path, label, opts) => h('label', {}, label, h('select', { onchange: (e) => set(path, e.target.value) }, h('option', { value: '' }, `(inherit${ge(path) ? `: ${ge(path)}` : ''})`), opts.map((o) => h('option', { selected: g(path) === o }, o))));

  const title = h('input', { value: shot.title });
  let composer = null;
  const wfSel = h('select', { onchange: (e) => set('workflow', e.target.value) }, h('option', { value: '' }, 'auto (from inputs)'), ['generate', 'image_to_video', 'first_last_frame', 'reference_to_video', 'edit', 'extend'].map((w) => h('option', { value: w, selected: spec.workflow === w }, w)));

  // Subjects + references editors
  const subjList = h('div');
  const drawSubjects = () => subjList.replaceChildren(...(spec.subjects ?? []).map((s, i) => h('div', { class: 'grid g3', style: 'margin-bottom:6px' },
    h('select', { onchange: (e) => { s.ref = e.target.value; } }, refs.map((r) => h('option', { value: r.handle, selected: r.handle === s.ref }, `${r.handle} (${r.type})`))),
    h('input', { value: s.wardrobe ?? '', placeholder: 'wardrobe', oninput: (e) => { s.wardrobe = e.target.value; } }),
    h('div', { class: 'row' }, h('input', { value: s.blocking ?? '', placeholder: 'blocking / action', oninput: (e) => { s.blocking = e.target.value; } }), h('button', { class: 'danger', onclick: () => { spec.subjects.splice(i, 1); drawSubjects(); } }, '×')))),
    h('button', { disabled: !refs.length, onclick: () => { (spec.subjects ??= []).push({ ref: refs[0].handle }); drawSubjects(); } }, refs.length ? '+ Subject' : 'Add references in Reference Studio first'));
  const refList = h('div');
  const mediaAssets = assets.filter((a) => ['image', 'video', 'audio'].includes(a.kind));
  const drawRefs = () => refList.replaceChildren(...(spec.references ?? []).map((r, i) => h('div', { class: 'grid g3', style: 'margin-bottom:6px' },
    h('select', { onchange: (e) => { r.role = e.target.value; } }, ['first_frame', 'last_frame', 'reference_image', 'reference_video', 'reference_audio'].map((x) => h('option', { selected: r.role === x }, x))),
    h('select', { onchange: (e) => { r.asset_id = e.target.value; } }, mediaAssets.map((a) => h('option', { value: a.id, selected: a.id === r.asset_id }, `${a.kind}: ${a.filename}`))),
    h('div', { class: 'row' }, h('input', { value: r.note ?? '', placeholder: 'what this reference is for', oninput: (e) => { r.note = e.target.value; } }), h('button', { class: 'danger', onclick: () => { spec.references.splice(i, 1); drawRefs(); } }, '×')))),
    h('div', { class: 'row' }, h('button', { disabled: !mediaAssets.length, onclick: () => { (spec.references ??= []).push({ role: 'reference_image', asset_id: mediaAssets[0].id }); drawRefs(); } }, '+ Reference input'),
      h('button', { onclick: guard(async () => { await save(); const r = await POST(`/api/shots/${shot.id}/chain-from-previous`); toast(r.note, 'ok'); render(); }) }, 'Continue from previous shot\'s last frame')));
  const dlgList = h('div');
  const drawDialogue = () => dlgList.replaceChildren(...(spec.dialogue ?? []).map((d, i) => h('div', { class: 'grid', style: 'grid-template-columns:160px 1fr 70px 70px 32px;margin-bottom:6px' },
    h('select', { onchange: (e) => { d.speaker = e.target.value; } }, h('option', { value: '' }, 'speaker'), refs.filter((r) => r.type === 'character').map((r) => h('option', { value: r.handle, selected: r.handle === d.speaker }, r.handle))),
    h('input', { value: d.line ?? '', placeholder: 'line (exact wording)', oninput: (e) => { d.line = e.target.value; } }),
    h('input', { type: 'number', value: d.start_s ?? '', placeholder: 'start s', oninput: (e) => { d.start_s = e.target.value === '' ? null : Number(e.target.value); } }),
    h('input', { type: 'number', value: d.end_s ?? '', placeholder: 'end s', oninput: (e) => { d.end_s = e.target.value === '' ? null : Number(e.target.value); } }),
    h('button', { class: 'danger', onclick: () => { spec.dialogue.splice(i, 1); drawDialogue(); } }, '×'))),
    h('button', { onclick: () => { (spec.dialogue ??= []).push({ line: '' }); drawDialogue(); } }, '+ Line'));
  const beatList = h('div');
  const drawBeats = () => beatList.replaceChildren(...(spec.timeline ?? []).map((b, i) => h('div', { class: 'grid', style: 'grid-template-columns:70px 70px 1fr 170px 32px;margin-bottom:6px' },
    h('input', { type: 'number', value: b.start_s, oninput: (e) => { b.start_s = Number(e.target.value); } }), h('input', { type: 'number', value: b.end_s, oninput: (e) => { b.end_s = Number(e.target.value); } }),
    h('input', { value: b.action ?? '', placeholder: 'what happens in this beat', oninput: (e) => { b.action = e.target.value; } }),
    h('select', { onchange: (e) => { b.camera = e.target.value; } }, h('option', { value: '' }, 'camera (same)'), V.movement.map((o) => h('option', { value: o.id, selected: b.camera === o.id }, o.label))),
    h('button', { class: 'danger', onclick: () => { spec.timeline.splice(i, 1); drawBeats(); } }, '×'))),
    h('button', { onclick: () => { const tl = (spec.timeline ??= []); const s0 = tl.at(-1)?.end_s ?? 0; tl.push({ start_s: s0, end_s: Math.min(s0 + 2, E.duration_s), action: '' }); drawBeats(); } }, '+ Timed beat'));
  drawSubjects(); drawRefs(); drawDialogue(); drawBeats();

  const palette = h('input', { value: (g('look.palette') ?? []).join(', '), placeholder: (ge('look.palette') ?? []).join(', ') || '#E8B07A, #2F4A5A', oninput: (e) => set('look.palette', e.target.value.split(/[\s,]+/).filter(Boolean)) });
  const negative = h('input', { value: (spec.negative ?? []).join(', '), placeholder: 'e.g. text, watermark, extra fingers', oninput: (e) => { spec.negative = e.target.value.split(',').map((x) => x.trim()).filter(Boolean); } });

  async function save() { spec.model_pref = { ...(spec.model_pref ?? {}), provider: composer?.providerId() ?? 'mock' }; await PATCH(`/api/shots/${shot.id}`, { title: title.value, spec }); }
  const planOut = h('div');
  const showPlan = guard(async () => {
    await save();
    const plan = await POST(`/api/shots/${shot.id}/plan`, { provider: composer.providerId() });
    planOut.replaceChildren(planView(plan));
  });

  const presetSel = h('select', {}, h('option', { value: '' }, 'Apply preset…'), presets.filter((pr) => pr.kind !== 'recipe').map((pr) => h('option', { value: pr.id }, `${pr.kind === 'look' ? 'Look' : 'Shot'} · ${pr.name}`)));
  presetSel.addEventListener('change', guard(async () => { if (!presetSel.value) return; await save(); await POST(`/api/shots/${shot.id}/apply-preset`, { preset_id: presetSel.value }); state.urlPreset = presetSel.value; toast('Preset applied (story content kept)', 'ok'); render(); }));

  const form = h('div', {},
    h('fieldset', {}, h('legend', {}, 'Intent'), h('div', { class: 'grid g2' }, txt('intent.action', 'Action / blocking', { area: true }), txt('intent.emotion', 'Emotion / subtext')),
      spec.director_note ? h('p', { class: 'muted' }, `Director: ${spec.director_note}`) : null),
    h('fieldset', {}, h('legend', {}, 'Framing & camera'), h('div', { class: 'grid g3' }, sel('framing.shot_size', 'shot_size', 'Shot size'), sel('framing.angle', 'angle', 'Angle'), txt('framing.composition', 'Composition'),
      sel('camera.movement', 'movement', 'Movement'), sel('camera.speed', 'speed', 'Speed'), sel('camera.rig', 'rig', 'Rig'), txt('camera.notes', 'Camera notes'))),
    h('fieldset', {}, h('legend', {}, 'Lens'), h('div', { class: 'grid g4' }, num('lens.focal_mm', 'Focal length (mm)', { min: 8, max: 600 }), num('lens.aperture', 'Aperture (f/)', { step: 0.1, min: 0.95, max: 22 }), sel('lens.character', 'lens_character', 'Lens character'), sel('lens.dof', 'dof', 'Depth of field'))),
    h('fieldset', {}, h('legend', {}, 'Lighting & atmosphere'), h('div', { class: 'grid g4' }, sel('lighting.key_direction', 'key_direction', 'Key direction'), sel('lighting.quality', 'light_quality', 'Quality'), sel('lighting.contrast', 'contrast', 'Contrast'), num('lighting.color_temp_k', 'Colour temp (K)', { step: 100, min: 1800, max: 12000 }),
      sel('lighting.time_of_day', 'time_of_day', 'Time of day'), txt('lighting.motivation', 'Motivation (practicals, window…)'), sel('atmosphere.type', 'atmosphere', 'Atmosphere'), sel('pacing.tempo', 'tempo', 'Tempo'))),
    h('fieldset', {}, h('legend', {}, 'Look'), h('div', { class: 'grid g4' }, sel('look.genre', 'genre', 'Genre'), sel('look.era', 'era', 'Era'), sel('look.camera_body', 'camera_body', 'Camera / sensor look'), sel('look.texture', 'texture', 'Texture')),
      h('div', { class: 'grid g2' }, h('label', {}, 'Palette (hex)', palette), txt('look.grade_notes', 'Grade notes'))),
    h('fieldset', {}, h('legend', {}, 'Subjects & location'), subjList, txt('location', 'Location (@handle or text)')),
    h('fieldset', {}, h('legend', {}, 'Reference inputs'), h('p', { class: 'muted', style: 'margin:0 0 6px' }, 'First/last frames lock the storyboard; reference images/video/audio lock identity and motion. Seedance cannot mix the two modes in one request.'), refList),
    h('fieldset', {}, h('legend', {}, 'Dialogue & audio'), dlgList,
      h('div', { class: 'grid g3' }, txt('audio.ambience', 'Ambience'), txt('audio.sfx', 'Sound effects'), txt('audio.music', 'Music'))),
    h('fieldset', {}, h('legend', {}, 'Timed beats (optional)'), beatList),
    h('fieldset', {}, h('legend', {}, 'Generation'), h('div', { class: 'grid g2' }, h('label', {}, 'Workflow', wfSel), h('label', {}, 'Avoid', negative))));

  composer = buildComposer(UI, { shot, spec, E, refs, assets, V, providers: state.providers, save, rerender: render,
    onPlan: (pl) => { if (paneTab === 'plan') pane.replaceChildren(planView(pl)); },
    onProvider: (v) => { state.urlProvider = v; writeUrl(); } });

  // Right pane: Takes (list/grid + size) | Plan | How it works
  let paneTab = 'takes';
  let view = localStorage.getItem('takesView') ?? 'list';
  let size = Number(localStorage.getItem('takesSize') ?? 160);
  const pane = h('div');
  const paneTabs = h('div', { class: 'tabs' });
  const drawPane = () => {
    paneTabs.replaceChildren(...[['takes', `Takes (${shot.jobs.length})`], ['plan', 'Plan'], ['how', 'How it works']].map(([k, l]) => h('button', { class: paneTab === k ? 'on' : '', onclick: () => { paneTab = k; drawPane(); } }, l)));
    if (paneTab === 'takes') {
      const list = h('div', { class: `takes ${view === 'grid' ? 'gridview' : ''}`, style: `--tile:${size}px` },
        shot.jobs.length ? shot.jobs.map((j) => (view === 'grid' ? miniTake(j, shot) : takeCard(j, shot)))
          : emptySteps([['Describe', 'Write what the shot shows; type @ to bring in a character or location.'], ['Set the look', 'Use the tiles — camera, movement, lighting, palette. Auto inherits from the scene.'], ['Generate', 'Pick model, length and takes. Paid models always ask before spending.']]));
      const bar = h('div', { class: 'row', style: 'margin-bottom:8px' },
        h('span', { class: 'seg' }, ...['list', 'grid'].map((v) => h('button', { class: view === v ? 'on' : '', onclick: () => { view = v; localStorage.setItem('takesView', v); drawPane(); } }, v === 'list' ? 'List' : 'Grid'))),
        view === 'grid' ? h('input', { type: 'range', min: 110, max: 320, value: size, style: 'width:120px', oninput: (e) => { size = Number(e.target.value); localStorage.setItem('takesSize', String(size)); list.style.setProperty('--tile', `${size}px`); } }) : null);
      pane.replaceChildren(bar, list);
    } else if (paneTab === 'plan') {
      const pl = composer.getPlan();
      pane.replaceChildren(pl ? planView(pl) : h('p', { class: 'muted' }, 'Calculating…'));
    } else pane.replaceChildren(howItWorks());
  };
  drawPane();

  main.replaceChildren(
    h('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:10px' }, h('div', {}, h('h1', {}, 'OG Cinema Studio'), h('p', { class: 'sub', style: 'margin:0' }, 'Compose the shot; tiles show what is set, Auto inherits from scene and project.')), picker),
    h('div', { class: 'row', style: 'margin-bottom:12px' }, h('label', { style: 'flex:1' }, 'Shot title', title), presetSel,
      h('button', { onclick: guard(async () => { await save(); toast('Shot saved', 'ok'); }) }, 'Save'),
      h('button', { onclick: guard(async () => { const name = prompt('Preset name'); if (!name) return; await save(); await POST('/api/presets', { name, kind: 'shot', data: spec, project_id: p.id }); toast('Preset saved', 'ok'); }) }, 'Save as preset')),
    h('div', { class: 'split-r' },
      h('div', {}, composer.el,
        h('details', { style: 'margin-top:14px' }, h('summary', { style: 'cursor:pointer;color:var(--muted)' }, 'All controls (subjects, dialogue, timed beats, composition, workflow…)'),
          h('div', { style: 'margin-top:10px' }, form, h('button', { onclick: showPlan }, 'Preview full plan'), planOut))),
      h('div', { class: 'panel' }, paneTabs, pane)));
};

function miniTake(j, shot) {
  return h('div', { class: 'panel tight', style: 'padding:6px' },
    j.output_asset_id ? h('video', { src: `/api/assets/${j.output_asset_id}/file`, muted: true, loop: true, preload: 'metadata', onmouseenter: (e) => e.target.play(), onmouseleave: (e) => e.target.pause() })
      : h('div', { class: 'thumb', style: 'display:flex;align-items:center;justify-content:center' }, statusBadge(j.status)),
    h('div', { class: 'row', style: 'justify-content:space-between;font-size:11.5px;margin-top:4px' }, h('span', { class: 'muted' }, ago(j.created_at)),
      shot.selected_job_id === j.id ? h('span', { class: 'badge accent' }, 'selected') : (j.output_asset_id ? h('a', { onclick: guard(async () => { await PATCH(`/api/shots/${shot.id}`, { selected_job_id: j.id }); render(); }) }, 'select') : null)));
}
function emptySteps(steps) {
  return h('div', { class: 'steps3' }, steps.map(([t, d], i) => h('div', {}, h('b', {}, i + 1), h('strong', {}, t), h('p', { class: 'muted', style: 'margin:4px 0 0;font-size:12.5px' }, d))));
}
function howItWorks() {
  return h('div', {}, emptySteps([['Compose', 'Prompt + tiles build a structured shot spec — reusable across models.'], ['Compile', 'The spec is compiled per model: real API parameters where they exist, best-effort wording elsewhere.'], ['Review', 'Takes land here and in Quality Review; select the best one for the edit.']]),
    h('ul', { class: 'clean muted', style: 'margin-top:12px;font-size:12.5px' },
      h('li', {}, 'Camera, lens and lighting choices are guidance for the model, not physical controls — the Plan tab shows exactly how each is delivered.'),
      h('li', {}, 'Several moves in the Movement stack are sent in order ("first … then …").'),
      h('li', {}, 'Takes > 1 generate variants; paid models ask once for the total.')));
}

function planView(plan) {
  const cls = { api_param: 'good', reference: 'info', prompt: 'warn', unsupported: 'bad' };
  const txt = { api_param: 'API parameter (guaranteed)', reference: 'reference input', prompt: 'prompt (best effort)', unsupported: 'not supported' };
  return h('div', { class: 'panel' }, h('h2', { style: 'margin-top:0' }, `Plan — ${plan.provider} · ${plan.workflow}`),
    plan.errors.length ? h('div', { class: 'err' }, h('b', {}, 'Cannot generate:'), h('ul', { class: 'clean' }, plan.errors.map((e) => h('li', {}, e)))) : h('p', { class: 'ok' }, 'Request is valid.'),
    plan.warnings.length ? h('ul', { class: 'clean warnc' }, plan.warnings.map((e) => h('li', {}, e))) : null,
    h('div', { class: 'kv' }, h('div', {}, 'Estimate'), h('div', {}, usd(plan.estimate.usd), ' ', h('span', { class: 'badge' }, plan.estimate.confidence), h('div', { class: 'muted mono' }, plan.estimate.basis)),
      h('div', {}, 'Inputs'), h('div', {}, plan.inputs.length ? plan.inputs.map((i) => h('div', {}, h('span', { class: 'badge info' }, i.token ?? i.role), ' ', i.role, ' — ', i.filename ?? i.label)) : 'none')),
    h('h3', {}, 'Prompt'), h('pre', {}, plan.prompt),
    h('h3', {}, 'Control report'), h('table', {}, h('tr', {}, h('th', {}, 'Setting'), h('th', {}, 'Value'), h('th', {}, 'Delivered as'), h('th', {}, 'Note')),
      plan.report.map((r) => h('tr', {}, h('td', {}, r.field), h('td', { class: 'mono' }, typeof r.value === 'object' ? JSON.stringify(r.value).slice(0, 60) : String(r.value)), h('td', {}, h('span', { class: `badge ${cls[r.delivered_as]}` }, txt[r.delivered_as])), h('td', { class: 'muted' }, r.note)))),
    plan.wire_preview ? h('details', {}, h('summary', {}, 'Exact request body (media elided)'), h('pre', {}, JSON.stringify(plan.wire_preview, null, 2))) : null);
}

function takeCard(j, shot) {
  const selected = shot.selected_job_id === j.id;
  return h('div', { class: 'panel tight', style: 'margin-bottom:10px' },
    h('div', { class: 'row', style: 'justify-content:space-between' }, h('span', {}, statusBadge(j.status), ' ', h('span', { class: 'muted' }, `${j.provider} · ${ago(j.created_at)}`), j.provider === 'local-h3' ? [' ', h('span', { class: 'badge accent' }, 'MiniMax H3')] : null), selected ? h('span', { class: 'badge accent' }, 'selected') : null),
    j.output_asset_id ? h('video', { src: `/api/assets/${j.output_asset_id}/file`, controls: true, preload: 'metadata' }) : null,
    j.status === 'running' && j.result?.progress != null ? h('div', { class: 'progress' }, h('i', { style: `width:${Math.round(j.result.progress * 100)}%` })) : null,
    j.error ? h('div', { class: 'err', style: 'font-size:12px' }, `${j.error.category}: ${j.error.message}`) : null,
    h('div', { class: 'row', style: 'margin-top:6px' },
      j.status === 'awaiting_approval' ? h('button', { class: 'primary', onclick: () => approvalDialog(j) }, `Review ${usd(j.estimate?.usd)}`) : null,
      j.output_asset_id && !selected ? h('button', { onclick: guard(async () => { await PATCH(`/api/shots/${shot.id}`, { selected_job_id: j.id }); render(); }) }, 'Select take') : null,
      j.output_asset_id ? h('a', { class: 'badge', href: `/api/assets/${j.output_asset_id}/file?download=1` }, 'Download') : null,
      j.output_asset_id ? h('button', { onclick: () => go('qc', { qcAsset: j.output_asset_id }) }, 'QC') : null,
      ['queued', 'running', 'awaiting_approval'].includes(j.status) ? h('button', { class: 'danger', onclick: guard(async () => { await POST(`/api/jobs/${j.id}/cancel`); render(); }) }, 'Cancel') : null,
      j.status === 'needs_review' && j.provider_task_id ? h('button', { onclick: guard(async () => { await POST(`/api/jobs/${j.id}/recheck`); render(); }) }, 'Recheck') : null),
    h('details', {}, h('summary', { class: 'muted' }, 'Prompt & settings'), h('pre', {}, j.request?.prompt ?? ''), h('pre', {}, JSON.stringify(j.request?.params ?? {}, null, 1))));
}

// --- Reference Studio ----------------------------------------------------------
VIEWS.references = async () => {
  if (needProject()) return;
  const p = state.project;
  const [refs, assets] = await Promise.all([GET(`/api/projects/${p.id}/refs`), GET(`/api/projects/${p.id}/assets`)]);
  const TYPES = ['character', 'wardrobe', 'prop', 'location', 'lighting', 'production_design', 'palette', 'camera_language'];
  const name = h('input', { placeholder: 'Name (e.g. Mira)' }), type = h('select', {}, TYPES.map((t) => h('option', {}, t))), desc = h('textarea', { placeholder: 'Description used in prompts: age, build, hair, signature wardrobe… (be specific and stable)' });
  const pick = h('select', { multiple: true, size: 6 }, assets.filter((a) => a.kind !== 'other').map((a) => h('option', { value: a.id }, `${a.kind}: ${a.filename}`)));
  const consent = h('input', { type: 'checkbox' });
  main.replaceChildren(h('h1', {}, 'Reference Studio'), h('p', { class: 'sub' }, 'Reusable references for characters, wardrobe, props, locations and look. Use their @handle in any shot; shots inherit them.'),
    h('div', { class: 'split' },
      h('div', { class: 'panel' }, h('h3', {}, 'New reference'), h('div', { class: 'grid' }, name, type, desc, h('label', {}, 'Attach media (Ctrl-click for several)', pick),
        h('label', { class: 'inline' }, consent, 'Real person: I hold written likeness consent'),
        h('button', { class: 'primary', onclick: guard(async () => {
          await POST(`/api/projects/${p.id}/refs`, { name: name.value, type: type.value, description: desc.value, asset_ids: [...pick.selectedOptions].map((o) => o.value), consent: consent.checked ? { likeness_consent: true, recorded_at: new Date().toISOString() } : {} });
          toast('Reference created', 'ok'); render();
        }) }, 'Create')), h('p', { class: 'muted', style: 'font-size:12px' }, 'Note: Seedance 2.5 refuses reference media showing real faces unless it is an authorized asset:// ID from BytePlus. Generated characters from your own account (within 30 days) are accepted.')),
      h('div', {}, refs.length ? TYPES.filter((t) => refs.some((r) => r.type === t)).map((t) => h('div', {}, h('h2', {}, t.replace('_', ' ')), h('div', { class: 'cards' }, refs.filter((r) => r.type === t).map((r) => h('div', { class: 'panel tight' },
        r.asset_ids[0] ? thumbFor(r.asset_ids[0]) : h('div', { class: 'thumb' }),
        h('div', { class: 'row', style: 'justify-content:space-between;margin-top:6px' }, h('b', {}, r.name), h('code', {}, r.handle)),
        h('div', { class: 'muted', style: 'font-size:12px' }, r.description || 'no description'),
        h('div', { class: 'muted', style: 'font-size:12px' }, `${r.asset_ids.length} media`, r.consent?.likeness_consent ? ' · consent recorded' : ''),
        h('div', { class: 'row', style: 'margin-top:6px' },
          h('button', { onclick: guard(async () => { const d = prompt('Description', r.description); if (d == null) return; await PATCH(`/api/refs/${r.id}`, { description: d }); render(); }) }, 'Edit'),
          h('button', { class: 'danger', onclick: guard(async () => { if (!confirm(`Delete reference ${r.handle}? Media stays in the library.`)) return; await DEL(`/api/refs/${r.id}`); render(); }) }, 'Delete')))))))
        : emptySteps([['Upload stills', 'Add character, prop or location images in the Asset Library (rights + consent).'], ['Create a reference', 'Name it, write a stable visual description, attach the images.'], ['Use @name', 'Type @ in OG Cinema Studio; swaps in OG Genjutsu pick from here too.']]))));
};

// --- OG Katana (reference-driven) & OG Genjutsu (swaps) ---------------------------
const TRANSFORM_STUDIOS = {
  katana: { title: 'OG Katana', sub: "Reference-driven editing: analyse a reference video's shots and timing, then recreate it with your subjects, restyle it or extend it. Results are new generations — the source file is never modified. Revise any shot later in Edit Studio; earlier takes are kept.", analyse: true },
  genjutsu: { title: 'OG Genjutsu', sub: "Keep a clip's performance, camera and timing while changing who or what is in it: character / face swap, motion transfer, object swap, selective change. Results are regenerated footage, not pixel-preserving edits; the source file is never modified.", analyse: false },
};
VIEWS.katana = () => transformStudio('katana');
VIEWS.genjutsu = () => transformStudio('genjutsu');
async function transformStudio(kind) {
  const cfg = TRANSFORM_STUDIOS[kind];
  if (needProject()) return;
  await reloadProject();
  const p = state.project;
  const [assets, refs, allTransforms, jobs] = await Promise.all([GET(`/api/projects/${p.id}/assets?kind=video`), GET(`/api/projects/${p.id}/refs`), GET('/api/transforms'), GET(`/api/projects/${p.id}/jobs`)]);
  const transforms = Object.fromEntries(Object.entries(allTransforms).filter(([, v]) => v.studio === kind)
    .sort(([a], [b]) => (b === 'character_swap') - (a === 'character_swap'))); // swaps are OG Genjutsu's main job
  const modeKey = `${kind}Mode`;
  let mode = transforms[state[modeKey]] ? state[modeKey] : Object.keys(transforms)[0];
  state[modeKey] = mode;
  // Default source: the explicitly chosen clip, else the newest upload (not a generated result).
  let srcId = assets.some((a) => a.id === state.motionSrc) ? state.motionSrc : (assets.find((a) => a.origin === 'upload') ?? assets[0])?.id ?? null;
  state.motionSrc = srcId;
  let analysis = null;
  const chosen = new Set();
  let swapScope = 'character'; // character swap: whole character | face only (best effort)
  const brief = h('textarea', { placeholder: kind === 'genjutsu' ? 'Optional: anything else to change or keep (e.g. "keep the red scarf")' : 'Creative brief: new subject, product, style or setting…' });
  const target = h('input', { placeholder: 'Who/what to replace, e.g. "the man in the blue jacket on the left"' });

  // ---- left column pieces
  const modeHost = h('div');
  const drawModes = () => modeHost.replaceChildren(h('div', { class: 'optgrid', style: 'grid-template-columns:repeat(auto-fill,minmax(170px,1fr))' },
    Object.entries(transforms).map(([k, v]) => h('div', { class: `ocard ${k === mode ? 'on' : ''}`, onclick: () => { mode = k; state[modeKey] = k; writeUrl(); drawModes(); drawExtras(); planBtn.lastChild.textContent = `Plan ${v.label}`; } },
      h('b', {}, v.label), h('small', {}, v.classification)))), h('p', { class: 'muted', style: 'font-size:12.5px' }, transforms[mode].note));
  const srcHost = h('div');
  const rights = h('input', { type: 'checkbox' });
  const drawSource = () => {
    const a = assets.find((x) => x.id === srcId);
    const zone = h('label', { class: `dropzone ${a ? 'filled' : ''}` },
      a ? h('div', { class: 'row', style: 'flex-wrap:nowrap' }, h('div', { style: 'width:120px;flex:none' }, thumbFor(a.id)),
        h('div', {}, h('b', {}, a.filename), h('div', { class: 'muted', style: 'font-size:12px' }, `${a.meta?.duration_s?.toFixed(1) ?? '?'} s · ${a.meta?.video?.fps ?? '?'} fps · ${a.meta?.video?.width ?? '?'}×${a.meta?.video?.height ?? '?'}`),
          h('a', { onclick: (e) => { e.preventDefault(); pickSource(); } }, 'Change')))
        : h('span', {}, 'Drop a source video here, or click to choose'),
      h('span', { class: 'lim' }, kind === 'genjutsu' ? 'Local H3 swap: 2–15 s · Seedance edit: 4–30 s · converted to 24 fps' : 'Reference clip: any length for analysis · up to 30 s per generation'));
    zone.onclick = (e) => { if (!a) { e.preventDefault(); pickSource(); } };
    zone.ondragover = (e) => { e.preventDefault(); zone.classList.add('over'); };
    zone.ondragleave = () => zone.classList.remove('over');
    zone.ondrop = guard(async (e) => {
      e.preventDefault(); zone.classList.remove('over');
      const file = e.dataTransfer.files[0]; if (!file) return;
      if (!rights.checked) throw new Error('Tick "I have the rights to use this clip" first.');
      const q = new URLSearchParams({ filename: file.name, rights_confirmed: '1' });
      const r = await api('PUT', `/api/projects/${p.id}/assets?${q}`, file, true);
      state.motionSrc = r.asset.id; render();
    });
    srcHost.replaceChildren(zone, h('label', { class: 'inline', style: 'margin-top:6px' }, rights, 'I have the rights to use this clip (for drag-and-drop uploads)'));
  };
  const pickSource = () => modal(h('div', {}, h('h1', {}, 'Choose source video'),
    assets.length ? h('div', { class: 'optgrid' }, assets.map((a) => h('div', { class: `ocard ${a.id === srcId ? 'on' : ''}`, onclick: () => { srcId = a.id; state.motionSrc = a.id; writeUrl(); analysis = null; closeModal(); drawSource(); drawExtras(); } },
      thumbFor(a.id), h('b', { style: 'font-size:12px;word-break:break-all' }, a.filename), h('small', {}, `${a.meta?.duration_s?.toFixed(1) ?? '?'} s · ${a.origin}`)))) : h('div', { class: 'empty' }, 'No videos yet — drop one on the source box or use the Asset Library.'),
    h('div', { class: 'row', style: 'justify-content:flex-end;margin-top:10px' }, h('button', { onclick: closeModal }, 'Close'))), { wide: true });

  const extras = h('div');
  const out = h('div');
  const drawExtras = () => {
    const needsRefs = ['character_swap', 'motion_transfer', 'object_swap', 'recreate'].includes(mode);
    extras.replaceChildren(...[ // replaceChildren() would print null/false as text — filter first
      ['character_swap', 'object_swap'].includes(mode) ? h('label', {}, 'Replace', target) : null,
      mode === 'character_swap' ? h('div', { style: 'margin-top:8px' }, h('span', { class: 'seg' },
        ...[['character', 'Whole character'], ['face', 'Face only (best effort)']].map(([v, l]) => h('button', { class: swapScope === v ? 'on' : '', onclick: () => { swapScope = v; drawExtras(); } }, l))),
        swapScope === 'face' ? h('p', { class: 'muted', style: 'font-size:12px;margin:4px 0 0' }, 'Keeps body, clothes, hair/headwear and pose; asks to change only the face. The swap LoRA was trained on whole-character swaps, so expect some drift.') : null) : null,
      needsRefs ? h('div', {}, h('h3', {}, mode === 'character_swap' ? 'Replacement character (<Picture 1>)' : 'Bring in references'),
        refs.length ? h('div', { class: 'optgrid', style: 'grid-template-columns:repeat(auto-fill,minmax(110px,1fr))' }, refs.filter((r) => mode !== 'character_swap' || ['character', 'wardrobe', 'prop'].includes(r.type)).map((r) => h('div', { class: `ocard ${chosen.has(r.handle) ? 'on' : ''}`, onclick: () => {
          if (mode === 'character_swap') { const on = chosen.has(r.handle); chosen.clear(); if (!on) chosen.add(r.handle); } else if (chosen.has(r.handle)) chosen.delete(r.handle); else chosen.add(r.handle);
          drawExtras(); } }, r.asset_ids?.[0] ? thumbFor(r.asset_ids[0]) : h('div', { class: 'thumb' }), h('b', { style: 'font-size:12px' }, r.handle), h('small', {}, r.type))))
          : h('p', { class: 'muted' }, 'No references yet — add the character image in Reference Studio (consent is recorded there).'),
        h('a', { onclick: () => go('references') }, '+ New reference in Reference Studio')) : null,
      h('label', { style: 'margin-top:8px' }, 'Brief', brief),
      cfg.analyse ? h('button', { style: 'margin-top:8px', onclick: guard(async () => {
        if (!srcId) throw new Error('Choose a source video first.');
        out.replaceChildren(h('p', { class: 'muted' }, 'Analysing…'));
        analysis = await POST(`/api/assets/${srcId}/analyze`, {});
        const st = analysis.soundtrack, ca = analysis.cut_alignment;
        out.replaceChildren(h('div', { class: 'panel' }, h('h3', {}, 'Edit rhythm'),
          h('div', { class: 'kv' }, h('div', {}, 'Shots'), h('div', {}, analysis.edit_rhythm.shot_count), h('div', {}, 'Average shot'), h('div', {}, `${analysis.edit_rhythm.average_shot_s}s`), h('div', {}, 'Cuts / min'), h('div', {}, analysis.edit_rhythm.cuts_per_minute), h('div', {}, 'Pacing'), h('div', {}, analysis.edit_rhythm.pacing),
            h('div', {}, 'Soundtrack'), h('div', {}, !st ? 'no audio track' : st.silent ? 'silent' : st.error ? `not analysed (${st.error})` : `${st.bpm ?? '?'} BPM · ${st.onset_count} hits · confidence ${Math.round((st.tempo_confidence ?? 0) * 100)}%`),
            ca ? [h('div', {}, 'Cuts on the beat'), h('div', {}, `${ca.on_beat} of ${ca.total} (±${ca.tolerance_ms} ms)`)] : null),
          rhythmStrip(analysis),
          h('div', { class: 'cards', style: 'margin-top:10px;grid-template-columns:repeat(auto-fill,minmax(120px,1fr))' }, analysis.segments.map((s) => h('div', {}, thumbFor(s.keyframe_asset_id), h('div', { class: 'muted', style: 'font-size:12px' }, `#${s.index} ${s.start_s}–${s.end_s}s`)))),
          h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { onclick: guard(async () => {
            const name = prompt('Recipe name', `${analysis.segments.length} shots · ${analysis.source.duration_s}s${st?.bpm ? ` · ${st.bpm} BPM` : ''}`);
            if (name == null) return;
            await POST(`/api/analyses/${analysis.id}/recipe`, { name, brief: brief.value });
            toast('Saved to Recipes', 'ok'); tab = 'recipes'; drawPane();
          }) }, 'Save as recipe'), h('span', { class: 'muted', style: 'font-size:12px' }, 'Reuse this timing later with new subjects.'))));
      }) }, 'Analyse shots & timing') : null, out].filter(Boolean));
  };

  const planBtn = h('button', { class: 'primary', style: 'width:100%;margin-top:12px;padding:10px', onclick: guard(async () => {
    if (!srcId) throw new Error('Choose a source video first.');
    if (mode === 'recreate' && !analysis) throw new Error('Run "Analyse shots & timing" first — recreation is planned per detected shot.');
    if (mode === 'character_swap' && !chosen.size) throw new Error('Pick the replacement character.');
    const r = await POST(`/api/projects/${p.id}/transform`, { type: mode, source_asset_id: srcId, analysis_id: analysis?.id, brief: brief.value, target: target.value, ref_handles: [...chosen], scope: swapScope });
    toast(`${r.shots.length} shot(s) planned — open it in OG Cinema Studio to generate`, 'ok');
    go('cinema', { shotId: r.shots[0].id });
  }) }, `Plan ${transforms[mode]?.label ?? 'transformation'}`);

  // ---- right pane: History | How it works
  const types = new Set(Object.keys(transforms));
  const myScenes = p.scenes.filter((sc) => types.has(sc.settings?.transform?.type));
  let tab = 'history';
  const pane = h('div'), tabs = h('div', { class: 'tabs' });
  const drawPane = () => {
    tabs.replaceChildren(...[['history', `History (${myScenes.reduce((n, sc) => n + sc.shots.length, 0)})`], ...(kind === 'katana' ? [['recipes', `Recipes (${recipes.length})`]] : []), ['how', 'How it works']].map(([k, l]) => h('button', { class: tab === k ? 'on' : '', onclick: () => { tab = k; drawPane(); } }, l)));
    if (tab === 'recipes') return drawRecipes();
    if (tab === 'how') return pane.replaceChildren(emptySteps(kind === 'genjutsu'
      ? [['Source', 'Drop the performance clip (2–15 s for local H3). It is never modified.'], ['Who becomes who', 'Say who to replace and pick the character from Reference Studio. Real people need recorded consent.'], ['Plan & generate', 'A new shot is planned; generate it in OG Cinema Studio, then compare before/after here.']]
      : [['Reference', 'Drop a reference edit and analyse its shots and timing.'], ['Recreate / restyle', 'Each reference shot becomes a new shot with your subjects; or restyle / extend a clip.'], ['Revise', 'Change any shot in Edit Studio — earlier takes are kept.']]),
      h('p', { class: 'muted', style: 'font-size:12.5px;margin-top:12px' }, 'Results are regenerated footage — not pixel-preserving edits. Use the before/after compare and Quality Review before using a take.'));
    if (!myScenes.length) return pane.replaceChildren(h('div', { class: 'empty' }, 'Nothing yet — plan a transformation on the left.'));
    pane.replaceChildren(...myScenes.slice().reverse().flatMap((sc) => sc.shots.map((s) => {
      const j = jobs.find((x) => x.shot_id === s.id);
      const srcAsset = sc.settings.transform.source_asset_id;
      return h('div', { class: 'panel tight', style: 'margin-bottom:8px' },
        h('div', { class: 'row', style: 'justify-content:space-between' }, h('b', { style: 'font-size:13px' }, s.title), j ? statusBadge(j.status) : h('span', { class: 'badge' }, 'planned')),
        s.selected_output_asset_id ? h('div', { style: 'margin-top:6px' }, wipeCompare(`/api/assets/${srcAsset}/file`, `/api/assets/${s.selected_output_asset_id}/file`, ['Before', 'After'])) : null,
        h('div', { class: 'row', style: 'margin-top:6px' }, h('button', { onclick: () => go('cinema', { shotId: s.id }) }, s.selected_output_asset_id ? 'Open shot' : 'Generate in OG Cinema Studio'),
          s.selected_output_asset_id ? h('button', { onclick: () => go('qc', { qcAsset: s.selected_output_asset_id }) }, 'QC') : null),
        // one conform button per recreation scene, under its last shot
        sc.settings.transform.type === 'recreate' && s === sc.shots.at(-1) ? conformRow(sc) : null);
    })));
  };
  // ---- OG Katana recipes + conform
  const recipes = kind === 'katana' ? (await GET(`/api/presets?project_id=${p.id}`)).filter((x) => x.kind === 'recipe' && x.project_id === p.id) : [];
  function drawRecipes() {
    if (!recipes.length) return pane.replaceChildren(emptySteps([['Analyse', 'Analyse a reference edit on the left (shots, timing, beat).'], ['Save as recipe', 'Keep its structure — shot lengths, keyframes, tempo.'], ['Apply', 'Rebuild it any time with new subjects and a new brief.']]));
    pane.replaceChildren(...recipes.map((rc) => h('div', { class: 'panel tight', style: 'margin-bottom:8px' },
      h('div', { class: 'row', style: 'justify-content:space-between' }, h('b', {}, rc.name), h('span', { class: 'muted', style: 'font-size:12px' }, ago(rc.created_at))),
      h('div', { class: 'muted', style: 'font-size:12px' }, `${rc.data.segments.length} shots · ${rc.data.total_s}s${rc.data.bpm ? ` · ${rc.data.bpm} BPM` : ''}${rc.data.cuts_on_beat ? ` · cuts on beat ${rc.data.cuts_on_beat}` : ''} · ${rc.data.edit_rhythm?.pacing ?? ''}`),
      h('div', { class: 'row', style: 'margin:6px 0;gap:4px;flex-wrap:nowrap;overflow:hidden' }, rc.data.segments.map((s) => h('div', { style: `flex:${s.duration_s};min-width:0` }, thumbFor(s.keyframe_asset_id)))),
      h('div', { class: 'row' },
        h('button', { class: 'primary', onclick: guard(async () => {
          const r = await POST(`/api/projects/${p.id}/recipes/${rc.id}/apply`, { brief: brief.value, ref_handles: [...chosen] });
          toast(`${r.shots.length} shots planned from "${rc.name}"${chosen.size ? ` with ${[...chosen].join(', ')}` : ''}`, 'ok');
          go('scenes', { sceneId: r.scene_id });
        }) }, 'Apply with current brief & references'),
        h('button', { class: 'danger', onclick: guard(async () => { if (!confirm(`Delete recipe "${rc.name}"? Shots already made from it stay.`)) return; await DEL(`/api/presets/${rc.id}`); render(); }) }, 'Delete')))));
  }
  function conformRow(sc) {
    const outBox = h('div');
    return h('div', { style: 'margin-top:8px;border-top:1px solid var(--line);padding-top:8px' },
      h('div', { class: 'row', style: 'justify-content:space-between' }, h('span', { class: 'muted', style: 'font-size:12px' }, 'Cut the selected takes to the reference shot lengths, over the reference soundtrack.'),
        h('button', { class: 'primary', onclick: guard(async () => {
          outBox.replaceChildren(h('p', { class: 'muted' }, 'Conforming…'));
          const r = await POST(`/api/scenes/${sc.id}/conform`);
          outBox.replaceChildren(wipeCompare(`/api/assets/${sc.settings.transform.source_asset_id}/file`, `/api/assets/${r.asset.id}/file`, ['Reference', 'Conform']),
            h('table', { style: 'margin-top:6px;font-size:12px' }, r.report.map((x) => h('tr', {}, h('td', {}, x.shot), h('td', {}, `${x.segment_s}s`), h('td', { class: x.status.startsWith('black') ? 'warnc' : 'muted' }, x.status)))),
            h('div', { class: 'row', style: 'margin-top:6px' }, h('a', { class: 'badge', href: `/api/assets/${r.asset.id}/file?download=1` }, 'Download conform'), h('span', { class: 'muted', style: 'font-size:12px' }, `${r.total_s}s · ${r.width}×${r.height} · ${r.fps} fps${r.soundtrack ? ' · reference soundtrack' : ''}`)));
        }) }, 'Conform to reference')), outBox);
  }

  drawModes(); drawSource(); drawExtras(); drawPane();
  main.replaceChildren(h('h1', {}, cfg.title), h('p', { class: 'sub' }, cfg.sub),
    h('div', { class: 'split-r' },
      h('div', { class: 'panel' }, h('h3', { style: 'margin-top:0' }, 'Mode'), modeHost, h('h3', {}, 'Source'), srcHost, extras, planBtn),
      h('div', { class: 'panel' }, tabs, pane)));
}

// Reference rhythm strip: shot segments, beat ticks and cut markers on one timeline (own SVG).
function rhythmStrip(an) {
  const dur = an.source.duration_s || 1, W = 1000, H = 54;
  const x = (t) => ((t / dur) * W).toFixed(1);
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('preserveAspectRatio', 'none');
  svg.style.cssText = 'width:100%;height:54px;margin-top:10px;background:#0f1115;border-radius:6px';
  const add = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); svg.append(e); return e; };
  an.segments.forEach((s, i) => add('rect', { x: x(s.start_s), y: 6, width: Math.max(1, x(s.end_s) - x(s.start_s)), height: 26, fill: i % 2 ? '#232833' : '#1b1f27' }));
  for (const b of an.soundtrack?.beats ?? []) add('line', { x1: x(b), x2: x(b), y1: 36, y2: 50, stroke: '#6b7385', 'stroke-width': 2 });
  for (const c of an.cut_alignment?.cuts ?? []) add('line', { x1: x(c.cut_s), x2: x(c.cut_s), y1: 2, y2: 52, stroke: c.on_beat ? '#4fbf86' : '#e8b65a', 'stroke-width': 4 });
  if (!an.cut_alignment) for (const s of an.segments.slice(1)) add('line', { x1: x(s.start_s), x2: x(s.start_s), y1: 2, y2: 52, stroke: '#e8b65a', 'stroke-width': 4 });
  return h('div', {}, svg, h('div', { class: 'muted', style: 'font-size:11px;margin-top:2px' }, 'Segments = reference shots · grey ticks = beats · green cut = on the beat, amber = off the beat'));
}

// Before/after split-wipe: drag the slider to reveal B over A; both play in sync.
function wipeCompare(aUrl, bUrl, [la, lb] = ['A', 'B']) {
  const va = h('video', { src: aUrl, muted: true, loop: true, preload: 'metadata', playsInline: true });
  const vb = h('video', { src: bUrl, muted: true, loop: true, preload: 'metadata', playsInline: true, class: 'b' });
  const box = h('div', { class: 'wipe' }, va, vb, h('div', { class: 'bar' }), h('span', { class: 'lbl', style: 'left:8px' }, la), h('span', { class: 'lbl', style: 'right:8px' }, lb));
  const slider = h('input', { type: 'range', min: 0, max: 100, value: 50, oninput: (e) => box.style.setProperty('--cut', `${e.target.value}%`) });
  const play = h('button', { onclick: () => { if (va.paused) { vb.currentTime = va.currentTime; va.play(); vb.play(); play.textContent = 'Pause'; } else { va.pause(); vb.pause(); play.textContent = 'Play'; } } }, 'Play');
  va.addEventListener('timeupdate', () => { if (Math.abs(vb.currentTime - va.currentTime) > 0.08) vb.currentTime = va.currentTime; });
  return h('div', {}, box, h('div', { class: 'row', style: 'margin-top:4px;flex-wrap:nowrap' }, play, slider));
}

// --- Edit Studio -------------------------------------------------------------------
VIEWS.edit = async () => {
  if (needProject()) return;
  await reloadProject();
  const p = state.project;
  const jobs = (await GET(`/api/projects/${p.id}/jobs`)).filter((j) => j.output_asset_id);
  const opt = (sel) => jobs.map((j) => h('option', { value: j.output_asset_id, selected: j.output_asset_id === sel }, `${j.label || 'untitled'} · ${j.provider} · ${ago(j.created_at)}`));
  const a = h('select', {}, opt(jobs[0]?.output_asset_id)), b = h('select', {}, opt(jobs[1]?.output_asset_id));
  const va = h('video', { controls: true, muted: true }), vb = h('video', { controls: true, muted: true });
  const res = h('div');
  const wipeHost = h('div');
  const load = () => { va.src = `/api/assets/${a.value}/file`; vb.src = `/api/assets/${b.value}/file`; wipeHost.replaceChildren(wipeCompare(`/api/assets/${a.value}/file`, `/api/assets/${b.value}/file`, ['A', 'B'])); };
  a.onchange = load; b.onchange = load;
  const allShots = p.scenes.flatMap((sc) => sc.shots);
  const revShot = h('select', {}, allShots.map((s) => h('option', { value: s.id }, s.title)));
  const revNote = h('textarea', { placeholder: 'What to change, in plain words (kept in the version history). Edit the controls in OG Cinema Studio for precise changes.' });
  main.replaceChildren(h('h1', {}, 'Edit Studio'), h('p', { class: 'sub' }, 'Compare takes side by side or with a split wipe, measure how different they are, and create revisions without losing earlier versions.'),
    jobs.length < 1 ? emptySteps([['Generate takes', 'Make at least one take in OG Cinema Studio or OG Genjutsu.'], ['Compare', 'Put two takes side by side or under a split wipe and measure the difference.'], ['Refine', 'Revise, extend, restyle or swap — every earlier take is kept.']]) : h('div', {},
      h('div', { class: 'row', style: 'margin-bottom:8px' }, h('span', { class: 'seg' }, h('button', { class: state.editMode !== 'wipe' ? 'on' : '', onclick: () => { state.editMode = 'side'; render(); } }, 'Side by side'), h('button', { class: state.editMode === 'wipe' ? 'on' : '', onclick: () => { state.editMode = 'wipe'; render(); } }, 'Split wipe'))),
      state.editMode === 'wipe' ? h('div', { class: 'panel tight' }, h('div', { class: 'grid g2', style: 'margin-bottom:8px' }, a, b), wipeHost) : h('div', { class: 'grid g2' }, h('div', { class: 'panel tight' }, a, va), h('div', { class: 'panel tight' }, b, vb)),
      state.editMode !== 'wipe' ? h('div', { class: 'row', style: 'margin:10px 0' }, h('button', { onclick: () => { va.currentTime = 0; vb.currentTime = 0; va.play(); vb.play(); } }, 'Play both in sync')) : null,
      res,
      h('h2', {}, 'Toolbox'), h('p', { class: 'muted', style: 'margin-top:-4px' }, 'Tools act on take A. Results are new takes or new files — nothing is overwritten.'),
      h('div', { class: 'panel', style: 'padding:0' }, toolRows([
        ['Measure difference', 'Structural similarity (SSIM) between A and B — how much really changed.', h('button', { onclick: guard(async () => { const r = await POST('/api/compare', { a: a.value, b: b.value }); res.replaceChildren(h('div', { class: 'panel', style: 'margin-bottom:10px' }, h('b', {}, `SSIM ${r.ssim?.toFixed(3) ?? 'n/a'}`), ` — ${r.ssim_note}`, h('div', { class: 'muted' }, `A ${r.a.size} ${r.a.duration_s?.toFixed(2)}s · B ${r.b.size} ${r.b.duration_s?.toFixed(2)}s`))); }) }, 'Measure')],
        ['Extract a frame', 'Save a still from A — e.g. the last frame to start the next shot.', h('span', { class: 'row' },
          h('button', { onclick: guard(async () => { const f = await POST(`/api/assets/${a.value}/extract-frame`, { at: 0 }); toast(`Saved ${f.filename}`, 'ok'); }) }, 'First'),
          h('button', { onclick: guard(async () => { const f = await POST(`/api/assets/${a.value}/extract-frame`, { at: 'last' }); toast(`Saved ${f.filename}`, 'ok'); }) }, 'Last'))],
        ['Revise a shot', 'Describe a change in plain words; a new version is generated, the old take is kept.', h('button', { onclick: () => reviseDialog(revShot, revNote) }, 'Revise…')],
        ['Extend', 'Continue the clip forward or backward (OG Katana).', h('button', { onclick: () => go('katana', { katanaMode: 'extend', motionSrc: a.value }) }, 'Open')],
        ['Restyle', 'Re-render the whole clip in another look (OG Katana).', h('button', { onclick: () => go('katana', { katanaMode: 'style_transfer', motionSrc: a.value }) }, 'Open')],
        ['Swap a character', 'Replace one person, keeping performance and timing (OG Genjutsu).', h('button', { onclick: () => go('genjutsu', { genjutsuMode: 'character_swap', motionSrc: a.value }) }, 'Open')],
        ['Reframe', 'New aspect (9:16, 1:1, 4:5, 21:9…) by crop, black bars or blurred fill — local, free. Generative outpaint is not available with the current models.', h('button', { onclick: () => reframeDialog(a.value) }, 'Reframe…')],
        ['Upscale (resample)', 'Lanczos resample to 1080p / 1440p / 4K with light sharpening — local, free; not AI super-resolution.', h('button', { onclick: () => upscaleDialog(a.value) }, 'Upscale…')],
        ['Quality check', 'Measured checks (length, flicker, cuts, colour) plus what needs your eyes.', h('button', { onclick: () => go('qc', { qcAsset: a.value }) }, 'Run QC')],
        ['Export to Resolve', 'Selected takes as a timeline — File › Import › Timeline in DaVinci Resolve.', h('span', { class: 'row' }, ['edl', 'fcpxml', 'otio'].map((f) => h('a', { class: 'badge', href: `/api/projects/${p.id}/export/${f}` }, f.toUpperCase())))],
      ]))));
  if (jobs.length) load();
};
function toolRows(rows) {
  return h('table', {}, rows.map(([name, purpose, action]) => h('tr', {}, h('td', { style: 'width:180px;padding:12px 14px' }, h('b', {}, name)), h('td', { class: 'muted', style: 'padding:12px 8px' }, purpose), h('td', { style: 'padding:12px 14px;white-space:nowrap' }, h('div', { class: 'row', style: 'justify-content:flex-end;flex-wrap:nowrap' }, action)))));
}
function reframeDialog(assetId) {
  const aspect = h('select', {}, ['9:16', '4:5', '1:1', '4:3', '16:9', '1.85:1', '21:9', '2.39:1'].map((x) => h('option', {}, x)));
  const mode = h('select', {}, [['crop', 'Crop (lose edges)'], ['blur', 'Blurred fill (keep whole picture)'], ['pad', 'Black bars (keep whole picture)']].map(([v, l]) => h('option', { value: v }, l)));
  const pos = h('input', { type: 'range', min: 0, max: 100, value: 50 });
  const out = h('div');
  modal(h('div', {}, h('h1', {}, 'Reframe'), h('p', { class: 'sub' }, 'Makes a new file; the take is not changed.'),
    h('div', { class: 'grid g2' }, h('label', {}, 'Aspect', aspect), h('label', {}, 'Method', mode)),
    h('label', { style: 'margin-top:8px' }, 'Crop position (left/top ← → right/bottom)', pos), out,
    h('div', { class: 'row', style: 'justify-content:flex-end;margin-top:12px' }, h('button', { onclick: closeModal }, 'Close'),
      h('button', { class: 'primary', onclick: guard(async () => {
        out.replaceChildren(h('p', { class: 'muted' }, 'Rendering…'));
        const r = await POST(`/api/assets/${assetId}/reframe`, { aspect: aspect.value, mode: mode.value, position: Number(pos.value) / 100 });
        out.replaceChildren(h('video', { src: `/api/assets/${r.asset.id}/file`, controls: true, style: 'max-height:50vh;width:auto;margin:10px auto' }),
          h('div', { class: 'row' }, h('span', { class: 'muted' }, `${r.source} → ${r.width}×${r.height} (${r.aspect}, ${r.mode})`), h('a', { class: 'badge', href: `/api/assets/${r.asset.id}/file?download=1` }, 'Download')));
      }) }, 'Make reframe'))), { wide: true });
}
function upscaleDialog(assetId) {
  const target = h('select', {}, [['1080p', '1080p'], ['1440p', '1440p'], ['2160p', '4K (2160p)'], ['x2', '×2']].map(([v, l]) => h('option', { value: v }, l)));
  const sharpen = h('input', { type: 'checkbox', checked: true });
  const out = h('div');
  modal(h('div', {}, h('h1', {}, 'Upscale (resample)'), h('p', { class: 'sub' }, 'High-quality resampling for delivery sizes. It does not add real detail — AI super-resolution would need a separate model download (ask first).'),
    h('div', { class: 'row' }, h('label', {}, 'Target', target), h('label', { class: 'inline' }, sharpen, 'Light sharpening')), out,
    h('div', { class: 'row', style: 'justify-content:flex-end;margin-top:12px' }, h('button', { onclick: closeModal }, 'Close'),
      h('button', { class: 'primary', onclick: guard(async () => {
        out.replaceChildren(h('p', { class: 'muted' }, 'Rendering…'));
        const r = await POST(`/api/assets/${assetId}/upscale`, { target: target.value, sharpen: sharpen.checked });
        out.replaceChildren(h('div', { class: 'row', style: 'margin-top:10px' }, h('span', {}, `${r.source} → ${r.width}×${r.height} (×${r.factor}) · ${r.method}`), h('a', { class: 'badge', href: `/api/assets/${r.asset.id}/file?download=1` }, 'Download')));
      }) }, 'Upscale'))));
}
function reviseDialog(revShot, revNote) {
  modal(h('div', {}, h('h1', {}, 'Revise a shot'), h('p', { class: 'sub' }, 'A new version is generated from the shot with your change; earlier takes stay available (Regenerations).'),
    h('label', {}, 'Shot', revShot), h('label', { style: 'margin-top:8px' }, 'What to change', revNote),
    h('div', { class: 'row', style: 'justify-content:flex-end;margin-top:12px' }, h('button', { onclick: closeModal }, 'Cancel'),
      h('button', { class: 'primary', onclick: guard(async () => {
        const r = await POST(`/api/shots/${revShot.value}/revise`, { note: revNote.value, changes: revNote.value ? { intent: { action: revNote.value } } : {} });
        closeModal();
        if (r.job.status === 'awaiting_approval') approvalDialog(r.job); else toast('Revision queued; the previous take is kept.', 'ok');
      }) }, 'Generate revision'))));
}

// --- Asset Library ---------------------------------------------------------------------
VIEWS.assets = async () => {
  if (needProject()) return;
  const p = state.project;
  const assets = await GET(`/api/projects/${p.id}/assets`);
  const rights = h('input', { type: 'checkbox' }), person = h('input', { type: 'checkbox' }), consent = h('input', { type: 'checkbox' });
  const tags = h('input', { placeholder: 'tags, comma separated' });
  const fileIn = h('input', { type: 'file', multiple: true, accept: 'video/*,image/*,audio/*' });
  const drop = h('div', { class: 'drop' }, 'Drop media here or ', fileIn);
  const doUpload = guard(async (files) => {
    if (!rights.checked) throw new Error('Confirm you have the rights to use this media first.');
    for (const f of files) {
      toast(`Uploading ${f.name}…`);
      const q = new URLSearchParams({ filename: f.name, rights_confirmed: '1', depicts_real_person: person.checked ? '1' : '0', likeness_consent: consent.checked ? '1' : '0', tags: tags.value });
      const r = await api('PUT', `/api/projects/${p.id}/assets?${q}`, f, true);
      toast(r.duplicate ? `${f.name}: already in library` : `${f.name} uploaded`, 'ok');
    }
    render();
  });
  fileIn.onchange = () => doUpload([...fileIn.files]);
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); doUpload([...e.dataTransfer.files]); };
  const filter = state.assetFilter ?? 'all';
  const layout = state.assetLayout ?? 'grid';
  const sort = state.assetSort ?? 'new';
  const size = Number(localStorage.getItem('assetTile') ?? 220);
  const q = (state.assetQuery ?? '').toLowerCase();
  const SORTS = { new: ['Newest', (a, b) => b.created_at.localeCompare(a.created_at)], old: ['Oldest', (a, b) => a.created_at.localeCompare(b.created_at)],
    name: ['Name', (a, b) => a.filename.localeCompare(b.filename)], size: ['Largest', (a, b) => b.bytes - a.bytes], dur: ['Longest', (a, b) => (b.meta?.duration_s ?? 0) - (a.meta?.duration_s ?? 0)] };
  const shown = assets.filter((a) => (filter === 'all' || a.kind === filter || a.origin === filter) && (!q || a.filename.toLowerCase().includes(q) || (a.tags ?? []).some((t) => t.toLowerCase().includes(q))))
    .sort(SORTS[sort]?.[1] ?? SORTS.new[1]);
  const search = h('input', { type: 'search', placeholder: 'Search name or tag', value: state.assetQuery ?? '', style: 'width:200px' });
  search.addEventListener('change', () => { state.assetQuery = search.value; render(); });
  const listHost = h('div');
  const badges = (a) => [h('span', { class: 'badge' }, a.kind), ' ', h('span', { class: `badge ${a.origin === 'generated' ? 'info' : ''}` }, a.origin), a.meta?.mock ? h('span', { class: 'badge warn' }, 'mock') : null];
  listHost.append(!shown.length ? (assets.length ? h('div', { class: 'empty' }, 'Nothing matches this filter.') : emptySteps([['Confirm rights', 'Tick that you have the rights; mark real people and recorded consent.'], ['Drop media', 'Video, stills and audio — originals are never modified.'], ['Use it', 'Turn stills into characters in Reference Studio; send clips to OG Katana / OG Genjutsu.']]))
    : layout === 'list' ? h('table', {}, h('tr', {}, ['', 'Name', 'Type', 'Length', 'Size', 'Added'].map((t) => h('th', {}, t))),
      shown.map((a) => h('tr', { style: 'cursor:pointer', onclick: () => assetDialog(a) },
        h('td', { style: 'width:72px' }, a.kind === 'audio' ? '♪' : h('img', { src: `/api/assets/${a.id}/thumb`, style: 'width:64px;border-radius:4px', onerror: (e) => e.target.remove() })),
        h('td', { style: 'word-break:break-all' }, a.filename), h('td', {}, ...badges(a)), h('td', {}, a.meta?.duration_s ? `${a.meta.duration_s.toFixed(1)} s` : '—'),
        h('td', {}, `${(a.bytes / 1048576).toFixed(1)} MB`), h('td', { class: 'muted' }, ago(a.created_at)))))
    : h('div', { class: 'takes gridview', style: `--tile:${size}px` }, shown.map((a) => h('div', { class: 'panel tight shot-card', onclick: () => assetDialog(a) },
      a.kind === 'audio' ? h('div', { class: 'thumb', style: 'display:flex;align-items:center;justify-content:center' }, '♪')
        : a.kind === 'video' ? h('video', { src: `/api/assets/${a.id}/file`, poster: `/api/assets/${a.id}/thumb`, muted: true, loop: true, preload: 'none', class: 'thumb', onmouseenter: (e) => e.target.play().catch(() => {}), onmouseleave: (e) => e.target.pause() }) : thumbFor(a.id),
      h('b', { style: 'font-size:12.5px;word-break:break-all' }, a.filename),
      h('div', { class: 'meta' }, ...badges(a), ' ', a.meta?.duration_s ? `${a.meta.duration_s.toFixed(1)}s` : '')))));
  main.replaceChildren(h('h1', {}, 'Asset Library'), h('p', { class: 'sub' }, 'Uploads, generated takes and derived frames. Files stay local; nothing is published.'),
    h('div', { class: 'panel', style: 'margin-bottom:14px' }, drop, h('div', { class: 'row', style: 'margin-top:10px' },
      h('label', { class: 'inline' }, rights, 'I have the rights to use this media'), h('label', { class: 'inline' }, person, 'Shows a real person'), h('label', { class: 'inline' }, consent, 'Likeness consent on file'), tags)),
    previzPanel(p),
    h('div', { class: 'tabs' }, ['all', 'video', 'image', 'audio', 'upload', 'generated', 'derived'].map((f) => h('button', { class: f === filter ? 'on' : '', onclick: () => { state.assetFilter = f; render(); } }, f))),
    h('div', { class: 'row', style: 'margin-bottom:10px' }, search,
      h('select', { style: 'width:auto', onchange: (e) => { state.assetSort = e.target.value; render(); } }, Object.entries(SORTS).map(([k, [l]]) => h('option', { value: k, selected: k === sort }, `Sort: ${l}`))),
      h('span', { class: 'seg' }, ...['grid', 'list'].map((l) => h('button', { class: layout === l ? 'on' : '', onclick: () => { state.assetLayout = l; render(); } }, l === 'grid' ? 'Grid' : 'List'))),
      layout === 'grid' ? h('input', { type: 'range', min: 140, max: 360, value: size, style: 'width:130px', title: 'thumbnail size', oninput: (e) => { localStorage.setItem('assetTile', e.target.value); listHost.firstChild?.style?.setProperty('--tile', `${e.target.value}px`); } }) : null,
      h('span', { class: 'muted' }, `${shown.length} of ${assets.length}`)),
    listHost);
}

// Blender previz import (render folder or video on this PC; a camera.json beside it adds the moves).
function previzPanel(p) {
  const pathIn = h('input', { placeholder: 'Blender render folder or previz video, e.g. C:\\Renders\\sc12_previz', style: 'flex:1' });
  const fps = h('input', { type: 'number', value: 24, style: 'width:80px' });
  const out = h('span', { class: 'muted', style: 'font-size:12px' });
  return h('details', { class: 'panel', style: 'margin-bottom:14px' }, h('summary', { style: 'cursor:pointer' }, h('b', {}, 'Import Blender previz'), h('span', { class: 'muted' }, ' — greybox render as a motion reference')),
    h('p', { class: 'muted', style: 'font-size:12.5px' }, 'Point at the render folder (image sequence) or a previz video. If camera.json from docs/blender/export_camera_json.py sits beside it, the camera moves and lens are filled in for you. The render itself is never modified.'),
    h('div', { class: 'row' }, pathIn, h('label', {}, 'fps', fps),
      h('button', { class: 'primary', onclick: guard(async () => {
        out.textContent = 'Importing…';
        const r = await POST(`/api/projects/${p.id}/previz/import`, { path: pathIn.value, fps: Number(fps.value) });
        out.textContent = r.camera?.moves ? `Imported — camera: ${r.camera.moves.join(' → ')}${r.camera.focal_mm ? ` · ${r.camera.focal_mm} mm` : ''}` : 'Imported (no camera.json found)';
        toast('Previz imported', 'ok'); setTimeout(() => assetDialog(r.asset), 300);
      }) }, 'Import')), out);
}
function previzInfo(a) {
  const c = a.meta.previz.camera;
  const brief = h('input', { placeholder: 'What the finished shot should show (optional)' });
  const make = (mode) => guard(async () => { const r = await POST(`/api/assets/${a.id}/previz-shot`, { mode, brief: brief.value }); closeModal(); toast('Shot created from previz', 'ok'); go('cinema', { shotId: r.shot.id }); });
  return h('div', { class: 'panel', style: 'margin-top:10px' }, h('h3', { style: 'margin-top:0' }, 'Blender previz'),
    h('div', { class: 'kv' }, h('div', {}, 'Camera'), h('div', {}, c?.moves ? `${c.moves.join(' → ')}${c.speed ? ` (${c.speed})` : ''}` : c?.error ?? 'no camera.json — moves not derived'),
      c?.focal_mm ? [h('div', {}, 'Lens'), h('div', {}, `${c.focal_mm} mm`)] : null,
      c?.details ? [h('div', {}, 'Path'), h('div', { class: 'mono', style: 'font-size:11.5px' }, `dolly ${c.details.dolly} · truck ${c.details.truck} · pedestal ${c.details.pedestal} · pan ${c.details.pan_deg}° · tilt ${c.details.tilt_deg}°`)] : null),
    h('label', { style: 'margin-top:8px' }, 'Brief', brief),
    h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'primary', onclick: make('motion') }, 'Previz → shot (motion reference)'), h('button', { onclick: make('first_frame') }, 'Previz → shot (first frame)')),
    h('p', { class: 'muted', style: 'font-size:12px' }, 'Motion reference needs a model that takes reference video (Seedance: hosted URL). First frame works with any image-to-video model.'));
}
function assetDialog(a) {
  const remote = h('input', { value: a.meta?.remote_url ?? '', placeholder: 'https://… or asset://… (needed for Seedance video references)' });
  const media = a.kind === 'video' ? h('video', { src: `/api/assets/${a.id}/file`, controls: true }) : a.kind === 'image' ? h('img', { src: `/api/assets/${a.id}/file`, style: 'max-width:100%;border-radius:6px' }) : a.kind === 'audio' ? h('audio', { src: `/api/assets/${a.id}/file`, controls: true }) : null;
  const m = a.meta ?? {};
  modal(h('div', {}, h('h1', {}, a.filename), media,
    h('div', { class: 'kv', style: 'margin-top:10px' },
      h('div', {}, 'Kind / origin'), h('div', {}, `${a.kind} · ${a.origin}${m.mock ? ' · MOCK OUTPUT' : ''}`),
      h('div', {}, 'Size'), h('div', {}, `${(a.bytes / 1048576).toFixed(2)} MB`),
      m.video ? [h('div', {}, 'Video'), h('div', {}, `${m.video.width}×${m.video.height} · ${m.video.fps} fps · ${m.video.codec}`)] : null,
      m.image ? [h('div', {}, 'Image'), h('div', {}, `${m.image.width}×${m.image.height}`)] : null,
      m.duration_s ? [h('div', {}, 'Duration'), h('div', {}, `${m.duration_s.toFixed(2)} s`)] : null,
      h('div', {}, 'Rights'), h('div', {}, a.rights?.rights_confirmed ? 'confirmed' : 'not confirmed', a.rights?.depicts_real_person ? ' · real person' : '', a.rights?.likeness_consent ? ' · consent on file' : ''),
      m.prompt ? [h('div', {}, 'Prompt'), h('div', { class: 'mono', style: 'font-size:11.5px' }, m.prompt)] : null,
      h('div', {}, 'SHA-256'), h('div', { class: 'mono', style: 'font-size:11px;word-break:break-all' }, a.sha256)),
    m.previz ? previzInfo(a) : null,
    h('label', { style: 'margin-top:10px' }, 'Remote URL', remote),
    h('div', { class: 'row', style: 'margin-top:12px;justify-content:space-between' },
      h('button', { class: 'danger', onclick: guard(async () => { if (!confirm(`Permanently delete ${a.filename} from disk?`)) return; await DEL(`/api/assets/${a.id}`); closeModal(); toast('Deleted', 'ok'); render(); }) }, 'Delete file'),
      h('div', { class: 'row' }, h('a', { class: 'badge', href: `/api/assets/${a.id}/file?download=1` }, 'Download'),
        a.kind === 'video' ? h('button', { onclick: () => { closeModal(); go('genjutsu', { motionSrc: a.id }); } }, 'Use in OG Genjutsu') : null,
        a.kind === 'video' ? h('button', { onclick: () => { closeModal(); go('katana', { motionSrc: a.id }); } }, 'Use in OG Katana') : null,
        h('button', { class: 'primary', onclick: guard(async () => { await PATCH(`/api/assets/${a.id}`, { remote_url: remote.value }); closeModal(); toast('Saved', 'ok'); render(); }) }, 'Save')))), { wide: true });
}

// --- Quality Review ------------------------------------------------------------------------
VIEWS.qc = async () => {
  if (needProject()) return;
  const p = state.project;
  const [assets, history] = await Promise.all([GET(`/api/projects/${p.id}/assets?kind=video`), GET(`/api/projects/${p.id}/qc`)]);
  const sel = h('select', {}, assets.map((a) => h('option', { value: a.id, selected: a.id === state.qcAsset }, `${a.origin} · ${a.filename}`)));
  const out = h('div');
  const show = (r) => out.replaceChildren(h('div', { class: 'panel' },
    h('div', { class: 'row', style: 'justify-content:space-between' }, h('h2', { style: 'margin:0' }, `Verdict: ${r.summary.verdict}`), h('span', {}, h('span', { class: 'badge bad' }, `${r.summary.fails} fail`), ' ', h('span', { class: 'badge warn' }, `${r.summary.warns} warn`), ' ', h('span', { class: 'badge good' }, `${r.summary.passes} pass`))),
    r.mock_output ? h('p', { class: 'warnc' }, 'This is mock-provider output: measurements exercise the pipeline but say nothing about real model quality.') : null,
    h('h3', {}, 'Measured (computer-verified)'), h('table', {}, h('tr', {}, h('th', {}, 'Check'), h('th', {}, 'Result'), h('th', {}, 'Value'), h('th', {}, 'Detail')),
      r.measured.map((m) => h('tr', {}, h('td', {}, m.check), h('td', {}, h('span', { class: `badge ${m.result === 'PASS' ? 'good' : m.result === 'WARN' ? 'warn' : 'bad'}` }, m.result)), h('td', { class: 'mono' }, String(m.value ?? '')), h('td', { class: 'muted' }, m.detail)))),
    r.recommendations.length ? [h('h3', {}, 'Targeted fixes'), h('ul', { class: 'clean' }, r.recommendations.map((x) => h('li', {}, h('b', {}, x.check), ': ', x.fix)))] : null,
    h('h3', {}, 'Needs your eyes and ears'), h('ul', { class: 'clean' }, r.manual.map((m) => h('li', {}, h('label', { class: 'inline' }, h('input', { type: 'checkbox' }), m))))));
  main.replaceChildren(h('h1', {}, 'Quality Review'), h('p', { class: 'sub' }, 'Measured technical checks are separated from creative judgement. Fixes are targeted — regenerate only what the numbers or your review say is wrong.'),
    assets.length ? h('div', {}, h('div', { class: 'row' }, sel, h('button', { class: 'primary', onclick: guard(async () => { out.replaceChildren(h('p', { class: 'muted' }, 'Measuring…')); show(await POST(`/api/assets/${sel.value}/qc`)); }) }, 'Run QC')), out,
      h('h2', {}, 'History'), h('table', {}, history.slice(0, 30).map((q) => h('tr', { style: 'cursor:pointer', onclick: () => show(q.report) }, h('td', {}, ago(q.created_at)), h('td', {}, assets.find((a) => a.id === q.asset_id)?.filename ?? q.asset_id), h('td', {}, q.report.summary.verdict)))))
      : emptySteps([['Generate', 'Make takes in OG Cinema Studio or OG Genjutsu (or upload a clip).'], ['Run QC', 'Measured checks: length, frame rate, flicker, black frames, unwanted cuts, colour drift.'], ['Your eyes', 'Tick the manual checklist: identity, performance, artefacts, lip-sync.']]));
};

// --- Jobs ------------------------------------------------------------------------------------
VIEWS.jobs = async () => {
  if (needProject()) return;
  const jobs = await GET(`/api/projects/${state.project.id}/jobs`);
  const GROUPS = { all: ['All', () => true], attention: ['Needs you', (j) => ['awaiting_approval', 'needs_review'].includes(j.status)],
    active: ['Active', (j) => ['queued', 'submitting', 'running'].includes(j.status)], done: ['Done', (j) => j.status === 'succeeded'],
    failed: ['Failed', (j) => ['failed', 'rejected', 'cancelled'].includes(j.status)] };
  const filter = GROUPS[state.jobFilter] ? state.jobFilter : 'all';
  const layout = state.jobLayout ?? 'list';
  const size = Number(localStorage.getItem('jobTile') ?? 220);
  const q = (state.jobQuery ?? '').toLowerCase();
  const shown = jobs.filter((j) => GROUPS[filter][1](j) && (!q || `${j.label} ${j.provider} ${j.model} ${j.workflow}`.toLowerCase().includes(q)));
  const actions = (j) => [j.status === 'awaiting_approval' ? h('button', { class: 'primary', onclick: () => approvalDialog(j) }, 'Review') : null,
    ['queued', 'running', 'awaiting_approval'].includes(j.status) ? h('button', { class: 'danger', onclick: guard(async () => { await POST(`/api/jobs/${j.id}/cancel`); render(); }) }, 'Cancel') : null,
    j.status === 'needs_review' ? reconcileButton(j) : null,
    j.output_asset_id ? h('a', { class: 'badge', href: `/api/assets/${j.output_asset_id}/file?download=1` }, 'Download') : null];
  const search = h('input', { type: 'search', placeholder: 'Search shot, model, workflow', value: state.jobQuery ?? '', style: 'width:220px' });
  search.addEventListener('change', () => { state.jobQuery = search.value; render(); });
  const body = !jobs.length ? emptySteps([['Compose', 'Set up a shot in OG Cinema Studio or a swap in OG Genjutsu.'], ['Generate', 'Free/local jobs start at once; paid ones wait here for your approval.'], ['Track', 'Status, exact prompt, provider task id and cost for every request.']])
    : !shown.length ? h('div', { class: 'empty' }, 'Nothing in this group.')
    : layout === 'grid' ? h('div', { class: 'takes gridview', style: `--tile:${size}px` }, shown.map((j) => h('div', { class: 'panel tight', style: 'padding:6px' },
      j.output_asset_id ? h('video', { src: `/api/assets/${j.output_asset_id}/file`, poster: `/api/assets/${j.output_asset_id}/thumb`, muted: true, loop: true, preload: 'none', class: 'thumb', onmouseenter: (e) => e.target.play().catch(() => {}), onmouseleave: (e) => e.target.pause() })
        : h('div', { class: 'thumb', style: 'display:flex;align-items:center;justify-content:center' }, statusBadge(j.status)),
      h('div', { class: 'row', style: 'justify-content:space-between;margin-top:4px' }, h('b', { style: 'font-size:12.5px' }, j.label || 'untitled'), statusBadge(j.status)),
      h('div', { class: 'muted', style: 'font-size:11.5px' }, `${j.provider} · ${usd(j.estimate?.usd)} · ${ago(j.created_at)}`),
      j.error ? h('div', { class: 'err', style: 'font-size:11.5px' }, j.error.message) : null,
      h('div', { class: 'row', style: 'margin-top:4px' }, ...actions(j)))))
    : h('table', {}, h('tr', {}, ['Status', 'Shot', 'Provider / model', 'Workflow', 'Estimate', 'Task id', 'Created', ''].map((t) => h('th', {}, t))),
      shown.map((j) => h('tr', {}, h('td', {}, statusBadge(j.status), j.error ? h('div', { class: 'err', style: 'font-size:11.5px' }, j.error.message) : null), h('td', {}, j.label), h('td', { class: 'mono' }, `${j.provider} / ${j.model}`), h('td', {}, j.workflow), h('td', {}, usd(j.estimate?.usd)), h('td', { class: 'mono' }, j.provider_task_id ?? '—'), h('td', {}, ago(j.created_at)),
        h('td', {}, ...actions(j)))));
  main.replaceChildren(h('h1', {}, 'Jobs'), h('p', { class: 'sub' }, 'Every generation request with its exact prompt, settings, provider task id and cost.'),
    h('div', { class: 'tabs' }, Object.entries(GROUPS).map(([k, [l, fn]]) => h('button', { class: k === filter ? 'on' : '', onclick: () => { state.jobFilter = k; render(); } }, `${l} (${jobs.filter(fn).length})`))),
    h('div', { class: 'row', style: 'margin-bottom:10px' }, search,
      h('span', { class: 'seg' }, ...['list', 'grid'].map((l) => h('button', { class: layout === l ? 'on' : '', onclick: () => { state.jobLayout = l; render(); } }, l === 'grid' ? 'Grid' : 'List'))),
      layout === 'grid' ? h('input', { type: 'range', min: 160, max: 380, value: size, style: 'width:130px', oninput: (e) => { localStorage.setItem('jobTile', e.target.value); body.style?.setProperty('--tile', `${e.target.value}px`); } }) : null),
    body);
};
function reconcileButton(j) {
  if (j.provider_task_id) return h('button', { onclick: guard(async () => { await POST(`/api/jobs/${j.id}/recheck`); render(); }) }, 'Recheck');
  return h('button', { onclick: guard(async () => {
    const since = Math.floor(Date.parse(j.submitted_at ?? j.created_at) / 1000) - 120;
    const recent = await GET(`/api/providers/${j.provider}/recent?since=${since}`);
    modal(h('div', {}, h('h1', {}, 'Reconcile uncertain submit'), h('p', { class: 'sub' }, 'The app could not confirm whether the provider received this job. Tasks created around that time:'),
      recent.length ? h('table', {}, recent.map((t) => h('tr', {}, h('td', { class: 'mono' }, t.id), h('td', {}, t.status), h('td', {}, new Date(t.created_at * 1000).toLocaleString()),
        h('td', {}, h('button', { onclick: guard(async () => { await POST(`/api/jobs/${j.id}/attach`, { task_id: t.id }); closeModal(); render(); }) }, 'This is it'))))) : h('p', {}, 'No tasks found — it was most likely not received. You can safely generate again.'),
      h('div', { class: 'row', style: 'justify-content:flex-end' }, h('button', { onclick: closeModal }, 'Close'))));
  }) }, 'Reconcile');
}

// --- Model Settings ------------------------------------------------------------------------------
VIEWS.settings = async () => {
  const [providers, budget, events] = await Promise.all([GET('/api/providers'), GET('/api/budget'), GET('/api/events?limit=60')]);
  state.providers = providers;
  const bj = h('input', { type: 'number', step: '0.5', value: budget.budget.per_job_usd }), bd = h('input', { type: 'number', step: '1', value: budget.budget.daily_usd }), bm = h('input', { type: 'number', step: '5', value: budget.budget.monthly_usd });
  main.replaceChildren(h('h1', {}, 'Model Settings'), h('p', { class: 'sub' }, 'Credentials are encrypted at rest on this machine and never sent to the browser. Paid generation always needs your explicit approval.'),
    ...providers.map((pr) => providerPanel(pr)),
    h('h2', {}, 'Budget limits'), h('div', { class: 'panel' }, h('div', { class: 'grid g4' }, h('label', {}, 'Per job (USD)', bj), h('label', {}, 'Per day (USD)', bd), h('label', {}, 'Per month (USD)', bm),
      h('div', { class: 'muted' }, `Spent today ${usd(budget.spent_today_usd)} · this month ${usd(budget.spent_month_usd)}`)),
      h('button', { style: 'margin-top:10px', onclick: guard(async () => { await PUT('/api/budget', { per_job_usd: bj.value, daily_usd: bd.value, monthly_usd: bm.value }); toast('Limits saved', 'ok'); refreshBadges(); }) }, 'Save limits')),
    h('h2', {}, 'Activity log'), h('div', { class: 'panel tight' }, h('table', {}, events.map((e) => h('tr', {}, h('td', { class: 'muted', style: 'white-space:nowrap' }, ago(e.ts)), h('td', {}, h('span', { class: `badge ${e.level === 'error' ? 'bad' : e.level === 'warn' ? 'warn' : ''}` }, e.kind)), h('td', {}, e.message))))));
};
function providerPanel(pr) {
  const m = pr.models[0];
  const caps = m?.caps ?? {};
  const body = h('div', { class: 'panel', style: 'margin-bottom:12px' },
    h('div', { class: 'row', style: 'justify-content:space-between' }, h('div', {}, h('b', {}, pr.label), ' ', pr.billable ? h('span', { class: 'badge warn' }, 'paid') : h('span', { class: 'badge good' }, 'free'), pr.attribution ? [' ', h('span', { class: 'badge accent' }, pr.attribution)] : null),
      h('span', { class: `badge ${pr.credentials.configured ? 'good' : ''}` }, pr.credentials.configured ? `configured ${pr.credentials.hint ?? ''}` : 'not configured')),
    h('p', { class: 'muted' }, pr.description),
    h('div', { class: 'kv' }, h('div', {}, 'Model'), h('div', { class: 'mono' }, m?.id), h('div', {}, 'Workflows'), h('div', {}, (caps.workflows ?? []).join(', ')),
      h('div', {}, 'Durations'), h('div', {}, caps.durations ? `${caps.durations.min}–${caps.durations.max}s` : '—'), h('div', {}, 'Resolutions'), h('div', {}, (caps.resolutions ?? []).join(', ')),
      h('div', {}, 'Max references'), h('div', {}, caps.max_refs ? `${caps.max_refs.image} images · ${caps.max_refs.video} videos · ${caps.max_refs.audio} audio` : '—'),
      h('div', {}, 'API-guaranteed controls'), h('div', {}, (caps.native_params ?? []).join(', ')),
      caps.notes ? [h('div', {}, 'Constraints'), h('div', {}, h('ul', { class: 'clean' }, caps.notes.map((n) => h('li', {}, n))))] : null,
      pr.pricing ? [h('div', {}, 'Pricing'), h('div', { class: 'mono' }, Object.entries(pr.pricing.per_million).map(([r, v]) => `${r}: $${v.no_video}/M tok ($${v.with_video} with video input)`).join(' · '), h('div', { class: 'muted' }, pr.pricing.source))] : null));
  if (pr.id === 'local-h3') {
    const st = h('span', { class: 'muted' }, 'checking engine…');
    const lora = h('select', {}, [['v1', 'Swap LoRA V1 (tested with this workflow)'], ['v1.5', 'Swap LoRA V1.5 (experimental here)']].map(([v, l]) => h('option', { value: v, selected: (pr.settings.lora ?? 'v1') === v }, l)));
    const keep = h('input', { type: 'checkbox', checked: pr.settings.keep_source_audio ?? true });
    const dirIn = h('input', { value: pr.settings.engine_dir ?? 'C:\\Users\\harry\\Downloads\\H3 Engine' });
    const refresh = async () => { const e = await GET('/api/engine'); st.textContent = e.running ? `running · ComfyUI ${e.comfyui} · ${e.gpu} · ${e.vram_free_gb}/${e.vram_gb} GB free` : e.installed ? 'installed, not running' : 'not installed'; st.className = e.running ? 'ok' : 'muted'; };
    refresh();
    body.append(h('h3', {}, 'Local engine'), h('div', { class: 'row' }, st,
      h('button', { class: 'primary', onclick: guard(async () => { st.textContent = 'starting (can take a minute)…'; await POST('/api/engine/start'); await refresh(); }) }, 'Start engine'),
      h('button', { onclick: guard(async () => { await POST('/api/engine/stop'); await refresh(); }) }, 'Stop'),
      h('button', { onclick: guard(async () => { const r = await POST(`/api/providers/${pr.id}/test`); toast(r.detail, r.ok ? 'ok' : 'err'); }) }, 'Test')),
      h('div', { class: 'row', style: 'margin-top:10px' }, h('label', {}, 'Character swap LoRA', lora), h('label', { class: 'inline' }, keep, 'Keep source soundtrack'),
        h('button', { onclick: guard(async () => { await PUT(`/api/providers/${pr.id}/settings`, { lora: lora.value, keep_source_audio: keep.checked }); toast('Saved', 'ok'); }) }, 'Save')),
      h('div', { class: 'row', style: 'margin-top:10px' }, h('label', { style: 'flex:1' }, 'Engine folder (after moving it, point here — must contain ComfyUI_windows_portable and models)', dirIn),
        h('button', { onclick: guard(async () => { await PUT(`/api/providers/${pr.id}/settings`, { engine_dir: dirIn.value }); toast('Engine folder updated', 'ok'); await refresh(); }) }, 'Set folder')),
      h('p', { class: 'muted', style: 'font-size:12px' }, 'MiniMax H3 is licensed under the MiniMax H3 Community License Agreement, Copyright © 2026 MiniMax. All Rights Reserved.'));
  }
  if (pr.billable) {
    const key = h('input', { type: 'password', placeholder: pr.credentials.configured ? 'Enter a new key to replace' : 'BytePlus ModelArk API key', autocomplete: 'off' });
    const baseUrl = h('input', { value: pr.credentials.base_url ?? pr.defaults.base_url ?? '' });
    const ep = h('input', { value: pr.credentials.endpoint_id ?? '', placeholder: 'optional endpoint ID (ep-…) instead of the model ID' });
    const fmt = h('select', {}, ['mp4', 'mov'].map((f) => h('option', { selected: (pr.settings.output_format ?? 'mp4') === f }, f)));
    const result = h('span', { class: 'muted' });
    body.append(h('h3', {}, 'Connection'), h('div', { class: 'grid g3' }, h('label', {}, 'API key', key), h('label', {}, 'Base URL (region)', baseUrl), h('label', {}, 'Endpoint ID', ep)),
      h('div', { class: 'row', style: 'margin-top:10px' },
        h('button', { class: 'primary', onclick: guard(async () => { await PUT(`/api/providers/${pr.id}/credentials`, { api_key: key.value, base_url: baseUrl.value, endpoint_id: ep.value }); key.value = ''; toast('Credentials saved (encrypted)', 'ok'); render(); }) }, 'Save credentials'),
        h('button', { onclick: guard(async () => { result.textContent = 'Testing…'; const r = await POST(`/api/providers/${pr.id}/test`); result.textContent = r.ok ? `✓ ${r.detail}` : `✗ ${r.detail}`; result.className = r.ok ? 'ok' : 'err'; }) }, 'Test connection (free)'),
        pr.credentials.configured ? h('button', { class: 'danger', onclick: guard(async () => { if (!confirm('Remove stored credentials?')) return; await DEL(`/api/providers/${pr.id}/credentials`); render(); }) }, 'Remove') : null, result),
      h('div', { class: 'row', style: 'margin-top:10px' }, h('label', {}, 'Output container', fmt), h('button', { onclick: guard(async () => { await PUT(`/api/providers/${pr.id}/settings`, { output_format: fmt.value }); toast('Saved', 'ok'); }) }, 'Save output settings'),
        h('span', { class: 'muted' }, 'MOV = H.264 4:4:4 + PCM (better for editing); MP4 default.')));
  }
  return body;
}

// ------------------------------------------------------------------ boot
(async function boot() {
  const v = await GET('/api/vocab');
  state.vocab = v.vocab; state.defaults = v.default_spec;
  state.providers = await GET('/api/providers');
  readUrl(); // a link's project wins over the remembered one
  await loadProjects();
  connectStream(); refreshBadges();
  render();
})();
