# Higgsfield feature study (clean-room, public sources only)

Date: 2026-10-18. Analyst: REA lead (Claude). Scope: public marketing pages, Higgsfield blog / help centre,
ComfyUI partner-node docs and third-party API gateway docs for Seedance 2.5. No login, no account, no credits,
no client code, no generation submitted. All wording below is our own paraphrase; no Higgsfield text, branding
or assets are copied. All fetched page content was treated as untrusted data (no instructions found in it were acted on).

Labels: **VERIFIED** = stated on a cited public page (that a page *states* it, not that the feature works as claimed).
**INFERRED** = our reasoning from the evidence. **UNKNOWN** = not found.

Classification key (for an independent build on Seedance 2.5):
- **API-native** — maps to a documented Seedance 2.5 request field.
- **Orchestrated** — needs our own app logic (prompt compiler, shot planner, LLM agent, asset store, multi-call pipeline).
- **Post-processed** — done on the output frames (grade, grain, upscale, conform).
- **Experimental** — plausible but no public evidence the model supports it reliably; needs testing.
- **Unsupported** — no route on Seedance 2.5 without another model or our own training.

---

## 0. Sources

| ID | URL | What it is |
|---|---|---|
| S1 | https://higgsfield.ai/blog/cinema-studio-4-0 | Higgsfield blog: Cinema Studio 4.0 launch/FAQ |
| S2 | https://higgsfield.ai/cinema-studio | Cinema Studio product page (titled 4.0) |
| S3 | https://higgsfield.ai/blog/higgsfield-genjutsu | Higgsfield blog: Genjutsu |
| S4 | https://higgsfield.ai/genjutsu | Genjutsu product page + FAQ |
| S5 | https://docs.comfy.org/tutorials/partner-nodes/higgsfield/genjutsu-motion-transfer | ComfyUI partner node (Higgsfield API surface) |
| S6 | https://higgsfield.ai/blog/higgsfield-katana | Higgsfield blog: Katana |
| S7 | https://higgsfield.ai/blog/claude-higgsfield-mcp-creative-studio | Higgsfield blog: MCP connector |
| S8 | https://higgsfield.ai/creator-hub/help-center/ai-models/which-ai-model-should-i-use | Help centre: model families |
| S9 | https://higgsfield.ai/creator-hub/help-center/ai-models/how-do-i-create-and-use-a-soul-id-character | Help centre: Soul ID |
| S10 | https://higgsfield.ai/storyboard-generator | Popcorn storyboard generator page |
| S11 | https://runware.ai/docs/models/bytedance-seedance-2-5 | Third-party gateway schema for Seedance 2.5 (not ByteDance official) |
| S12 | https://technode.com/2026/07/31/bytedance-launches-seedance-2-5-video-generation-model/ , https://www.miracamp.com/learn/content-creation/seedance-2-5-bytedance | Seedance 2.5 launch reporting |
| S13 | https://developer.civitai.com/orchestration/recipes/seedance | Third-party: notes 2.5 refuses real-face references (search-result summary only) |
| S14 | https://www.seedance.tv/blog/higgsfield-cinema-studio-camera-settings | Third-party: Cinema Studio 3.5 focal lengths |
| S15 | https://postium.ru/higgsfield-vypustila-cinema-studio-4-0/ , https://yespress.io/products/higgsfield.md | Third-party 4.0 coverage (conflicting numbers) |

**Model-routing facts (VERIFIED, S1/S7/S8):** Higgsfield names its own families (Soul image models, "Soul Cinema"
models, Cinema Studio native models, Higgsfield DOP, Popcorn) and routes to third-party families: Seedance (S1 and S7
name **Seedance 2.5** specifically), Kling, Wan, Sora (Sora 2 named for Popcorn export, S10), Veo, Minimax Hailuo,
Grok Imagine, plus image models Nano Banana, GPT Image, Seedream, Recraft, FLUX and audio models (Seed Audio, Eleven,
MiniMax Speech, etc.). S8 says Higgsfield auto-uses the latest version in a family and gives no version numbers.
S7 claims "30+ models" behind the MCP and that Claude picks one if the user doesn't. Genjutsu and Katana pages name
**no** underlying model (VERIFIED absence on S3/S4/S6); ComfyUI exposes Genjutsu as model id `genjutsu-v1.0` (S5).

