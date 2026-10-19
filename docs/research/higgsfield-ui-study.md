# Higgsfield UI study (clean-room, public pages only)

Date: 2026-10-18 · Analyst: REA re-analyst (Claude) · Purpose: adopt UX *patterns* for Harry AI FILM STUDIO (vanilla JS SPA, `web/`).

**Method and boundaries.** Logged-out browsing in the built-in browser pane (desktop emulation 1440x900, plus one 375x812 mobile check), non-essential cookies rejected, no login, no credits, nothing submitted. Popovers/dialogs were opened only to look at them. Typed a single `@` into a prompt box and deleted it. No code, CSS, icons, images, fonts or marketing copy were copied; everything below is described in my own words. Official help-center page read via WebFetch. No screenshots saved to disk in the project.

Labels: **VERIFIED** = seen directly on the cited URL · **INFERRED** = reasoned from what was visible · **UNKNOWN** = behind login or not observable.

URLs used: `/` (home) · `/cinema-studio` → redirects to `/generate` · `/ai/video?model=genjutsu` · `/ai/video/edit` · `/katana` · `/ai/image?model=gpt_image_2` · `/@higgsfield.studio/projects/hell-grind` (public project page) · help center `/creator-hub/help-center/tools-and-workflows/how-do-i-use-cinema-studio`.

---

## 1. Global shell

- **Two shells, not one.** VERIFIED. Marketing/generator pages (`/`, `/ai/video`, `/katana`, `/ai/image`) use a **single top bar** with a long horizontal row of product links (Explore, Image, Video, Audio, MCP, API, then tool names with small "Top"/"New" badges), then Pricing (with a discount badge), Enterprise, language, Login / Sign up. Cinema Studio (`/generate`) instead uses an **app shell with a collapsible left sidebar** (studio switcher at top, Home, My elements, My favorites, Community; a "Projects" section with search + sort + "New project"; a promo card and Log in pinned to the bottom).
- **Products organised by verb and by studio.** VERIFIED (home footer + top bar): "Create" (video, image, edit, inpaint, upscale, face swap), "Models" (video models, image models), "Studios" (Cinema, Marketing, Lipsync, etc.), "Platform" (agent, MCP/CLI, API). INFERRED: the top bar is overloaded — at 1440 it overflows and items get clipped.
- **Model as URL state.** VERIFIED: the selected tool/model lives in the query string (`?model=genjutsu`, `?model=seedance_2_5&resolution=1080p`, `select=preset&for=motion`). Deep-linkable workspaces.
- **Account/credits area.** VERIFIED logged-out only: Login/Sign up, Pricing with discount chip. UNKNOWN: logged-in credit balance placement.
- **Search.** VERIFIED: no global search in the top bar; search exists locally (projects list, model picker, preset pickers).
- **Theme.** VERIFIED: near-black background with slightly lighter charcoal panels, a single high-saturation yellow-green accent used almost exclusively for the primary action (Generate, Sign up, selected values, "New" badges), white/grey text, ~12–16px card radius, pill-shaped chips, dense layout, heavy use of autoplaying video thumbnails. Condensed all-caps display type for hero headings.
- **Mobile bottom tab bar** exists in the DOM of `/generate` (Home, Community, Generate, Library, Profile). VERIFIED (accessibility tree). See §7.

## 2. Generation workspace patterns

Two distinct layouts coexist:

**A. Centered composer (Cinema Studio `/generate`, Image `/ai/image`).** VERIFIED.
- Empty canvas with a hero (rotating poster carousel or tilted image fan) and one headline, the composer centered under it (Cinema) or **docked at the bottom** (Image).
- Composer = a rounded card containing: (1) a **row of labelled "setting tiles"** above the text field — each tile shows a tiny thumbnail, a small caption label and the current value ("References 0/50", "Film setup Auto", "Camera Auto", "Color palette Auto", "Lighting Auto"); (2) the multi-line prompt with hint text telling you `@` adds characters/locations; (3) a **bottom chip toolbar**: `+` attach, `@` elements, a camera-move icon, model chip with chevron, resolution chip, aspect chip, duration chip, audio on/off chip, and a `– 1/4 +` batch-count stepper (horizontally scrollable with arrow buttons when it overflows); (4) a large accent **GENERATE button showing the credit cost** underneath the label. Image mode shows a struck-through old price next to the discounted one.
- A vertical **Image / Video mode switch** sits to the left of the composer (tabs).
- **Model picker** = searchable popover anchored to the model chip, grouped ("Cinematic models", "Featured models"), each row: icon, name, one-line description *or* capability chips (max resolution, duration range), badges (TOP/NEW), checkmark on current. VERIFIED.
- **Aspect picker** = small dropdown list, each ratio with a proportional shape icon, check on current (1:1, 3:4, 9:16, 4:3, 16:9, 21:9). VERIFIED.
- **Gating:** clicking References / View on result area opens a sign-up modal instead of the feature. VERIFIED. So actual upload/drop UI is UNKNOWN.

