// Shared upload: Browse button + drag-and-drop anywhere, rights/consent ticks in plain view,
// per-file progress (XHR — fetch has no upload progress) and inline errors. Used by every view.
// purpose 'character' also creates a Reference Studio entry from the uploaded image(s).

const fmtSize = (b) => (b > 1e9 ? `${(b / 1e9).toFixed(2)} GB` : b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.ceil(b / 1e3)} KB`);
const kindOf = (f) => (f.type.startsWith('video/') || /\.(mov|mxf|mp4|mkv|webm|avi)$/i.test(f.name) ? 'video' : f.type.startsWith('image/') || /\.(png|jpe?g|webp|tiff?|heic|bmp)$/i.test(f.name) ? 'image' : f.type.startsWith('audio/') || /\.(wav|mp3|m4a|aac|flac)$/i.test(f.name) ? 'audio' : 'other');

function xhrUpload(url, file, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('PUT', url);
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    x.onload = () => { let d = {}; try { d = JSON.parse(x.responseText || '{}'); } catch {} x.status < 300 ? resolve(d) : reject(new Error(d.error || `upload failed (${x.status})`)); };
    x.onerror = () => reject(new Error('network error — is the studio still running?'));
    x.send(file);
  });
}

// opts: { projectId, files?, accept?, purpose?: 'media'|'character', title?, onDone(assets, ref) }
export function openUpload(ui, opts) {
  const { h, modal, closeModal, toast, POST } = ui;
  if (!opts.projectId) return toast('Open or create a project first (Projects page).', 'err');
  let files = [...(opts.files ?? [])];
  const character = opts.purpose === 'character';
  const rights = h('input', { type: 'checkbox' });
  const person = h('input', { type: 'checkbox', checked: character });
  const consent = h('input', { type: 'checkbox' });
  const guardian = h('input', { type: 'checkbox' });
  const tags = h('input', { placeholder: 'tags (optional), comma separated', value: opts.tags ?? '' });
  const nameIn = h('input', { placeholder: 'Character name, e.g. Gulab' });
  const typeSel = h('select', {}, ['character', 'wardrobe', 'prop', 'location'].map((t) => h('option', {}, t)));
  const picker = h('input', { type: 'file', multiple: !character, accept: opts.accept ?? (character ? 'image/*' : 'video/*,image/*,audio/*,.mov,.mxf'), style: 'display:none' });
  const list = h('div', { style: 'margin:10px 0' });
  const msg = h('div', { class: 'err', style: 'font-size:12.5px;min-height:18px' });
  const go = h('button', { class: 'primary' }, character ? 'Upload & create reference' : 'Upload');
  const rows = new Map();
  const draw = () => {
    list.replaceChildren(...(files.length ? files.map((f) => {
      const bar = h('i', { style: 'width:0%' });
      const status = h('span', { class: 'muted', style: 'font-size:12px' }, `${kindOf(f)} · ${fmtSize(f.size)}`);
      rows.set(f, { bar, status });
      return h('div', { class: 'panel tight', style: 'margin-bottom:6px' }, h('div', { class: 'row', style: 'justify-content:space-between;flex-wrap:nowrap' }, h('b', { style: 'font-size:13px;word-break:break-all' }, f.name), status),
        h('div', { class: 'progress', style: 'margin-top:6px' }, bar));
    }) : [h('div', { class: 'dropzone', onclick: () => picker.click() }, character ? 'Drop a photo or character sheet here, or click Browse' : 'Drop files here, or click Browse', h('span', { class: 'lim' }, character ? 'JPG / PNG / WebP — one image' : 'Video (MOV, MP4, MXF…), images, audio — any size up to 50 GB'))]));
    if (!character && !files.length) nameIn.value = '';
    if (character && files[0] && !nameIn.value) nameIn.value = files[0].name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 40);
    validate();
  };
  const validate = () => {
    consent.disabled = guardian.disabled = !person.checked;
    if (!person.checked) { consent.checked = false; guardian.checked = false; }
    msg.textContent = !files.length ? '' : !rights.checked ? 'Tick “I have the rights to use this media” to upload.' : person.checked && !consent.checked && !guardian.checked ? 'Real person shown: tick consent (or guardian consent for a child) — swaps of real people are blocked without it.' : character && !nameIn.value.trim() ? 'Give the character a name.' : '';
    go.disabled = !files.length || !rights.checked || (character && !nameIn.value.trim());
  };
  picker.onchange = () => { files = character ? [...picker.files].slice(0, 1) : [...files, ...picker.files]; draw(); };
  for (const el of [rights, person, consent, guardian]) el.onchange = validate;
  nameIn.oninput = validate;
  const body = h('div', {},
    h('h1', {}, opts.title ?? (character ? 'Upload a character reference' : 'Add media')),
    h('p', { class: 'sub' }, 'Files are copied into this project on your PC. Nothing is uploaded to the internet.'),
    list, h('div', { class: 'row' }, h('button', { onclick: () => picker.click() }, 'Browse…'), files.length ? h('span', { class: 'muted' }, `${files.length} file${files.length > 1 ? 's' : ''}`) : null, picker),
    character ? h('div', { class: 'grid g2', style: 'margin-top:10px' }, h('label', {}, 'Name', nameIn), h('label', {}, 'Type', typeSel)) : null,
    h('div', { style: 'margin-top:10px;display:flex;flex-direction:column;gap:6px' },
      h('label', { class: 'inline' }, rights, h('b', {}, 'I have the rights to use this media'), h('span', { class: 'err' }, ' (required)')),
      h('label', { class: 'inline' }, person, 'Shows a real person'),
      h('label', { class: 'inline', style: 'margin-left:22px' }, consent, 'The person consents to this use'),
      h('label', { class: 'inline', style: 'margin-left:22px' }, guardian, 'Shows a child — I am the parent/guardian and consent'),
      character ? null : tags),
    msg,
    h('div', { class: 'row', style: 'justify-content:flex-end;margin-top:10px' }, h('button', { onclick: closeModal }, 'Cancel'), go));
  go.onclick = async () => {
    if (go.disabled) return;
    go.disabled = true;
    const done = [];
    for (const f of files) {
      const r = rows.get(f);
      const q = new URLSearchParams({ filename: f.name, rights_confirmed: '1', depicts_real_person: person.checked ? '1' : '0',
        likeness_consent: consent.checked || guardian.checked ? '1' : '0', rights_note: guardian.checked ? 'guardian consent (minor)' : consent.checked ? 'subject consent' : '', tags: tags.value });
      try {
        const res = await xhrUpload(`/api/projects/${opts.projectId}/assets?${q}`, f, (p) => { r.bar.style.width = `${Math.round(p * 100)}%`; r.status.textContent = `${Math.round(p * 100)}%`; });
        r.bar.style.width = '100%'; r.status.textContent = res.duplicate ? 'already in library' : 'uploaded ✓'; r.status.className = 'ok';
        done.push(res.asset);
      } catch (e) { r.status.textContent = e.message; r.status.className = 'err'; }
    }
    if (!done.length) { go.disabled = false; return; }
    let ref = null;
    if (character) {
      const consentRec = { likeness_consent: consent.checked || guardian.checked, guardian: guardian.checked, recorded_at: new Date().toISOString() };
      let name = nameIn.value.trim();
      for (let i = 0; i < 5 && !ref; i++) {
        try { ref = await POST(`/api/projects/${opts.projectId}/refs`, { name: i ? `${name} ${i + 1}` : name, type: typeSel.value, description: '', asset_ids: done.map((a) => a.id), consent: consentRec }); }
        catch (e) { if (e.status !== 409) { msg.textContent = e.message; go.disabled = false; return; } }
      }
    }
    toast(character ? `Reference ${ref?.handle} created` : `${done.length} file${done.length > 1 ? 's' : ''} added`, 'ok');
    closeModal();
    opts.onDone?.(done, ref);
  };
  // Dropping more files onto the open dialog adds them.
  body.addEventListener('dragover', (e) => e.preventDefault());
  body.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); const add = [...e.dataTransfer.files]; files = character ? add.slice(0, 1) : [...files, ...add]; draw(); });
  modal(body, { wide: true });
  draw();
}

// Drop files anywhere on the page → upload dialog; the current view decides what the files are for.
export function installGlobalDrop(ui, getContext) {
  const overlay = ui.h('div', { id: 'drop-overlay', class: 'hidden' }, ui.h('div', {}, ui.h('b', {}, 'Drop to add'), ui.h('span', {}, ' — files are copied into the open project')));
  document.body.append(overlay);
  let depth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
  window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; depth++; overlay.classList.remove('hidden'); });
  window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) overlay.classList.add('hidden'); });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); depth = 0; overlay.classList.add('hidden'); // never let the browser open the file instead
    if (document.querySelector('#modal')?.open) return; // an open dialog handles its own drops
    const files = [...e.dataTransfer.files];
    openUpload(ui, { ...getContext(files), files });
  });
}
