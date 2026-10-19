// Central runtime configuration. Everything is overridable by env vars so tests
// can run against an isolated temp data directory.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadConfig(overrides = {}) {
  const dataDir = overrides.dataDir ?? process.env.STUDIO_DATA_DIR ?? path.join(root, 'data');
  return {
    root,
    dataDir,
    dbPath: overrides.dbPath ?? path.join(dataDir, 'studio.db'),
    assetsDir: path.join(dataDir, 'assets'),
    outputsDir: path.join(dataDir, 'outputs'),
    keyFile: path.join(dataDir, 'master.key'),
    webDir: path.join(root, 'web'),
    host: overrides.host ?? process.env.STUDIO_HOST ?? '127.0.0.1',
    port: overrides.port ?? Number(process.env.STUDIO_PORT ?? 4517),
    // Poll interval for the job worker (ms). Tests shrink this.
    pollMs: overrides.pollMs ?? Number(process.env.STUDIO_POLL_MS ?? 5000),
    // Hard ceiling on how long any single generation task may run before we
    // mark it timed out locally (provider task may still finish; we re-check).
    jobTimeoutMs: overrides.jobTimeoutMs ?? Number(process.env.STUDIO_JOB_TIMEOUT_MS ?? 45 * 60 * 1000),
    maxRetries: overrides.maxRetries ?? 3,
    // Upload cap (bytes).
    // Camera originals (.mov/.mxf) can be large; uploads stream to disk, so the cap is about disk space.
    maxUploadBytes: overrides.maxUploadBytes ?? 50 * 1024 ** 3,
    mockDelayMs: overrides.mockDelayMs ?? Number(process.env.STUDIO_MOCK_DELAY_MS ?? 4000),
  };
}