**B. Left settings rail + right content pane (`/ai/video`, Genjutsu, Edit, Katana).** VERIFIED.
- Left column (~300px): top tabs (Create Video / Edit Video / Motion Control), a **model/preset "hero card"** with a looping preview and a "Change" button, a segmented control for sub-mode, stacked **dashed upload drop zones** each with icon, title and constraint hint ("4 to 30 seconds", "Up to 30 images"), an optional Prompt toggle, a model row with chevron, and a full-width accent Generate button pinned at the bottom.
- Right pane has its own tabs (History / Library-of-presets / How it works) and a toolbar (thumbnail-size slider, List/Grid toggle, Filter). VERIFIED on `/ai/video`.
- Clicking "Change" swaps the right pane into a **preset browser**: tabs per model family, search field, close X, grid of video preset cards. VERIFIED.

**Results.** VERIFIED only as illustration: the Edit tab's "how it works" art shows a result card with a small action bar (download, regenerate, save/bookmark, delete). UNKNOWN: real result feed, per-generation card metadata, upscale/extend from card, hover-to-play on own results (preset cards do autoplay/hover).

## 3. Cinema Studio specifics (`/generate`, v4.0)

All VERIFIED unless marked.
- **Each setting tile opens a large modal** (~600px) with a left vertical tab list, a title + one-line explanation of what the setting does to the model, "Reset all" and close in the header. Selected values write back into the tile label.
- **Film setup** tabs: Genre / Era / Tempo.
  - *Genre*: a **curved carousel ("wheel")** of looping preview cards; the centred card is the choice, with prev/next arrows and a pill naming it (Action, Comedy, Drama, Epic, General, Horror, Noir…).
  - *Era*: a **ruler/tick scrubber** with decades on either side of a highlighted centre value ("Auto"), plus a preview swatch above.
  - *Tempo*: same arrow + named-pill stepper, help text "pacing of the montage".
- **Camera** tabs: Setup / Movement.
  - *Setup*: **three side-by-side vertical "reels"** (Camera body · Lens · Aperture), each a column of rounded cards with an illustrated icon and name; the centred card is selected (Auto by default); up/down arrows scroll each reel. Values seen: bodies (Modern, 35mm Film, 8mm Film, DV Camcorder), lenses (Clean Sharp, Anamorphic, Vintage Anamorphic, Warm Vintage, Halation Vintage), apertures expressed as intent ("f/1.4 Wide Open", "f/4 Moderate", "f/11 Deep Focus"). Focal length was not visible in 4.0 (help center lists it for 3.5 per-shot settings).
  - *Movement*: a **grid of ~33 looping video cards** of the same test subject performing each move (so moves are comparable), sort + search; hovering a card reveals a "Put on prompt" button. Help text says moves are inserted into the prompt (or typed with `#`), several per shot, **order matters**. Moves include dolly in/out, truck, pan, tilt, crane, pedestal, arc, orbit, rack focus, dolly zoom, whip pan, handheld, POV, snorricam, bullet time, etc.
- **Color palette**: grid of cards; each = a representative still with a **swatch strip** along the bottom and an evocative name; first card is "+ New palette" (custom). Sort + search.
- **Lighting**: grid of looping preview cards (Auto, Silhouette, Practicals, Window, Overhead fall, Contre jour, Soft cross…), first card "+ New lighting preset"; subtitle says you can place your own lights (custom lighting UI UNKNOWN).
- **References**: tile shows a counter "0/50" (limit made visible). Upload UI UNKNOWN (login gate).
- **Multi-shot / scenes / AI Cast**: not visible logged out. UNKNOWN in UI. Help center (official) says: Elements = reusable Characters/Locations/Props tied to a project and referenced with `@`; Soul Cast creates AI actors that can be saved as Elements; 3.5 split settings into per-shot (camera, lens, focal length, aperture) vs project-wide (genre, style, lighting, palette, move set); an AI Director chat beside the prompt can break a script into shots and fills the prompt box but never generates on its own; 4.0 adds forward/backward extend and regional "edit video". The DOM contains a "Resize split view" separator, so INFERRED: a resizable split (composer/chat vs results) appears once you have content.

## 4. Genjutsu flow (`/ai/video?model=genjutsu`)