**Seedance 2.5 itself (S11, S12 — third-party, not ByteDance official docs):** launched 31 Jul 2026, API via
Volcano Engine / BytePlus ModelArk from early Aug. Gateway schema S11: duration 4–30 s (or auto), 480p/720p/1080p,
first/last frame images (1–2; *mutually exclusive* with reference inputs), up to 30 reference images / 10 reference
videos / 10 reference audios addressed in the prompt as @Image1/@Video1/@Audio1, an `edit` and an `extend` operation on
a source video, synchronized audio on by default, 1–4 results, draft 480p preview → 1080p finalize. **No camera,
lens, lighting, emotion or seed-in parameter** is documented (seed only returned). Resolution claims conflict across
outlets (720p vs 1080p vs 4K). S13 reports real human faces in references are refused — **not confirmed** on S11.

---

## A. Cinema Studio (version 4.0 — VERIFIED as a name on S1, S2)

"4.0" is confirmed on Higgsfield's own pages (S1 title, S2 title). Release month: third-party says Aug 2026 (S15) — INFERRED.

| Control | What the user sees (paraphrase) | Evidence / label |
|---|---|---|
| Generation length | One generation up to 30 s (was 15 s in 3.5) | VERIFIED S1. S15 claims 1 min + native 4K — **conflict, unverified** |
| Resolution | Up to 1080p | VERIFIED S1 FAQ |
| References | Up to 50 images per generation to lock face/product/style | VERIFIED S1, S15. Matches Seedance 2.5's 50-asset ceiling → INFERRED Seedance 2.5 is the backbone |
| Camera body | Auto, Modern, DV camcorder, 35mm film, 8mm film | VERIFIED S1. Older 3.x reportedly had ARRI-style bodies (third-party, unverified) |
| Lens | Auto, clean/sharp, anamorphic, vintage anamorphic, warm vintage, halation vintage; page says film/lens looks are "modelled at generation time" vs post-filter in 3.5 | VERIFIED S1 (page is self-inconsistent: lists 6, says "five") |
| Focal length | **Not mentioned for 4.0.** 3.5 reportedly offered 8/14/35/50/75 mm | UNKNOWN for 4.0; 3.5 list from S14 (third-party) |
| Aperture | Auto, f/1.4, f/4, f/11 | VERIFIED S1 |
| Camera movement | "30+" presets; named examples include POV, robot arm, pan left, helicopter, tracking, pedestal down | VERIFIED count S1/S2; full list UNKNOWN |
| Lighting console | Presets (silhouette, practicals, window, overhead fall, contre-jour, soft cross) + manual colour, brightness, diffusion, angle; S15 calls it a 2-source console | VERIFIED S1; "2 sources" from S15 only |
| Colour | 50+ named palette templates (generation-time) **and** a post-generation grade panel (temperature, contrast, saturation, sharpness, grain, highlights, exposure) | VERIFIED S1 (page also says 30+ in one place) |
| Acting / emotion | Emotion per character via @-mention; 8 emotions on S1; S15 says 6 emotions × 3 intensities | VERIFIED S1; count **conflicts** |
| Genre | 7: general, action, epic, drama, comedy, horror, noir — said to change lighting, blocking, motion, pacing | VERIFIED S1 |
| Era | Auto, 60s, 80s, 90s, 2000s, 2020s — grain/grade/lens style | VERIFIED S1 |
| Tempo / montage pacing | Auto, chaotic, dynamic, calm, single-shot — governs cut frequency inside a generation | VERIFIED S1 |
| Single vs multi-shot | A generation can contain several cuts; "single shot" tempo removes cuts | VERIFIED S1 |
| AI Cast | Reusable actors with consistent identity across scenes/angles/light | VERIFIED S1 (mechanism UNKNOWN) |
| Locations | Reusable generated locations matched to genre/camera | VERIFIED S1 |
| Video extend | Forward, backward, and (S15) "bridge" between clips | VERIFIED S1 fwd/back; bridge S15 only |
| Personal assistant | Chat that adjusts settings and breaks a script into shots with camera settings pre-filled | VERIFIED S1 |
| Storyboard | Not mentioned for 4.0; storyboarding lives in Popcorn (D) | UNKNOWN in CS4 |
| Continuity tool | No dedicated tool; consistency attributed to "Soul Cinema" models | VERIFIED absence S1 |
| Team | Multi-user projects, shared elements, canvas, project brief, subfolders | VERIFIED S1 |
| Scene editing | Each scene editable independently | VERIFIED S2 |

