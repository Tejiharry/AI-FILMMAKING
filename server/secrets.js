// Server-side credential vault: AES-256-GCM at rest, never returned to the client.
// Master key: STUDIO_MASTER_KEY (base64, 32 bytes) or a key file generated on first
// run inside the data dir (gitignored). Losing the key = re-enter credentials.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { now } from './db.js';

export function loadMasterKey(keyFile) {
  if (process.env.STUDIO_MASTER_KEY) {
    const k = Buffer.from(process.env.STUDIO_MASTER_KEY, 'base64');
    if (k.length !== 32) throw new Error('STUDIO_MASTER_KEY must be 32 bytes, base64-encoded');
    return k;
  }
  if (fs.existsSync(keyFile)) return Buffer.from(fs.readFileSync(keyFile, 'utf8').trim(), 'base64');
  fs.mkdirSync(path.dirname(keyFile), { recursive: true });
  const k = crypto.randomBytes(32);
  fs.writeFileSync(keyFile, k.toString('base64'), { mode: 0o600 });
  return k;
}

export function encrypt(key, plaintext) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
}

export function decrypt(key, blob) {
  const [v, iv, tag, enc] = blob.split('.');
  if (v !== 'v1') throw new Error('unknown secret format');
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(enc, 'base64')), d.final()]).toString('utf8');
}

export const mask = (s) => (s && s.length > 8 ? `••••${s.slice(-4)}` : '••••');

export class Vault {
  constructor(db, key) { this.db = db; this.key = key; }

  set(provider, secret, meta = {}) {
    if (!secret || typeof secret !== 'string') throw new Error('secret required');
    const blob = encrypt(this.key, secret);
    const m = { ...meta, hint: mask(secret) };
    this.db.prepare(`INSERT INTO credentials (provider, enc_blob, meta_json, updated_at) VALUES (?,?,?,?)
      ON CONFLICT(provider) DO UPDATE SET enc_blob = excluded.enc_blob, meta_json = excluded.meta_json, updated_at = excluded.updated_at`)
      .run(provider, blob, JSON.stringify(m), now());
  }

  get(provider) {
    const r = this.db.prepare('SELECT enc_blob FROM credentials WHERE provider = ?').get(provider);
    return r ? decrypt(this.key, r.enc_blob) : null;
  }

  // Safe for the client: no secret material.
  describe(provider) {
    const r = this.db.prepare('SELECT meta_json, updated_at FROM credentials WHERE provider = ?').get(provider);
    return r ? { configured: true, ...JSON.parse(r.meta_json), updated_at: r.updated_at } : { configured: false };
  }

  remove(provider) { this.db.prepare('DELETE FROM credentials WHERE provider = ?').run(provider); }
}

// Scrub anything that looks like a bearer token / API key from text before logging.
export function redact(text, secrets = []) {
  let s = String(text ?? '');
  for (const sec of secrets) if (sec && sec.length >= 6) s = s.split(sec).join('[REDACTED]');
  return s.replace(/(Bearer\s+)[A-Za-z0-9._\-]{8,}/gi, '$1[REDACTED]');
}