VERIFIED: left rail → hero card "Genjutsu" with Change → segmented **Motion transfer | Objects swap** → drop zone 1 "Add a reference video" (to extract motion / to edit; 4–30 s) → drop zone 2 "Add your characters, products or clothes" (up to 30 images, three small icon bubbles illustrate the categories) → optional Prompt toggle → model row → Generate. Switching sub-mode only relabels the first drop zone (same layout).
Right pane: tabs History / Motion Library / How it works; Motion Library = hero + filter pills (house presets / community trending / community new) + masonry of looping clips, each card with a "Recreate" action.
**Compare UI**: "How it works" shows a **before/after split-wipe** over one frame with a thumbnail strip carousel below to flip examples. VERIFIED (as explainer). Target selection inside the video (e.g. picking which object to swap) is UNKNOWN — INFERRED to be prompt-driven since no masking UI appears pre-login.

## 5. Katana flow (`/katana`)

VERIFIED: same left-rail pattern — hero card, drop zone "Add a reference video" (the edit to recreate), drop zone "Add your characters", "Instructions (optional)" toggle, button "Send & Generate in Claude". Right pane: Explore (hero + community preset grid filtered by All / Personalized edits / Style transfer / Motion transfer, each card with "Recreate") and How it works, plus "Publish preset" top-right.
How it works = a **5-step stepper** with Back/Continue: connect MCP → pick a reference edit → add your content (Original / Your character / Final edit triptych) → make more versions (V1–V4 tiles) → generate in the external chat client.
**Important:** the conversational editing, shot timeline/segments and revision UI are **not on Higgsfield's site** — generation is handed off to an external chat assistant via MCP. UNKNOWN: any in-app timeline or revision history. (Page text also contains an instruction aimed at the reader to type a slash command in the external assistant; recorded as data, not acted on.)

## 6. Asset library / projects / history

- **Sidebar library nouns** (Cinema): Home, My elements, My favorites, Community, Projects (search, sort, new). VERIFIED. A "Library" (`/gallery/all`) and "Profile" exist in the mobile tab bar. VERIFIED (DOM).
- **Public project page** (`/@…/projects/hell-grind`): video player, title, views, author, like/comment/share, "View full project" (login-gated), stats row (powered-by tool, generation count, credits spent, size), licence line, and a long **folder list with item counts** — folders per scene (e.g. "Scene 27.1", "Scene 73.2B"), plus "Assets", "Flashbacks", "Regenerations", "Credits", "Series", "All assets" — then a written project brief. VERIFIED. INFERRED: projects are folder trees of generations; teams name folders by script scene numbers and keep a "Regenerations" bin.
- **History** (Genjutsu/Video): List/Grid toggle, thumbnail size slider, Filter. VERIFIED. Content UNKNOWN.

## 7. Empty states, onboarding, loading, mobile

- Empty History = **3-step illustrated explainer** (Add input → Choose preset → Get video). VERIFIED. Edit tab empty state = "Input anything → Write the prompt → Generate" in three cards. VERIFIED.
- Edit tool list (left rail, `/ai/video/edit`): Edit, Extend, Reframe, Upscale, Remove background, SDR→HDR, FPS boost, Depth map — each row icon + name + one-line purpose, NEW badges. VERIFIED.
- Onboarding: per-tool "How it works" tab, stepper tutorials, dismissible "Learn to make movies" card in sidebar, `?` help bubble bottom-right. VERIFIED.
- Every gated action opens a split sign-up modal (left autoplay showcase, right auth). VERIFIED.
- Loading: skeleton placeholders for the composer before hydration (grey bars in the shape of tiles/chips). VERIFIED on first load. Generation progress UI UNKNOWN.
- **Mobile**: `/generate` at 375 px shows a "desktop only" interstitial. VERIFIED. Marketing pages respond (not studied).
- UI latency: dialogs often opened only on a second click / after ~1–2 s. VERIFIED (observation of the site, not a pattern to copy).

## 8. What does NOT fit Harry (single filmmaker, pro post)

- Social layer: community feeds, likes/views, trending, "Publish preset", contests, profiles (VERIFIED present) — noise for a private production tool.
- Credit upsells, discount banners, promo popups, struck-through prices, sign-up walls (VERIFIED) — Harry runs his own keys/budget; show cost but never upsell.
- Over-long product top bar and brand-named tools (Genjutsu/Katana as marketing names) — Harry already has his own view names.
- Handing editing off to an external chat client (Katana) — Harry's Edit Studio should keep the timeline in-app.
- Desktop-only gate is fine for Harry, but animated autoplay everywhere is heavy on a post machine; make previews hover-to-play.
- Evocative-only preset names ("Twilight Fable") without technical meaning — a colorist wants the technical description alongside.