**How it most likely works (INFERRED):** Because Seedance 2.5 has no camera/lens/light/emotion fields (S11), almost
every Cinema Studio dropdown is most likely compiled into prompt language plus reference selection by Higgsfield's
orchestration layer, possibly with a fine-tuned in-house model ("Soul Cinema") for the look presets. The claim that
lenses moved from post-filter (3.5) to generation-time (4.0) supports "prompt/model conditioning" over "post". The
post-generation grade panel is plain post-processing. The 30 s / 50 refs numbers match Seedance 2.5 exactly, which
is the strongest public hint about the backbone; it is still INFERRED, not stated.

## B. Genjutsu (VERIFIED name, S3/S4/S5)

User flow (VERIFIED S3/S4): pick mode → upload one source clip → optionally add reference images → pick a preset or
type a short description → generate, compare with source, export. Launch ~1–3 Sep 2026 (third-party).

- **Motion Transfer:** keeps the source's body motion, camera move, timing (and audio, per S5); rebuilds cast,
  location, wardrobe, style from references. Anything not described is rebuilt from references (S5).
- **Object Swap:** replaces one selected element (product, prop, outfit, character, location) and keeps the rest.
  How the element is selected (mask, click, text) is **UNKNOWN** — pages describe it only as "selected/described".
- **Inputs:** source 4–30 s (S4/S5; one third-party says 3–30); reference images up to 30 on site (S3/S4), 1–8 in the
  ComfyUI node (S5); one third-party/FAQ snippet says 40 — **conflict**. Prompt optional; 30+ presets (S3; S4 doesn't
  mention presets). Output ≤1080p, length = source length (S5). Seed doesn't lock results (S5).
- **Underlying model:** not named. INFERRED candidates: Seedance 2.5 `edit` operation with reference images (its
  region-level replace keeps motion/camera/light per S12), or Kling's motion-transfer (S8 credits Kling with
  "motion transfer between videos"). Cannot be resolved from public data.

## C. Katana (VERIFIED name, S6; runs only through Claude + Higgsfield MCP)

- **Inputs (VERIFIED S6):** a reference video (upload or direct media URL; social profile links refused) **or** a
  library preset; up to 5 photos (characters/products/clothing); optional notes ("keep X", "hero product shot").
  Chat-pasted images are *not* used — an upload window on Higgsfield opens instead.
- **Reference analysis (VERIFIED as a claim):** reads shot order, per-shot durations, cut placement against the music,
  pacing and audio, then rebuilds that structure with the user's assets. Method UNKNOWN; INFERRED = shot-boundary
  detection + beat/onset analysis + a per-shot vision description fed to per-shot generations, then a server-side conform.
- **Outputs (VERIFIED S6):** MP4 matching the reference's duration, aspect ratio and frame rate (not configurable),
  preview widget in chat, copy in Assets.
- **Presets:** three categories — personalised edits, style transfer, motion transfer; official + community. Invoked
  by a `/katana` catalogue command or a named preset. Community presets need a 3–30 s motion video, ≤40 images, and an
  @-referencing prompt (VERIFIED S6).
- **Revisions (VERIFIED S6):** follow-up chat messages; each revision starts from the existing edit and, in Higgsfield's
  own test, only affected shots re-render. Cost shown before each generation; moderation may refuse.
- **Reuse:** all results go to Assets, shared with Genjutsu; a Genjutsu output can be a Katana reference (S6).
- **Models:** "Higgsfield models", none named (S6). MCP tool names not published on S6/S7 (UNKNOWN).

## D. Other relevant features

- **Soul ID (VERIFIED S9):** train one person from 20–80 photos (varied angles, recent, one full-body), minutes to train;
  used in Soul image models and carried into Seedance video as an "Element" via @-mention; one person per Soul ID;
  multi-character scenes use Elements; the identity is not exportable. INFERRED: a per-user fine-tune/adapter on their
  own image model, then video consistency via generated reference stills fed to Seedance (since Seedance takes images,
  not trained identities).
