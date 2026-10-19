# Architecture

**Goal:** a filmmaker-owned, model-independent production studio. The value is in the engine (structured shot
specs, inheritance, honest control reporting, orchestration, QC, interchange), not a skin over one video API.

```
web/ (vanilla JS SPA) ──HTTP/SSE──► server/app.js (node:http router, localhost only)
                                      │
     ┌───────────────┬────────────────┼──────────────────┬───────────────────┐
 engine/           services/        providers/          media.js            db.js
 shotspec.js       generation.js    base.js (contract)  ffmpeg/ffprobe       node:sqlite
 cinematography.js runner.js        mock.js             (native or WSL)      (WAL, migrations)
 compiler.js       assets.js        seedance.js                              secrets.js (AES-256-GCM vault)
 director.js
 transform.js / qc.js / exports.js / presets.js
```

## Stack and why
- **Node ≥ 24, zero runtime dependencies.** Built-in `node:sqlite`, `fetch`, `node:test`, streams. Nothing to install,
  no supply-chain surface, runs anywhere Node runs. (An LLM Director tier would add `@anthropic-ai/sdk` — pending approval.)
- **SQLite** (`data/studio.db`, WAL) for projects, scenes, shots, assets, references, jobs, usage, presets, QC, events.
- **Local files** under `data/assets/<project>/` and `data/outputs/<project>/`. Never served publicly; the server binds
  `127.0.0.1`, refuses foreign `Host` headers (DNS rebinding) and cross-origin writes (CSRF).
- **ffmpeg** for probe, thumbnails, frames, scene detection, QC and the mock provider; auto-detects native vs WSL.

## Core data model
- **ShotSpec** (`engine/shotspec.js`) — provider-independent: intent, duration, aspect, resolution, framing, camera,
  lens, lighting, look, atmosphere, pacing, subjects (@handles), location, references (roles), dialogue, audio,
  timed beats, negative, workflow, model preference. Blank = inherit.
- **Inheritance:** `defaultSpec ← project.settings.shot_defaults ← scene.settings.shot_defaults ← shot.spec`
  (deep merge; blanks never override; project/scene references append).
- **References library** (`refs`): characters, wardrobe, props, locations, lighting, production design, palettes,
  camera language — each with a stable description, media and consent record; used in prompts by `@handle`.

## Generation pipeline
1. `planGeneration` resolves the effective spec, loads refs/assets, compiles, validates (spec + provider), checks
   rights/consent, estimates cost, computes an idempotency key (sha256 of provider, model, workflow, prompt, params,
   input file hashes).
2. **Compiler** (`engine/compiler.js`) emits `{prompt, params, inputs, report}`. Each control is reported as
   `api_param` (documented parameter → guaranteed delivery), `reference`, `prompt` (best effort) or `unsupported`.
   Provider-specific reference tokens (`@Image1`) are substituted by the adapter, never hard-coded in the engine.
3. `createJob` — identical active request → returns the existing job (no duplicate billing). Billable providers start
   in `awaiting_approval`; approval requires the exact estimate and passes per-job/day/month budgets.
4. **Runner** (`services/runner.js`) — submits queued jobs; retries only provably pre-send failures (connection refused,
   HTTP 429) with backoff, max 3; an uncertain submit (timeout after send) → `needs_review` + Reconcile via the
   provider's List API; crash during submit → `needs_review` on restart. Polls (safe to retry), downloads results
   immediately (ModelArk URLs expire in 24 h), registers output + last frame as assets, records usage tokens.
5. SSE `/api/stream` pushes job updates to the UI.

## Provider adapters (`providers/base.js` contract)
`models · caps · validate · estimate · toWire · refToken · submit · poll · cancel · download · testConnection · listRecent`.
Capability descriptors drive generic validation (durations, resolutions, ratios, reference counts, frame/reference
exclusivity, workflow inputs). Adding Kling/Veo/etc. = one new file implementing the contract from *their* docs.

- **mock** — free/offline; test-pattern clips labelled "MOCK PROVIDER"; deterministic failure tokens.
- **seedance** — ModelArk `dreamina-seedance-2-5-260628`, body fields only, documented limits; images/audio sent as
  Base64, video references require a hosted `https://`/`asset://` URL (no Base64 video in the API; we don't publish
  files automatically).

## AI orchestration
- **Director** — deterministic screenplay parser + coverage grammar (establish, two-shot then singles, inserts for
  handled objects, closer sizes and reactions for heightened beats). Reproducible and free. LLM refinement tier is a
  separate, optional, configurable API (not Claude Code) — pending dependency approval.
- **Transform planner** — reference analysis (cuts, keyframes, rhythm) → recreate / motion transfer / swap /
  selective change / style / extend, each a new scene of draft shots; sources never modified.
- **Continuity** — reference packs, inherited look, chain-from-previous (last frame → first frame).
- **QC** — measured vs manual split; targeted fix recommendations.

## Claude Code vs runtime
Claude Code is the development environment (skills in `.claude/skills/`). The running app never needs Claude Code.

## MCP decision
Not added. The REST API already gives Claude Code (and any agent) full control via HTTP; an MCP server would duplicate
it. Revisit if a non-HTTP agent client or tool-level permissioning becomes a requirement.

## Deployment
Local workstation app (`npm start`). Not designed for multi-user internet exposure: no auth layer; keep it bound to
localhost. For remote use put it behind an authenticated reverse proxy and move the vault key to `STUDIO_MASTER_KEY`.
