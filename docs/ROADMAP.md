# Roadmap and milestone status (2026-10-18)

Legend: **Implemented** = code exists · **Tested** = covered by `npm test` (real HTTP server, SQLite, ffmpeg) ·
**Experimental** = works mechanically, output quality unvalidated · **Paid** = needs ModelArk billing to validate.

## Milestone 1 — Functional MVP ✅
| Requirement | Implemented | Tested | Notes |
|---|---|---|---|
| Create project | ✅ | ✅ e2e | |
| Scenes + ShotSpecs | ✅ | ✅ e2e/unit | inheritance project → scene → shot |
| Upload + organise references | ✅ | ✅ e2e | streaming upload, sha256 dedupe, ffprobe, thumbnails, rights/consent gate |
| Secure Seedance credentials | ✅ | ✅ e2e | AES-256-GCM vault, never returned to client, scrubbed from logs |
| Valid generation request | ✅ | ✅ unit + e2e (exact body asserted against docs) | |
| Cost estimate / warning | ✅ | ✅ unit (matches documented $1.156 example) | |
| Submit authorised job | ✅ | ✅ e2e with stubbed API | approval = exact amount; budgets enforced |
| Track status | ✅ | ✅ | SSE + polling |
| Retrieve + preview | ✅ | ✅ | range-served video, last frame saved |
| History, settings, assets | ✅ | ✅ | jobs keep spec snapshot, prompt, params, task id, usage |
| Download | ✅ | ✅ | |
| Mock provider end-to-end | ✅ | ✅ | incl. moderation + transient-retry paths |
| **Real Seedance generation** | ✅ code | ❌ **not run** | **Paid** — needs your key + activated model (≥ $30 on ModelArk) and your go |

## Milestone 2 — Advanced cinematography ✅ (adherence Experimental)
OG Cinema Studio (all controls, inherit badges, presets, save-as-preset), control report, timed beats, AI Director
(deterministic). Tested: compiler, director, presets via e2e. **Experimental:** whether Seedance follows lens/light/move
phrasing — needs the benchmark. **Pending approval:** LLM Director tier (adds `@anthropic-ai/sdk`).

## Milestone 3 — Video transformation 🟡
Reference analysis ✅ tested. Recreate / motion transfer / swap / selective change / style / extend planning ✅ tested
(plans). **Paid + Experimental:** output quality. **Blocker:** Seedance video references need a hosted URL — options in
"Next" below.

## Milestone 4 — Consistency & automation 🟡
Reference library, chain-from-previous, batch generation + batch approval, QC, compare, revisions ✅. Project skills
✅ (10). **Not yet:** concurrency cap per account tier (3 for individual accounts), automatic drift scoring across a
scene, draft→final flow.

## Milestone 5 — Post-production ✅ files / 🟡 import
EDL (CMX3600), FCPXML 1.10, OTIO of selected takes ✅ (well-formed, tested). **Not yet verified:** import into DaVinci
Resolve 21 by eye (needs a real take set; will do on your go — it's a read-only import into a new timeline).

## Local MiniMax H3 engine (2026-10-18) 🟡
Downloaded with SHA-256 verification, now at `C:\Users\harry\Downloads\H3 Engine` (re-verified after the move; cold
start ~30 s); provider `local-h3` + engine manager + character-swap transform
implemented; adapter tested against a fake ComfyUI API (graph build, 24 fps conform, polling, download, soundtrack mux).
**First GPU run 2026-10-18 (neutral test material, 480p, 4 s, swap LoRA v1, 20 steps):** succeeded through the studio in
5 min 11 s (ComfyUI 303 s; 12.6 s/step). VRAM peak 15.5 / 16.3 GB (4.9 GB already used by other apps at start); system
RAM peak ~30.4 / 32 GB, commit ~62 GB (≈30 GB in the page file); engine process ~15.4 GB. Output 864×480, 24 fps, trimmed
to the source length; source soundtrack restored exactly (RMS −21.12 vs −21.11 dB); studio QC 6/6 pass. Source motion
kept, reference look applied. **Not yet tested:** a real person swap, 720p/768p, clips > 4 s, Turbo, LoRA v1.5. Close
Resolve/AE before swaps — there is no RAM headroom.

## Decisions (2026-10-18, Harry)
- Stay independent: no Higgsfield account route (no Higgsfield models/Soul ID/credits/uploads); Higgsfield Blender add-on not installed.
- `Higgsfield-mcp-skill.md` and `higgsfield-timed-prompts` (Downloads) are reference only — their wording is not reused.
- Skills inventory (`docs/research/higgsfield-skills-inventory.md`): Higgsfield publishes no agent skill for Cinema Studio,
  Genjutsu or Popcorn; gaps were Katana extras, prompt checks, reframe/upscale, Blender previz import.

## OG Katana beat + soundtrack (2026-10-18) ✅
Soundtrack analysis (tempo, beats, onsets, cuts-on-beat), rhythm strip, conform-to-reference (exact shot lengths,
reference size/fps/soundtrack), project recipes (save/apply). Tested: unit (click tracks 72–150 BPM), e2e flow, browser.

## Inventory gaps closed (2026-10-18) ✅
Pre-send prompt checks (block unknown @handles; warn on word budget, dialogue issues, contradictions), reframe (crop /
bars / blurred fill), resample upscale, Blender previz import with camera-path → move stack + lens, previz → shot.
Generative outpaint stays unsupported with the current models; AI super-resolution would need a model download (ask).

## Next (in order)
1. **Live validation (Paid, your go):** one 5 s 480p text-to-video (~$0.51) → confirm auth, wire format, polling,
   download, billing figure vs estimate. Then one image-to-video.
2. **Video reference hosting:** add BytePlus TOS presigned upload (keeps files private, short-lived URLs) — needs your
   TOS bucket; alternative is manual `asset://` IDs from the ModelArk console (works today).
3. Concurrency limiter per ModelArk tier; draft → final workflow.
4. LLM Director tier (after SDK approval): script → specs refinement, conversational revisions.
5. Benchmark runs (docs/BENCHMARK.md).
6. Resolve import check of FCPXML/OTIO; optional Resolve scripting bridge to drop selected takes into a WORKSPACE timeline.