- **Elements / Assets (VERIFIED S8/S9):** any generated image can become an Element; @-mention in prompts; Assets keep
  history across model switches. This is an asset store + prompt token mapping (Orchestrated).
- **Popcorn storyboards (VERIFIED S10/S8):** up to 8 consistent frames per batch from a prompt per scene + optional style
  reference; last frame can seed the next batch; relight / style / clothes / face-swap edits; export to Sora 2 for video.
- **Video extend (VERIFIED S1):** forward/backward. Seedance 2.5 has `extend` (S11) — backward/bridge is UNKNOWN on the API.
- **Targeted edit / inpaint:** Higgsfield lists "Inpaint" in menus only; no public description (UNKNOWN). Seedance 2.5
  `edit` does region replacement by prompt (S11/S12).
- **Higgsfield DOP:** camera-move preset video model (S8). Upscale tool (S8). Draw-to-Video: arrows + text for motion,
  insert products/outfits (Higgsfield blog search result; detail not fetched — INFERRED).
- **MCP connector (VERIFIED S7):** mcp.higgsfield.ai, account sign-in, credits, cost preview before generating, history
  browsing, reuse of past outputs as references, multi-step "production skills". A third-party report says it also
  drives After Effects (not on S7 — unverified).

---

## Feature inventory

| Feature | User experience | Likely technical approach | Classification (independent build on Seedance 2.5) | Evidence URL | Confidence |
|---|---|---|---|---|---|
| 30 s single generation | One clip up to 30 s | Seedance `duration` 4–30 | API-native | S1, S11 | High |
| 50-image references | Lock face/product/style | Seedance reference arrays (30 img/10 vid/10 aud) | API-native (note: 30 images max on S11, 50 is all modalities) | S1, S11 | High |
| @-mention assets in prompt | Type @Name to place a character/element | Map @Name → @ImageN index in prompt | Orchestrated (thin) over API-native refs | S1, S9, S11 | High |
| Camera movement presets (30+) | Pick a named move | Preset → prompt phrase; optionally a reference *video* carrying the move | Orchestrated (prompt) / Experimental via ref video | S1, S11 | Medium |
| Camera body (DV, 35mm, 8mm…) | Pick a "camera" | Prompt style tokens + maybe style ref images; grain in post | Orchestrated + Post-processed | S1 | Medium |
| Lens character | Anamorphic, vintage, halation | Prompt tokens / style refs; halation/flares can be post | Orchestrated (+ Post) | S1 | Medium |
| Focal length (8–75 mm, 3.5) | Pick mm | Prompt framing words; no model field | Orchestrated (prompt), adherence Experimental | S14 | Low |
| Aperture f/1.4–f/11 | Depth of field | Prompt DOF language; post defocus possible | Orchestrated / Experimental | S1 | Medium |
| Lighting console (presets + angle/colour/intensity) | Set key light direction & mood | Compile to prompt; or relit reference still first (image model) then image→video | Orchestrated; numeric angle control Experimental | S1 | Medium |
| Colour palettes (50+) | Pick a look at generation | Prompt + style reference image | Orchestrated | S1 | Medium |
| Post grade panel | Temp/contrast/sat/grain/exposure sliders | Classic colour ops on frames (LUT/ffmpeg/OCIO) | Post-processed | S1 | High |
| Genre / Era | Pick genre & decade | Prompt template bundles (lighting+blocking+grain words) | Orchestrated | S1 | High |
| Tempo / montage pacing | Chaotic→calm→single shot | Prompt instructs number of cuts in one generation, or app splits into N shots | Orchestrated; in-clip multi-cut Experimental | S1 | Medium |
| Acting / emotion per character | @char + emotion (+ intensity) | Prompt performance directions bound to char token | Orchestrated (prompt) | S1, S15 | Medium |
| AI Cast / Soul ID | Reusable consistent actor | Identity reference pack (and Higgsfield trains a per-person model) | Orchestrated via refs; trained identity Unsupported on Seedance alone | S1, S9 | Medium |
| Reusable locations | Same set across scenes | Saved location reference images | Orchestrated | S1 | Medium |
| Script → shot list assistant | Paste script, get shots with camera settings | LLM planner writing structured shot specs | Orchestrated | S1 | High |
| Video extend fwd | Continue a clip | Seedance `operation: extend` | API-native | S1, S11 | High |
| Video extend backward / bridge | Lead-in, or join two clips | Reverse-extend trick or first/last-frame (Wan-style); not in S11 schema | Experimental | S1, S15, S11 | Low |
| Draft → final | Cheap preview, then hi-res | Seedance draft 480p → draftId → 1080p | API-native | S11 | High (gateway doc) |
| Genjutsu Motion Transfer | Keep motion/camera/timing, new cast/look | Seedance ref-video + ref images (or `edit`); or a dedicated model (Kling-type) | Experimental on Seedance; Orchestrated wrapper | S3, S5, S8, S11 | Medium |
| Genjutsu Object Swap | Change one element only | Seedance `edit` with prompt + ref image of new object | API-native (edit) + Experimental fidelity | S3, S4, S12 | Medium |
| Katana reference analysis | Rebuild a ref edit's structure | Shot detection + beat detection + LLM shot descriptions | Orchestrated | S6 | Medium |
| Katana per-shot regen on revision | Change one shot by chat | Store shot graph; re-run only dirty shots; re-conform | Orchestrated | S6 | Medium |
| Katana output conform | Same duration/AR/fps as reference | Trim/retime/concat + original or new audio | Post-processed | S6 | High |
| Presets (Katana/Genjutsu/community) | One-click recipes | Saved JSON recipe: refs + prompt template + params | Orchestrated | S3, S6 | High |
| Popcorn storyboard (8 frames) | Consistent storyboard panels | Image model with multi-image consistency; chain last frame | Orchestrated (needs an image model, not Seedance) | S10 | Medium |
| Storyboard → video | Panels become shots | Panel as first frame (image→video) per shot | API-native (`frameImages`) | S10, S11 | High |
| Targeted inpaint (masked) | Paint a region to change | Seedance `edit` is prompt-addressed, mask input not documented | Unsupported as mask; Experimental as prompt-edit | S11 | Low |
| Synchronized audio | Sound with picture | Seedance `settings.audio` | API-native | S11, S12 | High |
| Asset library / lineage | All outputs saved, reusable | Our DB + storage + provenance | Orchestrated | S6, S7, S8 | High |
| Cost preview before generate | See credits first | Price table × params | Orchestrated | S6, S7 | High |
| Team co-direction | Multi-user projects | Collaboration backend | Orchestrated | S1 | High |

