# Harry AI FILM STUDIO

A filmmaker-owned, model-independent AI production studio: structured shot specs with project → scene → shot
inheritance, an AI Director, reference library, motion/edit transformations, cost-gated generation on
**BytePlus ModelArk Seedance 2.5** (plus a free mock provider), QC, version compare and NLE export (EDL / FCPXML / OTIO).

Studios: **OG Cinema Studio** (cinematography), **OG Katana** (reference-driven recreation, style, extend), **OG Genjutsu**
(character/face swap, motion transfer, object swap) — plus Scene Builder, Reference Studio, Edit Studio, Asset Library,
Quality Review.

Interface (2026-10-18): OG Cinema Studio is a composer — setting tiles (References, Film, Camera, Movement, Lighting,
Palette) that show the current value or **Auto**, a prompt with `@` mentions for Reference Studio items, a chip toolbar
(model, resolution, aspect, duration, audio, 1–4 takes) and a Generate button with the live cost. Tiles open modals with
**Reset all to Auto**: lens reels labelled by intent, a hover-to-play camera-move grid with an ordered move stack
("first … then …"), lighting cards with a light-direction preview and Kelvin slider, palette cards. OG Genjutsu /
OG Katana use an inputs column (mode cards, source drop zone with limits, reference cards) and a History pane with a
before/after split wipe; OG Katana also analyses the reference soundtrack (tempo, beats, cuts on the beat), conforms
the selected takes to the reference shot lengths over the reference soundtrack, and saves/applies timing recipes; Edit Studio has side-by-side and split-wipe compare. UX patterns were studied from Higgsfield's
public pages (`docs/research/higgsfield-ui-study.md`); the visual design, wording and assets are our own.

Independent implementation from public information and official API docs — no Higgsfield code, branding or assets.

## Requirements
- Node.js ≥ 24 (tested on 26.8). **No npm install needed** — zero runtime dependencies.
- ffmpeg + ffprobe on PATH, or inside WSL (auto-detected on Windows).

## Run as a Windows app
Double-click the **Harry AI FILM STUDIO** shortcut (desktop / Start menu), which runs `app/launch.ps1`:
it starts the studio hidden in the background (`STUDIO_APP_MODE=1`) and opens it in its own Edge app window
(no address bar, own taskbar icon). Close the window and the studio shuts itself down about a minute later,
unless a generation is still running. Logs: `data/studio.log`, `data/studio-error.log`.
`Start Harry AI FILM STUDIO.cmd` runs it in a visible console for debugging.

Shortcut target: `powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "<repo>applaunch.ps1"` (icon `app/studio.ico`).

## Run from a terminal
```bash
npm start
```
Open http://127.0.0.1:4517. Data lives in `./data` (database, media, encryption key — gitignored).

Drag files anywhere onto the window to add them: each page decides what they are for (OG Genjutsu: a video becomes the
source, a photo becomes the replacement character; OG Cinema Studio: a photo becomes a character on the shot). Every mode
shows a labelled **Prompt → sent to the model** box, and OG Cinema Studio shows the full compiled prompt before you generate.

| Env var | Default | Purpose |
|---|---|---|
| `STUDIO_PORT` / `STUDIO_HOST` | 4517 / 127.0.0.1 | listen address (keep it local) |
| `STUDIO_DATA_DIR` | `./data` | database + media location |
| `STUDIO_MASTER_KEY` | auto key file | base64 32-byte key for the credential vault |
| `STUDIO_POLL_MS` | 5000 | job polling interval |

## Connect Seedance 2.5
1. In BytePlus ModelArk (region ap-southeast-1) activate `dreamina-seedance-2-5-260628` (BytePlus requires ≥ $30
   balance, savings plan or resource pack) and create an API key.
2. App → **Model Settings** → paste the key → **Test connection (free)** (lists tasks; generates nothing).
3. Every paid job waits for approval: you type the exact estimated amount. Budgets (per job / day / month) are enforced.

Video references (motion transfer, edit, extend) need a hosted `https://` URL or a ModelArk `asset://` ID set as the
asset's *Remote URL* — the API does not accept Base64 video and the app never publishes your files.

## Local engine: MiniMax H3 character swap (optional, free, runs on your GPU)
Genjutsu-style character/face swap runs locally: MiniMax H3 Ref2VA + the Akatz Labs Character Swap LoRA, executed by a
**hidden ComfyUI engine** that the studio starts and drives over its local API — you never open ComfyUI.

- Engine + models: `C:\Users\harry\Downloads\H3 Engine` (internal NVMe; moved from the USB HDD, where a cold start
  took ~7 min vs ~30 s here) (portable ComfyUI v0.41.0 + `models\`), ~44 GB. Studio-written config, workflow template
  and engine log: `data\engine\`.
- Model Settings → *MiniMax H3 · local* → **Start engine** → **Test**. OG Genjutsu → *Character / face swap*.
- Inputs: one source clip (2–15 s; conformed to 24 fps automatically) + one replacement character image. The original
  soundtrack is put back on the result without re-encoding the picture.
- Swap LoRA V1 (tested with this graph, default) or V1.5 (author-tested only in a different workflow; experimental here).
- Hardware (measured 2026-10-18, 480p, 4 s): ~5 min per clip; VRAM peak 15.5/16.3 GB; system RAM ~30/32 GB plus ~30 GB
  page file. Close Resolve/After Effects while swapping. Longer or 768p clips are untested and will be slower.
- Licence: MiniMax H3 Community License (see `NOTICE`): not for use in the EU/UK/USA/South Korea; the UI shows
  "MiniMax H3" when it is used; outputs must not train other AI models. Real-person swaps require recorded consent.

## Test
```bash
npm test
```
Unit tests (engine, compiler, director, vault, Seedance wire format and pricing, exports) plus an end-to-end run
against a real server: project → upload → references → plan → mock generation → status → download; failure paths;
Seedance approval/budget/wire format against a **stubbed** API (no network, no spend); director; analysis; QC; exports;
security checks.

## Docs
- `docs/RESEARCH_REPORT.md` · `docs/research/*` — evidence with sources
- `docs/FEATURE_MATRIX.md` — what is API-native, orchestrated, post-processed, experimental, unsupported
- `docs/ARCHITECTURE.md` — design, data model, pipeline, provider contract
- `docs/ROADMAP.md` — milestone status: implemented vs tested vs paid-validation pending
- `docs/BENCHMARK.md` — comparison protocol (results pending; none fabricated)
- `.claude/skills/*` — project Claude Code skills (development-time; the app never needs Claude Code to run)

## Adding a provider
Implement the contract in `server/providers/base.js` from the provider's official docs, register it in
`server/app.js`, add wire-format tests with a stubbed `fetch`.