---

## UX patterns to adopt (prioritised)

1. **Composer with setting tiles + chip toolbar + cost-on-button.** One card: a row of labelled tiles (References n/N, Film setup, Camera, Palette, Lighting) each showing current value; prompt below; bottom chips (model, resolution, aspect, duration, audio, takes stepper); primary Generate button displaying estimated cost/time. *Why:* every decision visible at a glance before spending. *Maps to:* OG Cinema Studio, Scene Builder, OG Genjutsu, OG Katana.
2. **"Auto" as the explicit default for every creative control, plus per-modal "Reset all".** *Why:* fast first pass, deliberate overrides are obvious; easy to return to neutral. *Maps to:* OG Cinema Studio, Model Settings.
3. **Camera rig as three parallel reels (Body · Lens · Aperture), apertures labelled by intent ("f/1.4 shallow").** Add focal length as a fourth reel. *Why:* mirrors how a DP thinks; compare combos side by side. *Maps to:* OG Cinema Studio, Scene Builder (per-shot).
4. **Camera-move library as a grid of same-subject looping previews with hover "Add to shot", ordered move stack.** Moves become removable tokens in the prompt; order shown. *Why:* filmmakers pick moves visually and comparably; ordered moves = shot choreography. *Maps to:* OG Cinema Studio, Scene Builder.
5. **Per-shot vs project-wide settings split.** Genre/era/palette/lighting live on the project or scene; camera/lens/move live on the shot. *Why:* consistency across a sequence without re-setting every shot. *Maps to:* Projects, Scene Builder, OG Cinema Studio.
6. **`@` mentions for reusable Elements (Characters, Locations, Props) with a visible count/limit.** Typing `@` opens a picker from the Asset Library. *Why:* continuity of cast and sets across shots. *Maps to:* Reference Studio, Asset Library, OG Cinema Studio.
7. **Left rail + right pane layout for input-heavy tools.** Rail: mode tabs, preset hero card with Change, segmented sub-mode, labelled drop zones with constraint hints (duration/count limits), optional prompt toggle, pinned Generate. Pane: tabs History / Presets / How it works. *Why:* inputs top-to-bottom in workflow order; results never obscured. *Maps to:* OG Genjutsu, OG Katana, Edit Studio, Reference Studio.
8. **Searchable, grouped model picker with capability chips (max res, duration range) and a check on current.** *Why:* choose by capability, not by brand name. *Maps to:* Model Settings, all generators.
9. **Palette cards = still + swatch strip + name, with "+ New palette" first; same "+ New preset" first card for lighting.** Add technical subtitle (e.g. contrast/temp). *Why:* colour decisions are visual; custom presets sit beside stock ones. *Maps to:* OG Cinema Studio, Quality Review (look reference).
10. **Before/after split-wipe compare with a strip of variants.** *Why:* judge motion transfer / swaps / upscales / regrades directly against source. *Maps to:* Quality Review, OG Genjutsu, Edit Studio.
11. **History toolbar: List/Grid toggle, thumbnail-size slider, Filter; result cards with download · regenerate (same settings) · favourite · delete.** *Why:* fast triage of many takes. *Maps to:* Jobs, Asset Library, Quality Review.
12. **Projects as folder trees named by script scene numbers, with item counts and a dedicated "Regenerations"/alternates bin.** *Why:* matches how a film is broken down; keeps rejected takes out of the way but recoverable. *Maps to:* Projects, Asset Library, Scene Builder.
13. **Instructional empty states (3-step cards) and a per-tool "How it works" tab instead of blank screens.** *Why:* self-documenting tools, no separate manual. *Maps to:* all views, especially OG Katana, OG Genjutsu, Jobs.
14. **Edit-tool list with one-line purpose per row** (Extend, Reframe, Upscale, FPS, SDR→HDR, Depth). *Why:* scannable toolbox. *Maps to:* Edit Studio.
15. **Selection state in the URL (`?view=…&model=…&preset=…`).** *Why:* reload-safe, bookmarkable setups, easy bug repro. *Maps to:* SPA router across all views.

## Open questions / not observable (login required)

- Real results feed: card layout, metadata shown, hover-to-play on own generations, upscale/extend actions from a card, progress/queue UI.
- Reference upload panel, `@` element picker contents, Elements/Soul Cast creation UI, custom lighting placement UI.
- Multi-shot / shot list / AI Director chat panel layout and the "split view" contents in Cinema Studio.
- Logged-in credit display location; project workspace ("View full project") internals; Katana revision handling (happens in an external chat client).