---

## Implications for Harry's build (INFERRED, design notes — not Higgsfield facts)

1. The "director's console" is mostly a **prompt compiler + reference manager**. Build it as a typed shot spec →
   prompt + @refs. Measure adherence per control before promising it in the UI.
2. Seedance 2.5 forbids combining first/last-frame with references (S11). Storyboard-locked shots and identity-locked
   shots are different request modes — the planner must choose per shot.
3. The real-face reference refusal reported for Seedance 2.x (S13) would block a live-action-actor workflow
   (HNMY-style). Must be tested on the official ModelArk API before design depends on it.
4. Grade/grain/halation should be post (Resolve/ffmpeg) where Harry already has better tools than any prompt.

## Open questions

1. Official ByteDance/BytePlus ModelArk schema for Seedance 2.5: is there any camera/seed-in/mask field the gateways omit?
2. Does Seedance 2.5 refuse real human faces in reference images (S13) on the official API? Any whitelist/consent route?
3. Is Cinema Studio 4.0 actually generating on Seedance 2.5 or on in-house "Soul Cinema" models? (Not stated.)
4. Which model powers Genjutsu (`genjutsu-v1.0`) — own model, Seedance edit, or Kling motion transfer?
5. Genjutsu reference limit: 8 (ComfyUI) vs 30 (site) vs 40 (snippet); min source length 3 vs 4 s.
6. Acting console: 8 emotions (S1) vs 6 × 3 intensities (S15) — which is current?
7. Max length 30 s (S1) vs 1 min + 4K (S15); "bridge" extend exists? (S15 only.)
8. Focal-length control in 4.0 — dropped, renamed, or simply not on the blog?
9. How Object Swap selects the target (text only, click, mask)?
10. How Katana detects shots/beats and whether it re-uses the reference's audio track in the output.
11. Whether Soul ID is a fine-tune (LoRA-like) and how it reaches video models (generated stills vs. native identity input).
12. Full list of the "30+" camera moves and "50+" palettes — only examples are public.
