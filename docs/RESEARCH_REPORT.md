# Research report (summary)

Full evidence with source URLs and VERIFIED / INFERRED / UNKNOWN labels:
- `research/higgsfield-feature-study.md` — Higgsfield Cinema Studio 4.0, Genjutsu, Katana, Popcorn, Soul ID (public pages only; no login, no generations, no client code).
- `research/seedance-2.5-api.md` — BytePlus ModelArk Seedance 2.5 API (official docs, read 2026-10-18).

## Key findings that shaped the build
1. **Cinema Studio 4.0** controls (camera bodies, lenses, aperture f/1.4–f/11, 30+ moves, lighting console, 50+ palettes,
   genre/era/tempo, acting emotions, AI Cast, 30 s, ≤ 1080p, ≤ 50 references) are platform orchestration over the model —
   VERIFIED as features on higgsfield.ai; the limits match Seedance 2.5, so Seedance 2.5 as backbone is INFERRED.
2. **Seedance 2.5 has no camera, lens, light, emotion, mask or (documented) seed parameter.** Every cinematic control in
   any app built on it is prompt-level. Our compiler therefore reports each control honestly.
3. Seedance 2.5 **documented** capabilities: text/image/first+last-frame/multimodal reference (≤ 30 img, 10 video, 10
   audio; ≤ 30 s total each for video and audio), edit and extend tasks, audio generation (mono), draft mode, 4–30 s,
   480p/720p/1080p, 24 fps, `@Image1` reference tokens; first-frame and reference modes are mutually exclusive.
4. **Real faces** in reference media are refused unless authorised via BytePlus (`asset://`) or recent trusted outputs.
   This directly limits live-actor workflows (relevant to HNMY footage) — plan around digital characters or authorised assets.
5. **Pricing** is per output token: 720p 5 s ≈ $1.16, 1080p 5 s ≈ $2.84; activation needs ≥ $30 on the account; only
   successful videos are billed.
6. **Genjutsu** (motion transfer, object swap) and **Katana** (reference-edit rebuild, chat revisions, render reuse) are
   reproducible as orchestration on documented edit/reference tasks — fidelity unknown until tested; masked inpainting
   has no API path (compositing route instead).
7. **Punjabi** is not a documented Seedance 2.5 prompt/dialogue language.

## Open questions (need live tests or vendor answers)
Seed support on 2.5 · minimum token charge with video input · `expired` status in Retrieve · Base64 for video ·
real-person asset onboarding steps · Higgsfield backbone per feature · motion-transfer fidelity on 2.5.
