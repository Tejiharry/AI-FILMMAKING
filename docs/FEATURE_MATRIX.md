# Feature matrix — Higgsfield capability → independent implementation

Sources: `docs/research/higgsfield-feature-study.md` (S1–S15, public pages only) and
`docs/research/seedance-2.5-api.md` (official BytePlus ModelArk docs, read 2026-10-18).
Higgsfield facts are about **their product**; status/approach columns are about **this app**.

In-app names: **OG Cinema Studio** (cinematography controls), **OG Katana** (reference-driven recreation, style, extend;
revisions in Edit Studio), **OG Genjutsu** (character/face swap, motion transfer, object swap, selective change). Higgsfield's
products are named Cinema Studio, Katana and Genjutsu; ours are independent implementations.

Classification: **API-native** (documented Seedance 2.5 parameter) · **Orchestrated** (several calls + app logic) ·
**Post-processed** (ffmpeg / NLE / compositing) · **Experimental** (plausible, not validated on the real API) · **Unsupported**.

Status: ✅ built + automated test · 🟡 built, needs live-API or human validation · ⏳ planned · ⛔ not possible with current APIs.

| Feature | User experience (ours) | Technical approach | API support (Seedance 2.5) | Class | Status | Priority |
|---|---|---|---|---|---|---|
| Duration, aspect, resolution | OG Cinema Studio fields, inherit from project/scene | Mapped to `duration`, `ratio`, `resolution` body fields; validated 4–30 s, documented ratios | Documented | API-native | ✅ | P0 |
| Text-to-video | Generate with no inputs | `content:[text]` | Documented | API-native | 🟡 (wire format tested with stub; no live call yet) | P0 |
| Image-to-video (first frame) | Reference role `first_frame` | `image_url` role `first_frame`, ratio forced `adaptive` | Documented | API-native | 🟡 | P0 |
| First + last frame | Roles `first_frame` + `last_frame` | Same, workflow `first_last_frame` | Documented | API-native | 🟡 | P0 |
| Multimodal references (≤30 img / 10 vid / 10 audio) | Reference inputs + library `@handles`; tokens rewritten to `@Image1…` | `reference_*` roles, `omni_reference_task_type: reference` | Documented | API-native | 🟡 | P0 |
| Audio-video generation, dialogue | Dialogue lines with timing; audio toggle | `generate_audio`; quoted dialogue in prompt | Documented (mono) | API-native + prompt | 🟡 (Punjabi not a documented language) | P1 |
| Video extend (fwd/back) | OG Katana → Extend | `omni_reference_task_type: extend` | Documented | API-native | 🟡 needs hosted URL for source | P1 |
| Draft → final (480p → 1080p) | — | `draft:true` then `draft_task` | Documented | API-native | ⏳ | P2 |
| Cost estimate + approval + budgets | Approval dialog (type exact amount), per-job/day/month limits | Token formula from docs; usage table; 402 on breach | Pricing documented; min-token rule for video input UNKNOWN | Orchestrated | ✅ | P0 |
| Duplicate-billing protection | Identical request returns existing job | sha256 idempotency key; no auto-resubmit after uncertain submit; Reconcile via List API | List endpoint documented | Orchestrated | ✅ | P0 |
| Camera movement presets (CS4: 30+) | 20 movements × speed × rig, timed beats | Compiled to prompt; reported as best effort | **No camera parameter** for 2.5 (`camera_fixed` is 1.x only) | Orchestrated | ✅ engine / 🟡 adherence unmeasured | P0 |
| Camera body / lens look / aperture / focal length | Lens + camera-body fields | Prompt phrases; never claimed as physical | None | Orchestrated (Experimental adherence) | ✅ / 🟡 | P1 |
| Lighting console | Key direction, quality, contrast, Kelvin, time of day, motivation | Prompt phrases | None | Orchestrated | ✅ / 🟡 | P1 |
| Genre / era / tempo / emotion | Look + pacing + intent.emotion | Prompt bundles | None | Orchestrated | ✅ / 🟡 | P1 |
| Colour palettes | Hex palette per project/shot + grade notes | Prompt + QC chroma check; final grade in Resolve | None | Orchestrated + Post | ✅ | P1 |
| Post grade sliders (temp, grain, exposure) | Recommend Resolve | — | — | Post-processed | ⛔ in-app by design (NLE does it better) | P3 |
| Script → shot list assistant | AI Director breakdown (coverage grammar) | Deterministic parser + rules; LLM tier pending | n/a | Orchestrated | ✅ deterministic / ⏳ LLM tier (needs SDK approval) | P0 |
| Storyboard (Popcorn) | Scene Builder storyboard with thumbnails | Shots as cards; chain last→first frame | `return_last_frame` documented | Orchestrated | ✅ | P1 |
| AI Cast / Soul ID (trained identity) | Character references (images + stable description) | Reference images; trusted-output chaining | No identity training API | Orchestrated | ✅ refs / ⛔ trained identity | P1 |
| Real-person likeness | Rights + consent flags; validation refuses untrusted real-face refs | Mirrors documented refusal; `asset://` IDs supported | Real faces refused unless authorized `asset://` or trusted output | Orchestrated | ✅ gate / 🟡 asset onboarding (BytePlus console) | P0 |
| Reference-video analysis (Katana) | OG Katana → Analyse: segments, keyframes, rhythm | ffmpeg scene-change detection | n/a | Post-processed | ✅ | P1 |
| Reference recreation (Katana rebuild) | One new shot per reference segment | Keyframe as `reference_image`, segment timing | Documented refs | Orchestrated | ✅ plan / 🟡 output | P1 |
| Soundtrack beat analysis (OG Katana) | Tempo, beat grid, onsets, cuts-on-beat + rhythm strip | Own JS onset/tempo analysis on ffmpeg-decoded PCM | n/a | Post-processed | ✅ (synthetic click tracks ±0.3 BPM; real music = heuristic, confidence shown) | P1 |
| Conform to reference (OG Katana) | Selected takes cut to reference shot lengths, size, fps, over the reference soundtrack | ffmpeg trim/hold-last-frame/scale/pad/concat + soundtrack mux; black slates for missing takes | n/a | Post-processed | ✅ (e2e: 6.0 s, 144 frames, identical onsets) | P1 |
| Pre-send prompt checks | Errors/warnings under the prompt and in the plan before anything is queued | Own rules: unknown @handles (block), word budget, dialogue speaker/overlap/quoted-line checks, setting-vs-text contradictions, Avoid-vs-description | n/a | Orchestrated | ✅ | P0 |
| Reframe | Edit Studio → Reframe: crop (position), black bars, blurred fill to 9:16/4:5/1:1/21:9… | ffmpeg crop/pad/split-blur-overlay; new derived file | n/a | Post-processed | ✅ | P1 |
| Generative outpaint | — | Would need a model that extends the frame | Seedance edit keeps the source ratio; local H3 graph is swap-only | Unsupported | ⛔ (use blurred fill or crop) | P3 |
| Upscale | Edit Studio → Upscale: 1080p / 1440p / 4K / ×2 | Lanczos resample + light unsharp — **not** AI super-resolution | n/a | Post-processed | ✅ (AI SR would need a model download — ask) | P2 |
| Blender previz → shot | Asset Library → Import Blender previz; asset → Previz → shot (motion ref / first frame) | Frame-sequence encode; camera.json (docs/blender/export_camera_json.py) → move stack + focal length | Reference video / first frame per provider | Orchestrated | ✅ (camera-path heuristic; synthetic paths tested) | P1 |
| Recipes (OG Katana) | Save a reference's structure (shots, timing, tempo); apply to new subjects | Project-scoped preset of kind `recipe` → recreation scene | n/a | Orchestrated | ✅ | P1 |
| Motion transfer (Genjutsu) | OG Genjutsu → Motion transfer | Source as `reference_video` + replacement refs | Reference video documented; fidelity not specified | Experimental | 🟡 | P1 |
| Object / subject swap (Genjutsu) | OG Genjutsu → Swap | `omni_reference_task_type: edit` | Documented edit task | Orchestrated | 🟡 (not pixel-preserving) | P1 |
| Character / face swap (Genjutsu) — local | OG Genjutsu → Character / face swap → provider *MiniMax H3 · local* | Hidden ComfyUI runs H3 Ref2VA + Akatz Character Swap LoRA v1; 24 fps conform; source soundtrack muxed back | Local open weights (MiniMax H3 Community License) | Experimental (local) | ✅ pipeline verified on the GPU (480p, 4 s neutral test: 5 min, VRAM 15.5/16.3 GB) / 🟡 face-swap quality on real people untested | P1 |
| Masked inpaint / tracked region edit | — | Would need segmentation + compositing | No mask field | Unsupported (API) → Post-processed path | ⏳ (Fusion/Resolve compositing route) | P2 |
| Conversational revision (Katana) | Edit Studio → Revise (new version, history kept) | Spec patch + new job with `parent_job_id` | n/a | Orchestrated | ✅ (plain-text; LLM interpretation ⏳) | P1 |
| Reuse renders on revision | Only revised shots regenerate; others keep selected takes | Per-shot jobs + idempotency | n/a | Orchestrated | ✅ | P1 |
| Batch generation | Scene Builder → Generate scene; batch approval by total | Per-shot plans, one confirmation | Rate limits documented (3 concurrent individual) | Orchestrated | ✅ (concurrency cap ⏳) | P1 |
| QC: compliance, duration, flicker, black frames, unintended cuts | Quality Review | ffprobe + signalstats + scene detection | n/a | Post-processed | ✅ | P0 |
| QC: reference similarity / drift | First-frame SSIM, chroma distance | Heuristics only | n/a | Post-processed | ✅ heuristic / ⛔ identity verification | P2 |
| Version compare | Edit Studio side-by-side + SSIM | ffmpeg ssim | n/a | Post-processed | ✅ | P1 |
| NLE interchange | EDL, FCPXML 1.10, OTIO export of selected takes | Generated files referencing local media | n/a | Orchestrated | ✅ files / 🟡 import into Resolve not yet verified by eye | P1 |
| Seed reproducibility | Seed field kept in spec | Not sent: undocumented for 2.5 | UNKNOWN | Unsupported (until verified) | ⛔ | P3 |
| 4K / 60 fps output | — | — | 2.5 outputs ≤1080p, 24 fps | Unsupported | ⛔ | — |
