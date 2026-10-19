# Higgsfield skills, agent bridges and integrations: inventory and coverage

Date: 2026-10-18. Analyst: REA lead (Claude). Clean-room inventory. Sources: public pages only (logged out),
public GitHub/npm/PyPI/skills.sh metadata, read-only inspection of this machine. Nothing was installed, nothing was
logged into, no install script or slash command was run, no skill file was copied into this project, and no
generation was submitted. All descriptions are our own paraphrase. Labels: **VERIFIED** (seen directly at the cited
source), **INFERRED** (reasoned from evidence), **UNKNOWN**.

## 0. Sources

| ID | URL / location | What it is |
|---|---|---|
| P1 | https://higgsfield.ai/mcp | MCP landing page with the workflow-skill catalogue |
| P2 | https://higgsfield.ai/skills | Skills landing page ("35 skills", 7 shown) |
| P3 | https://higgsfield.ai/creator-hub/help-center/mcp-cli/how-do-i-access-higgsfield-via-cli | Help centre: CLI + Skills vs MCP |
| P4 | https://higgsfield.ai/creator-hub/help-center/integrations/how-do-i-connect-higgsfield-to-ai-agent | Help centre: connecting agents, capability table, MCP operations |
| P5 | https://higgsfield.ai/creator-hub/help-center/mcp-cli/external-integrations-higgsfield | Help centre: plugins + Blender Bridge |
| P6 | https://higgsfield.ai/blog/claude-higgsfield-mcp-creative-studio | Blog: Claude MCP connector |
| P7 | https://higgsfield.ai/mcp/katana | Katana workflow page |
| P8 | https://higgsfield.ai/mcp/bundles/production-skills | Production-skills bundle (11 app workflows) |
| P9 | https://higgsfield.ai/mcp/bundles/motion-bundle | Motion bundle (7 AE workflows) |
| P10 | https://higgsfield.ai/plugins/after-effects , /plugins/blender , /plugins/davinci | Plugin pages |
| P11 | https://higgsfield.ai/blog/higgsfield-genjutsu | Genjutsu blog (no agent route mentioned) |
| P12 | https://higgsfield.ai/supercomputer | Supercomputer in-web agent |
| P13 | https://higgsfield.ai/blog/MCP-For-Motion-Designers | Blog: MCP for motion designers |
| G1 | https://github.com/higgsfield-ai (API listing, 9 repos) | Official GitHub org |
| G2 | https://github.com/higgsfield-ai/skills (README, tree, `.claude-plugin/plugin.json` v0.13.0) | Official skills repo, MIT |
| G3 | https://github.com/higgsfield-ai/cli (README, MODELS.md) | Official CLI, MIT |
| G4 | https://github.com/higgsfield-ai/cursor-plugin | Cursor plugin, MIT |
| N1 | https://registry.npmjs.org (package metadata for every name below, fetched 2026-10-18) | npm |
| N2 | https://pypi.org/pypi/higgsfield-client/json | PyPI |
| K1 | https://skills.sh/api/search?q=higgsfield | skills.sh registry search |
| K2 | https://registry.modelcontextprotocol.io/v0/servers?search=higgsfield | Official MCP registry (no Higgsfield entry) |
| K3 | GitHub repository search "higgsfield skill" / "higgsfield mcp" | Community repos |
| L1 | Session MCP server `mcp__514eefc5-…` (`ae_get_skill`, `bl_get_skill`, `pr_get_skill` index calls only) | Connected Higgsfield plugin bridge |
| L2 | `C:\Program Files (x86)\Common Files\Adobe\CEP\extensions\ai.higgsfield.cep\` (manifest + file list + endpoint strings only) | Installed Higgsfield Adobe panel |
| L3 | `C:\Users\harry\Downloads\Higgsfield-mcp-skill.md`, `…\higgsfield-timed-prompts\higgsfield-timed-prompts\SKILL.md` | Harry's files |
| L4 | `C:\Users\harry\.claude\skills\` (names), `AI_FILM_STUDIO\.claude\skills\*\SKILL.md` (front matter), `docs/FEATURE_MATRIX.md` | Our side |
| R1 | `docs/research/higgsfield-feature-study.md` S5 | ComfyUI partner node exposing `genjutsu-v1.0` |

## 1. Inventory

Columns: Name · Where · What it does (paraphrase) · Product served · Install (described, not run) · Licence/terms ·
Account/credits · On this machine.

### 1A. Official agent connectors and bridges

| # | Name | Where | What it does | Serves | Install | Licence / terms | Account / credits | On machine |
|---|---|---|---|---|---|---|---|---|
| 1 | **Higgsfield MCP** (`https://mcp.higgsfield.ai/mcp`) | P1, P4, P6 | Hosted remote MCP for chat agents. Operations (P4): image/video generation on 30+ models, upscale, background removal, outpaint/reframe, Kling 3.0 Motion Control, Soul characters + Elements, voiceover / voice clone / voice change / dubbing, Personal Clipper, credit balance, history and uploads. Claude picks the model if the user doesn't. VERIFIED P4/P6. Tool identifiers are not published (UNKNOWN; a third-party blog lists 5 tool names, unverified). | Cinema Studio models, Soul, Seedance/Kling/Veo etc., audio; Katana runs on top of it (P7) | Claude: Settings → Connectors → custom connector URL, OAuth sign-in. Not in the official MCP registry (K2, VERIFIED absence). | Higgsfield Terms of Use; no open licence | **Active paid subscription required**; normal credit rates; no free/unlimited generations via MCP; no native credit cap (P4) | **No** (not in this session's tool list) — VERIFIED by tool list |
| 2 | **Higgsfield Bridge** (`https://bridge.higgsfield.ai/mcp`) | P5, P10 | Hosted MCP that relays agent calls to a locally installed Higgsfield panel/add-on, so the agent drives the open After Effects / Premiere / Blender project. VERIFIED P5/P10. | AE, Premiere, Blender (Photoshop/Illustrator/TouchDesigner/Resolve via production skills — INFERRED) | Custom connector "Higgsfield Bridge" + sign-in; host plugin must be installed | No open licence | Higgsfield account; generation uses plan credits | **Yes** — this session's server `mcp__514eefc5-…` exposes `ae_*`, `pr_*`, `bl_*`, `get_host_status`; its own instructions say "connected Higgsfield plugin" (L1). The CEP panel's bridge file references `bridge.higgsfield.ai/mcp` and a `wss://bridge.higgsfield.ai/plugin/ws` socket (L2). VERIFIED. |
| 3 | **Higgsfield Adobe panel (CEP)** `ai.higgsfield.cep` v1.0.57 | P10, L2 | Panel inside Premiere/AE with Reframe, Remove Background, Upscale, Draw-to-edit, Edit Video, generate video/image; also hosts the bridge endpoint (#2). | Premiere, AE | Windows: .msi or .zxp (page contradicts itself, P10) | No open licence; signed CEP bundle | Sign-in + credits | **Yes** — installed under Common Files\Adobe\CEP\extensions, hosts PPRO + AEFT; installer `Downloads\higgsfield-cep-1.0.57.msi`. VERIFIED (manifest). |
| 4 | **Higgsfield for Blender** add-on | P10, P5 | Floating viewport bar: scene builder (editable geometry), 3D model (Meshy 5), character animation, image, video (Seedance 2.5), camera, asset; bridge target. | Blender 5.1+ | Drag signed .zip onto Blender | No open licence | Credits; price shown before Generate | **Not found** in `%APPDATA%\Blender Foundation\Blender\5.2` (only blender_org / lab_blender_org `mcp`). INFERRED: `bl_*` tools will not reach a host until it is installed. UNKNOWN whether installed elsewhere. |
| 5 | **Higgsfield for DaVinci Resolve** | P10 | Panel with the same 7 tools + AI LUT creator; results land in the media pool. **No agent/MCP route stated.** | Resolve 19+ | Installer; Workspace → Workflow Integrations/Scripts (page contradicts itself) | No open licence | Credits (implied) | Not checked in Resolve; no agent route anyway |
| 6 | Photoshop (UXP), Figma/FigJam, Minecraft, Higgsfield Gaming | P5 | Generation panels / mods; Gaming via MCP + gaming skill | other | per app | — | credits | No |
| 7 | **ChatGPT plugin**, **Cursor plugin** (G4, MIT, `mcp.json` + `commands/higgs.md`), Telegram, OpenClaw/Hermes/NemoClaw | P1, P4, G4 | Same MCP/CLI exposed to other clients | all generation | marketplace installs | Cursor plugin MIT | account + credits | No |

### 1B. Official CLI, SDKs and coding-agent skills

| # | Name | Where | What it does | Serves | Install | Licence | Account / credits | On machine |
|---|---|---|---|---|---|---|---|---|
| 8 | **`@higgsfield/cli`** 1.2.2 (bins `higgsfield`, `higgs`) | G3, N1 | Terminal generation: auth, account/credits, model list, generate create/cost/wait, workflow, preset, voices, upload, soul-id, marketing-studio, product-photoshoot, game, website. Help centre recommends CLI+Skills for coding agents (Claude Code) and MCP for chat agents (P3). Model ids include `cinematic_studio_video_3_5`, `cinematic_studio_3_0`, `cinematic_studio_2_5`, Soul variants (G3 MODELS.md). | Cinema Studio models, Soul, Marketing Studio, generic | npm global, Homebrew, curl script, release binaries. npm package has a **postinstall** script that downloads/installs a binary (N1, VERIFIED `postinstall: node install.js`). | MIT; use under Higgsfield Developer Terms (P3) | Higgsfield account via browser login; same credits as web (P3) | No |
| 9 | **`higgsfield-ai/skills`** (Claude plugin `higgsfield` v0.13.0; also Codex/Cursor manifests) | G2, K1 | 8 SKILL.md folders on main: `higgsfield-generate`, `higgsfield-soul-id`, `higgsfield-product-photoshoot`, `higgsfield-brandkit`, `higgsfield-marketplace-cards`, `higgsfield-websites`, `higgsfield-video-explainer`, `higgsfield-youtube-thumbnail`. skills.sh also lists `higgsfield-game-generation` from this repo (K1) but it is absent from main today (VERIFIED tree) — INFERRED removed/renamed. The plugin manifest declares no commands, MCP servers or hooks (VERIFIED). All skills shell out to the CLI (#8). | generic generation, Soul, marketing | `npx skills add`, `gh skill install`, Claude `/plugin marketplace add` + install, or clone + `./setup` | MIT | Every skill needs CLI login + credits | No |
| 10 | `@higgsfield/cloud-cli` 0.1.2 (`hf-api`) | N1 | Generation CLI for agents using **API-key** auth (Higgsfield API / cloud.higgsfield.ai product, separate from subscription) | generic | npm (postinstall downloads binary) | MIT | API key + API billing | No |
| 11 | `@higgsfield/client` 0.2.6 (repo higgsfield-js), PyPI `higgsfield-client` 0.2.0 (Apache-2.0 repo) | G1, N1, N2 | Official Node/TS and Python SDKs for the Higgsfield API | generic | npm / pip | MIT (npm) / Apache-2.0 (repo) | API key | No |
| 12 | `@higgsfield/video-editor-mcp` 2.0.1 + `@higgsfield/higgsedit` 1.0.1 | N1 | Local stdio MCP that edits code-defined (TSX) video projects via the `higgsedit` CLI and serves an editor panel; deps include playwright-core and a darwin-arm64 render helper (INFERRED macOS-first). No public product page found (bounded search). | "Video Editor" (not Cinema Studio/Katana) | npm | "SEE LICENSE IN LICENSE" / none — **proprietary, UNKNOWN terms** | UNKNOWN | No |
| 13 | `app-templates` (shadcn registry: studio, preset, app-detail) | G1 | Next.js UI templates for Higgsfield apps; contains a model catalogue registry | UI | shadcn registry | **No licence listed** | — | No |
| 14 | Others in org: `homebrew-tap`, `omagotchi` (MIT), `higgsfield` (Apache-2.0 GPU training framework, unrelated) | G1 | — | not relevant | — | — | — | No |

### 1C. Local app-control MCP servers published by Higgsfield staff accounts (npm)

Publisher accounts `alensultanov_higgsfield_ai`, `arsu_higgsfield_ai` (N1). **INFERRED official** (staff-named accounts,
"higgsfield" keyword); no Higgsfield page links them (UNKNOWN). Each is "local MCP server + offline creative skills";
INFERRED to be the same skill families the Bridge serves (#2) but runnable locally.

| # | Package | Host | Licence | Notes |
|---|---|---|---|---|
| 15 | `fnf-after-effects-mcp` 0.1.6 (2026-10-17) | After Effects (ExtendScript) | "SEE LICENSE IN UPSTREAM.md" (UNKNOWN terms) | build checks a skills manifest → INFERRED ships the `ae-*` skills |
| 16 | `fnf-blender-mcp` 0.2.2 | Blender (bpy) | MIT | background process + offline skills |
| 17 | `@higgsfield_org/premiere-mcp` 0.1.3 | Premiere (signed CEP bridge) | none stated | |
| 18 | `@higgsfield_org/davinci-resolve-mcp` 0.1.1 | **Resolve Studio colour** + "film-colorist" skill | MIT | INFERRED backs the `/color-grading` workflow (P8) |
| 19 | `@higgsfield_org/photoshop-mcp`, `/illustrator-mcp`, `/touch-designer-mcp` | PS / AI / TD | none / none / MIT | back `/image-fixer`, `/vectorize`, `/use-touchdesigner` (INFERRED) |

None is installed here (not checked beyond the session tool list; INFERRED absent).

### 1D. Skills exposed by the connected Bridge on this machine (L1, VERIFIED names via index calls)

- **AE (`ae_get_skill`)**: `ae-clean-rig` (entry/router; construction + motion-fidelity doctrine + 10 reference modules),
  `ae-animation-principles`, `ae-ui-mastery`, `ae-design-first` (HTML/Lottie one-call routes), `ae-depth-space`,
  `ae-liquid-glass`, `ae-transition-kit` (incl. .mogrt discipline), plus `ae-mcp-realities`, `ae-build-orchestration`
  (loadable, not routed). Note: the index text describes an "Adobe connector, server adobe_creativeapps" calling convention
  (INFERRED shared with another client surface).
- **Blender (`bl_get_skill`)**: `blender-scene` (entry), `blender-scene-spec` (Scene Passport), `blender-modeling`,
  `blender-lookdev`, `blender-lighting-camera`, `blender-animation`, `blender-generation`, `blender-hdri`, `blender-pbr`,
  `blender-greybox` (greybox → still/motion-reference render), `blender-audit-finalize`, `blender-volatile`.
- **Premiere (`pr_get_skill`)**: `premiere-api-realities`, `premiere-editing-reference`, `radio-edit-craft`
  (transcribe → phrase bank → best take → butt-join → snap to silence), `house-style` (short-form reels),
  `seedance-prompts` (Seedance 2.0 prompt contract: formula, word budget, banned words, pre-send checklist).
- Generating/spending tools also exist on this server (`bl_generate_*`, `bl_image_to_3d`, `pr_upload_media`, renders, etc.).
  Not called.

### 1E. Workflow "skills" on higgsfield.ai/mcp (prompt recipes run through #1/#2; VERIFIED names P1/P8/P9)

| Group | Names | Product |
|---|---|---|
| **Katana** | `/katana` "Recreate aura edits": reference video or Katana preset + subject photo/clip → remixed edit keeping pacing, camera, transitions, grade, graphics; reference soundtrack kept by default; revise by follow-up message (P7). No AE/Blender needed. | **Katana** |
| Production skills bundle (P8) | Blender: `/destruction-studio`, `/exploded-view`, `/scene-builder`, `/cartoon-shaders` · Premiere: `/project-sorter` · AE: `/shot-composer`, `/shot-cleanup` · Illustrator `/vectorize` · Photoshop `/image-fixer` · `/use-touchdesigner` · Resolve Studio `/color-grading`; setup helpers `/use-blender`, `/use-premiere`, `/use-after-effects`, `/use-illustrator`, `/use-photoshop` | host apps via Bridge |
| Motion bundle (P9) | `/use-after-effects`, `/illustration-animation`, `/paper-collage`, `/localization-motion`, `/saas-animation`, `/presentation-animation`, `/whiteboard-animation` | AE |
| Paid-ads bundle and others (P1) | Ad Recreator/Strategist/Localizer/Resizer, Campaign Analyst, Customer Voice Ads, Headline/Hook Multiplier, `/marketing-adapt-video`, UGC (product review, physical, unboxing, try-on), faceless explainers (editorial motion graphics, stickman, fairy tale, paper diorama, pastel 2D, hand drawn, mannequin), website building | marketing |
| Supercomputer skills (P3, P12) | In-web agent's own "/" functions (Ad Multiplier, Shorts Maker, Brandkit…); explicitly **not** the CLI skills | web only |

Account/credits for 1E: pages do not state; they run through #1/#2, so a paid plan + credits apply (INFERRED from P4).

### 1F. Products with **no** agent skill/bridge found (bounded search: P1–P13, G2/G3 trees, N1, K1)

- **Cinema Studio**: no dedicated skill or workflow. Reachable only as **models** (`cinematic_studio_*` ids via CLI; "Cinema
  Studio" named as a model behind MCP, P2/P6). Camera/lens/lighting UI controls are not exposed as agent parameters (UNKNOWN
  whether MCP accepts them). VERIFIED absence on listed sources.
- **Genjutsu**: no MCP/CLI/skill route (P11 web only; not in MODELS.md). Only API surface seen is the **ComfyUI partner
  node** model `genjutsu-v1.0` (R1), which needs a Comfy partner-credits account and uploads media to the cloud.
- **Popcorn**: none found.
- **Soul ID**: yes — `higgsfield-soul-id` skill (#9), CLI `soul-id`, MCP Soul characters.

### 1G. Community (not Higgsfield) — for awareness only

skills.sh/GitHub (K1, K3): `OSideMedia/higgsfield-ai-prompt-skill` (MIT; ~32 prompt sub-skills incl. `higgsfield-camera`,
`-cinema`, `-seedance`, `-acting`, `-facs`, `-moodboard`, `-pipeline`, `-recall`, `-troubleshoot`), `robonuggets/higgsfield-skill`
(NOASSERTION), `AKCodez/higgsfield-claude-skills`, `pixelab-ch/higgsfield-skills` (MIT), `machina-exm/film-studio-skills`,
`rishbjain1/studio-mcp` (MIT), unofficial MCP servers (`higgsfield-mcp` by Storyvord, `Hikhakk/higgsfield-mcp-unified`,
"Higgsfield Director MCP" on Glama, QalaLabs FastMCP), `higgsfield-api-skill` (npm). Unvetted; several need API keys.

### 1H. Harry's local Higgsfield-named files (L3)

- `Downloads\Higgsfield-mcp-skill.md`: despite the file name, it is a **MiniMax N3 motion-design prompt system** (15 s launch
  films: block architecture, five laws, 9:16 rules, segmentation). Its only Higgsfield link is offering "generate via
  Higgsfield" and Higgs*-style product names. VERIFIED (read). Not a Higgsfield integration. Origin (Harry-authored vs
  downloaded) UNKNOWN.
- `Downloads\higgsfield-timed-prompts\…\SKILL.md`: method for timecoded multi-shot Seedance 2.5 prompts: `@filename`
  handles, REFERENCES/LOOK/CHARACTERS/SOUND blocks, contiguity check (shot end = next start, last end = duration), dialogue
  vs SOUND list agreement, blocking diagrams/placement maps, reframe/outpaint prompts, exact-match edit discipline.
  VERIFIED (read). Not published by Higgsfield as far as found (INFERRED Harry's or a third party's). Not installed as a skill.

## 2. Coverage matrix

Ours = project skills (`.claude/skills/*`), app features (FEATURE_MATRIX), Harry's global skills. Rec: **(a)** build our own
clean-room equivalent · **(b)** use theirs as-is with Harry's account (needs his approval) · **(c)** not relevant to Harry.

| Higgsfield item | Our equivalent | Gap | Rec |
|---|---|---|---|
| **Katana `/katana`** (reference edit → recreated edit, soundtrack kept, revise by chat) | OG Katana (analyse + per-segment rebuild + revise), `reference-analyzer`, `motion-transfer-planner`, `video-edit-planner` | **Partial**: we have cut timing/keyframes but no music beat/onset alignment, no "keep reference soundtrack + conform to reference duration/fps" step, no preset/recipe catalogue | **(a)** add beat/onset analysis to reference-analyzer, a soundtrack-keep + conform step, and saved recipes ("presets") |
| **Genjutsu** (no agent route; ComfyUI node `genjutsu-v1.0`) | OG Genjutsu: motion transfer (Seedance ref video), object swap (edit), local MiniMax H3 character swap; `motion-transfer-planner` | **None** at the agent-integration level (Higgsfield has none). Quality parity UNKNOWN | **(c)** for skills; ComfyUI partner node would be **(b)** and sends footage to a cloud — conflicts with Harry's no-external-AI rule unless he approves per task |
| **Cinema Studio** (models only; no skill) | OG Cinema Studio + `shot-planner`, `camera-choreographer`, `cinematic-director`, `prompt-optimizer`, `seedance-orchestrator` | **None** for skills (ours is richer). **Missing**: access to Higgsfield's own `cinematic_studio_*` models | **(c)**; **(b)** only if Harry wants their model as a second provider |
| **Popcorn** (none) | Scene Builder storyboard | None | **(c)** |
| **Soul ID** skill / CLI / MCP | `character-continuity` (reference packs, @handles) | **Partial**: no trained identity (Seedance has no training API) | **(c)**; **(b)** only with Harry's approval and recorded consent of the person; identity is account-bound and not exportable |
| `higgsfield-generate` + Higgsfield MCP (#1) multi-model generation | `seedance-orchestrator` (Seedance 2.5, mock, local H3) | **Partial**: single cloud provider; no Kling/Veo etc. Ours has an approval gate; theirs has none (VERIFIED: skill submits without a confirmation step) | **(a)** keep provider-adapter route if more models are needed (official APIs); **(b)** possible but must keep our cost-approval gate |
| MCP extras: upscale, background removal, outpaint/reframe, Kling Motion Control, VO/clone/dub, Clipper | none in app (reframe exists only as Harry's timed-prompts §9) | **Missing** | **(a)** reframe/outpaint prompt + ffmpeg crop/pad and local upscale; **(c)** voice cloning/dubbing (Punjabi dialogue is Harry's own recording) |
| `seedance-prompts` (Bridge pr skill) | `prompt-optimizer`, compiler; Harry's `higgsfield-timed-prompts` | **Partial**: no word-budget/banned-term lint or pre-send checklist | **(a)** clean-room prompt lint in the compiler (do not copy their banned-word list or wording) |
| Harry's `higgsfield-timed-prompts` checks | `shot-planner` timed beats, `character-continuity` @handles | **Partial**: no automatic timecode-contiguity, dialogue-vs-SOUND, handle-exists checks; no blocking-map step | **(a)** implement checks in ShotSpec validation (Harry's file; confirm origin first) |
| `radio-edit-craft` (Premiere) | Harry's `resolve-edit` (HNMY); app: none | None for app (NLE work stays in Resolve) | **(c)** |
| `blender-greybox` → motion-reference render | `motion-transfer-planner` (uses clips), Harry's `blender-3d` | **Partial**: app has no "import a previz render as motion reference" path | **(a)** small import path: previz MP4 as reference_video |
| `blender-generation`, HDRI, PBR, `/scene-builder`, `/destruction-studio`, `/exploded-view`, `/cartoon-shaders` | Harry's `blender-3d` | none for app | **(c)** for the app; **(b)** already available via Bridge if Blender add-on installed (one writer per app) |
| AE skills (`ae-clean-rig` … `ae-transition-kit`), motion bundle, `/shot-composer`, `/shot-cleanup` | Harry's `ae-motion`, `fusion-comp` | none for app | **(c)** for app; **(b)** already in use (Bridge) |
| `/color-grading` (Resolve Studio) / `davinci-resolve-mcp` | Harry's `resolve-color`, `color-match` | none | **(c)**; do not add — violates one-writer-per-app with Resolve MCP |
| `/project-sorter` (Premiere), Photoshop/Illustrator/TouchDesigner | — | — | **(c)** |
| Marketing Studio, Virality Predictor, product-photoshoot, brandkit, marketplace-cards, websites, game-generation, YouTube thumbnail, explainer, ads/UGC/faceless bundles, Supercomputer | — | — | **(c)** (thumbnail is optional **(a)** later) |
| `@higgsfield/video-editor-mcp` / `higgsedit` | Remotion / HyperFrames skills already on machine; app NLE export | none | **(c)** |
| CLI, cloud-cli, SDKs, Cursor/ChatGPT plugins, app-templates | app's own provider layer and UI | none | **(c)**; app-templates must not be copied (no licence) |

## 3. Problems with copying or reusing

1. **Licences.** `skills`, `cli`, `cursor-plugin`, `@higgsfield/client`, `fnf-blender-mcp`, `davinci-resolve-mcp`,
   `touch-designer-mcp` are MIT (copying allowed with notice, but our policy is clean-room anyway). `fnf-after-effects-mcp`
   ("see UPSTREAM.md"), `video-editor-mcp` ("see LICENSE"), `higgsedit`, `premiere/photoshop/illustrator-mcp` and
   `app-templates` have no or proprietary licences — **do not copy**. Bridge-served skills (1D) and higgsfield.ai workflow
   prompts (1E) carry no licence — treat as proprietary; read for awareness only, never paste into our skills.
2. **Account-bound.** MCP, Bridge, CLI skills, Soul IDs, Katana presets and Assets all require a Higgsfield login; MCP
   requires an active paid plan; every generation spends credits; Soul identities cannot be exported. Our app must not
   depend on any of these.
3. **Proprietary prompts.** The Seedance prompt contract, house style, ae/blender doctrines and workflow prompts are
   Higgsfield's know-how. Build our own checks from first principles and official Seedance docs.
4. **Spend safety.** `higgsfield-generate` instructs submitting paid jobs directly with no approval step and defaults to the
   quality model; the Bridge server's Blender instructions say an explicit generation request authorises immediate submit.
   Both conflict with Harry's approval-first rule; if ever used, Harry's cost gate must sit in front.
5. **Agent-directed text recorded, not acted on.** P1/P8/P9 prompts tell the assistant to ask the user to install the
   Higgsfield plugin first; P1/P7 tell the reader to type `/katana`, `/marketing-adapt-video` and "@Higgsfield …" prompts;
   G2 offers `INSTALL_FOR_AGENTS.md` ("paste into your agent"); `higgsfield-generate` step 0 pipes a remote shell script to
   `sh` when the CLI is missing; npm `@higgsfield/cli`/`cloud-cli` run postinstall binary downloads. None executed.
6. **Footage privacy.** Any (b) route uploads media to Higgsfield (or Comfy partner nodes). HNMY footage/audio/scripts must
   not go there unless Harry asks in that task.

## 4. Open questions

1. Is the Higgsfield Blender add-on installed anywhere? (Not in the 5.2 config; `bl_*` may be unreachable.) `get_host_status`
   was not called (outside the brief's allowed calls).
2. Are the `fnf-*` / `@higgsfield_org/*` npm servers officially supported, and do they ship the same skills as the Bridge? UNKNOWN.
3. Exact Higgsfield MCP tool names/parameters (e.g. whether Cinema Studio camera/lens controls are exposed). UNKNOWN without login.
4. The "35 skills" count on P2 vs ~60 workflow names on P1 vs 8 repo skills — catalogue boundaries are unclear.
5. Origin of `Higgsfield-mcp-skill.md` and `higgsfield-timed-prompts` (Harry-authored or downloaded), which decides whether
   their methods can be built into the app directly.
