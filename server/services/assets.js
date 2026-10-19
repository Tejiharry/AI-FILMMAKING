// Asset library: streaming uploads (never buffered whole in memory), sha256,
// ffprobe metadata, thumbnails. Originals are never modified; derived files
// (thumbnails, frames) are written beside them.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { hydrate, now, uid, logEvent } from '../db.js';
import { probe, thumbnail } from '../media.js';

const MIME = {
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.mxf': 'application/mxf',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.bmp': 'image/bmp', '.tif': 'image/tiff', '.tiff': 'image/tiff', '.gif': 'image/gif', '.heic': 'image/heic',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.aac': 'audio/aac', '.m4a': 'audio/mp4', '.flac': 'audio/flac',
};
export const mimeFor = (name) => MIME[path.extname(name).toLowerCase()] ?? 'application/octet-stream';
export const kindFor = (mime) => (mime.startsWith('video/') || mime === 'application/mxf' ? 'video' : mime.startsWith('image/') ? 'image' : mime.startsWith('audio/') ? 'audio' : 'other');

let assetsRoot = null;
export function setAssetsRoot(dir) { assetsRoot = dir; }

const safeName = (n) => path.basename(String(n)).replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'file';

async function sha256File(file) {
  const h = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(file), h);
  return h.digest('hex');
}

async function describe(file, kind) {
  const meta = {};
  if (kind === 'video' || kind === 'audio' || kind === 'image') {
    try {
      const p = await probe(file);
      if (kind === 'image') meta.image = p.video ? { width: p.video.width, height: p.video.height } : null;
      else { meta.duration_s = p.duration_s; meta.video = p.video; meta.audio = p.audio; meta.format = p.format; }
    } catch (e) { meta.probe_error = e.message.slice(0, 200); }
  }
  return meta;
}

async function makeThumb(file, kind, id) {
  if (kind !== 'video' && kind !== 'image') return null;
  const out = path.join(path.dirname(file), `${id}.thumb.jpg`);
  try { await thumbnail(file, out, kind === 'video' ? 0.5 : 0); return out; } catch { return null; }
}

// Register a file that already lives inside the data dir (generated outputs).
export async function registerFile(db, { projectId, file, origin, meta = {}, rights = {}, tags = [] }) {
  const id = uid();
  const mime = mimeFor(file);
  const kind = kindFor(mime);
  const st = fs.statSync(file);
  const [sha, desc] = await Promise.all([sha256File(file), describe(file, kind)]);
  const thumb = await makeThumb(file, kind, id);
  const m = { ...desc, ...meta, thumb };
  db.prepare(`INSERT INTO assets (id, project_id, kind, origin, filename, path, mime, bytes, sha256, meta_json, rights_json, tags_json, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, projectId, kind, origin, path.basename(file), file, mime, st.size, sha, JSON.stringify(m), JSON.stringify(rights), JSON.stringify(tags), now());
  return hydrate(db.prepare('SELECT * FROM assets WHERE id = ?').get(id));
}

// Stream an HTTP request body into the project's asset folder.
export async function ingestUpload(db, { projectId, req, filename, rights, tags = [], maxBytes }) {
  const dir = path.join(assetsRoot, projectId);
  fs.mkdirSync(dir, { recursive: true });
  const id = uid();
  const name = safeName(filename);
  const dest = path.join(dir, `${id}_${name}`);
  let bytes = 0;
  const limiter = new Transform({
    transform(chunk, _e, cb) { bytes += chunk.length; if (bytes > maxBytes) cb(Object.assign(new Error('upload too large'), { status: 413 })); else cb(null, chunk); },
  });
  try { await pipeline(req, limiter, fs.createWriteStream(dest)); }
  catch (e) { fs.rmSync(dest, { force: true }); throw e; }
  if (!bytes) { fs.rmSync(dest, { force: true }); throw Object.assign(new Error('empty upload'), { status: 400 }); }
  const sha = await sha256File(dest);
  const dupe = db.prepare('SELECT * FROM assets WHERE project_id = ? AND sha256 = ?').get(projectId, sha);
  if (dupe) { fs.rmSync(dest, { force: true }); return { asset: hydrate(dupe), duplicate: true }; }
  const mime = mimeFor(name);
  const kind = kindFor(mime);
  const meta = await describe(dest, kind);
  meta.thumb = await makeThumb(dest, kind, id);
  db.prepare(`INSERT INTO assets (id, project_id, kind, origin, filename, path, mime, bytes, sha256, meta_json, rights_json, tags_json, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, projectId, kind, 'upload', name, dest, mime, bytes, sha, JSON.stringify(meta), JSON.stringify(rights), JSON.stringify(tags), now());
  logEvent(db, 'info', 'asset.upload', `${name} (${bytes} bytes)`, { asset_id: id });
  return { asset: hydrate(db.prepare('SELECT * FROM assets WHERE id = ?').get(id)), duplicate: false };
}

// User-initiated deletion: removes the file(s) and the row. Refuses if the asset
// is the selected output of a shot or used by a library reference.
export function deleteAsset(db, id) {
  const a = hydrate(db.prepare('SELECT * FROM assets WHERE id = ?').get(id));
  if (!a) throw Object.assign(new Error('asset not found'), { status: 404 });
  const usedByRef = db.prepare(`SELECT name FROM refs WHERE project_id = ? AND asset_ids_json LIKE ?`).get(a.project_id, `%${id}%`);
  if (usedByRef) throw Object.assign(new Error(`asset is used by reference "${usedByRef.name}" — remove it there first`), { status: 409 });
  for (const f of [a.path, a.meta?.thumb]) if (f) fs.rmSync(f, { force: true });
  db.prepare('DELETE FROM assets WHERE id = ?').run(id);
  db.prepare('UPDATE jobs SET output_asset_id = NULL WHERE output_asset_id = ?').run(id);
  logEvent(db, 'info', 'asset.delete', `${a.filename} deleted by user`, { asset_id: id });
}
