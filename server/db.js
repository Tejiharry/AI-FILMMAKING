// SQLite persistence via Node's built-in node:sqlite (no native addon install).
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const MIGRATIONS = [
  `
  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    logline TEXT DEFAULT '',
    settings_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE scenes (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    idx INTEGER NOT NULL,
    heading TEXT NOT NULL DEFAULT '',
    script_text TEXT NOT NULL DEFAULT '',
    settings_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE shots (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    scene_id TEXT NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
    idx INTEGER NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    spec_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'draft',
    selected_job_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE assets (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,              -- image | video | audio | other
    origin TEXT NOT NULL,            -- upload | generated | derived
    filename TEXT NOT NULL,
    path TEXT NOT NULL,
    mime TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    meta_json TEXT NOT NULL DEFAULT '{}',
    rights_json TEXT NOT NULL DEFAULT '{}',
    tags_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL
  );
  CREATE TABLE refs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    type TEXT NOT NULL,              -- character | wardrobe | prop | location | lighting | production_design | palette | camera_language
    name TEXT NOT NULL,
    handle TEXT NOT NULL,            -- @handle used in prompts
    description TEXT NOT NULL DEFAULT '',
    asset_ids_json TEXT NOT NULL DEFAULT '[]',
    attrs_json TEXT NOT NULL DEFAULT '{}',
    consent_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(project_id, handle)
  );
  CREATE TABLE jobs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    shot_id TEXT,
    workflow TEXT NOT NULL DEFAULT 'generate',
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    status TEXT NOT NULL,            -- awaiting_approval | queued | submitting | running | succeeded | failed | cancelled | rejected
    idempotency_key TEXT NOT NULL,
    spec_snapshot_json TEXT NOT NULL,
    request_json TEXT NOT NULL,
    compile_report_json TEXT NOT NULL DEFAULT '{}',
    estimate_json TEXT NOT NULL DEFAULT '{}',
    provider_task_id TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT,
    error_json TEXT,
    result_json TEXT,
    output_asset_id TEXT,
    parent_job_id TEXT,
    label TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    approved_at TEXT,
    submitted_at TEXT,
    finished_at TEXT
  );
  CREATE INDEX jobs_status ON jobs(status);
  CREATE INDEX jobs_idem ON jobs(idempotency_key);
  CREATE TABLE credentials (
    provider TEXT PRIMARY KEY,
    enc_blob TEXT NOT NULL,
    meta_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL
  );
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL
  );
  CREATE TABLE usage (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    estimated_usd REAL NOT NULL DEFAULT 0,
    actual_usd REAL,
    tokens INTEGER,
    billable INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE presets (
    id TEXT PRIMARY KEY,
    project_id TEXT,                 -- NULL = global
    kind TEXT NOT NULL,              -- shot | look | camera
    name TEXT NOT NULL,
    data_json TEXT NOT NULL,
    builtin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    level TEXT NOT NULL,
    kind TEXT NOT NULL,
    message TEXT NOT NULL,
    data_json TEXT NOT NULL DEFAULT '{}'
  );
  `,
  `
  CREATE TABLE qc_reports (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    asset_id TEXT NOT NULL,
    job_id TEXT,
    report_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE analyses (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    asset_id TEXT NOT NULL,
    kind TEXT NOT NULL,              -- shot_segmentation | ...
    result_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  `,
];

export const now = () => new Date().toISOString();
export const uid = () => randomUUID();

export function openDb(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (v INTEGER NOT NULL)');
  const row = db.prepare('SELECT v FROM schema_version').get();
  let v = row ? row.v : 0;
  if (!row) db.prepare('INSERT INTO schema_version (v) VALUES (0)').run();
  for (; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.prepare('UPDATE schema_version SET v = ?').run(v + 1);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  return db;
}

// Parse *_json columns into objects (`spec_json` -> `spec`).
export function hydrate(row) {
  if (!row) return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (k.endsWith('_json')) out[k.slice(0, -5)] = v == null ? null : JSON.parse(v);
    else out[k] = v;
  }
  return out;
}

export function logEvent(db, level, kind, message, data = {}) {
  db.prepare('INSERT INTO events (ts, level, kind, message, data_json) VALUES (?,?,?,?,?)')
    .run(now(), level, kind, message, JSON.stringify(data));
}

export function getSetting(db, key, fallback) {
  const r = db.prepare('SELECT value_json FROM settings WHERE key = ?').get(key);
  return r ? JSON.parse(r.value_json) : fallback;
}

export function setSetting(db, key, value) {
  db.prepare('INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json')
    .run(key, JSON.stringify(value));
}
