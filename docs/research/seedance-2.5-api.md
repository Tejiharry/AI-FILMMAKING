# Dreamina Seedance 2.5 — BytePlus ModelArk video-generation API (research)

Researched 2026-10-18 from the public BytePlus docs (rendered in a browser, with no sign-in). The docs pages showed "Last updated: October 17, 2026".
Labels: **VERIFIED** = read on the cited official page · **INFERRED** = deduced from verified facts, not stated outright · **UNKNOWN** = not found in the docs.

## Sources
- [S1] Create task API — https://docs.byteplus.com/en/docs/modelark/create-video-generation-task-api
- [S2] Retrieve task API — https://docs.byteplus.com/en/docs/modelark/get-video-generation-task-api
- [S3] List tasks API — https://docs.byteplus.com/en/docs/modelark/list-video-generation-tasks-api
- [S4] Cancel/delete task API — https://docs.byteplus.com/en/docs/modelark/cancel-or-delete-video-generation-tasks-api
- [S5] Seedance 2.5 tutorial — https://docs.byteplus.com/en/docs/modelark/seedance-2-5
- [S6] Base URL and authentication — https://docs.byteplus.com/en/docs/modelark/base-url-and-authentication
- [S7] Model list — https://docs.byteplus.com/en/docs/modelark/model-list
- [S8] Model pricing — https://docs.byteplus.com/en/docs/ModelArk/model-pricing
- [S9] Activation/usage/refund — https://docs.byteplus.com/en/docs/modelark/seedance-model-activation-usage-and-refund
- [S10] Portrait asset guide — https://docs.byteplus.com/en/docs/modelark/seedance-portrait-asset-guide
- [S11] Error codes — https://docs.byteplus.com/en/docs/modelark/error-codes
- [S12] Product page — https://seed.bytedance.com/en/seedance2_5 (marketing only; no API details)

## 1. Base URL, regions, auth
| Fact | Label | Src |
|---|---|---|
| Data-plane base URL: `https://ark.ap-southeast.bytepluses.com/api/v3` | VERIFIED | S6, S7 |
| Model list: "all the models listed in Model list are supported in the ap-southeast-1 region". The eu-west-1 region (`https://ark.eu-west.bytepluses.com/api/v3`) covers only seed-2-0 and seedream-5-0-lite, **not Seedance**. | VERIFIED | S7 |
| The video APIs "support only API Key authentication". Header: `Authorization: Bearer $ARK_API_KEY`, plus `Content-Type: application/json` | VERIFIED | S1, S2, S6 |
| With Access-Key (AK/SK) auth, `model` must be an endpoint ID. This is the generic data-plane rule; the video pages say API key only. | VERIFIED (S6) | S6 |
| `model` may be a model ID or an inference **endpoint ID** | VERIFIED | S1 |
| Official SDKs exist (Python `arkruntime` `Ark(base_url=...)`, Go `github.com/volcengine/ark-runtime-go`, Java). The Go SDK passes `omni_reference_task_type` and `output_format` via `WithExtraBody`. | VERIFIED | S5 |

## 2. Model IDs
| Model | ID | Label | Src |
|---|---|---|---|
| Dreamina Seedance 2.5 | `dreamina-seedance-2-5-260628` | VERIFIED | S5, S7, S8 |
| Dreamina Seedance 2.0 | `dreamina-seedance-2-0-260128` | VERIFIED | S5, S7 |
| Dreamina Seedance 2.0 fast | `dreamina-seedance-2-0-fast-260128` | VERIFIED | S5, S7 |
| Dreamina Seedance 2.0 mini | `dreamina-seedance-2-0-mini-260615` | VERIFIED | S5, S7 |
| Seedance 1.5 pro | `seedance-1-5-pro-251215` | VERIFIED | S1, S7 |
| Seedance 1.0 pro / pro fast | `seedance-1-0-pro-250528` / `seedance-1-0-pro-fast-251015` | VERIFIED | S7 |

- There is **one** Seedance 2.5 model ID. The model list shows no 2.5 pro, lite, fast, i2v or t2v variants (VERIFIED, S7). Task type (T2V, I2V, reference, edit, extend) is chosen by the `content` and roles, not by the model ID (VERIFIED, S5).

## 3. Create task — `POST /contents/generations/tasks`
Full URL: `POST https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks`. The call is async; the response is `{"id": "cgt-…"}` (VERIFIED, S1).
Task IDs are stored for 7 days from `created_at` (VERIFIED, S1).

### 3.1 Body vs prompt flags
- For `resolution`, `ratio`, `duration`, `frames`, `seed`, `camera_fixed` and `watermark`, the docs say "all models support both" body fields and `--` flags appended to the prompt. Example flags: `--rs 720p --rt 16:9 --dur 5 --seed 11 --cf false --wm true` (VERIFIED, S1).
- The **body** is the "Conventional method (recommended)" and uses strict validation. The flags are the "Legacy / weak-validation method", where invalid flags are ignored or cause an error (VERIFIED, S1). **The adapter should use body fields only.**
- The 2.5-only fields (`omni_reference_task_type`, `output_format`, `draft`, `priority`, `generate_audio`, etc.) have no documented flag form (VERIFIED by absence, S1).

### 3.2 Request body fields (S1, VERIFIED unless marked)
| Field | Type / default | Seedance 2.5 behaviour |
|---|---|---|
| `model` | string, required | `dreamina-seedance-2-5-260628` or an endpoint ID |
| `content` | object[], required | See 3.3 |
| `omni_reference_task_type` | string, default `auto` | 2.5 only. `auto` \| `reference` \| `edit` \| `extend`. With `edit`, the request needs ≥1 `reference_video` of 4–30 s, `ratio` = `adaptive` and `duration` = `-1`. With `extend`, it needs ≥1 `reference_video` and `ratio` = `adaptive`. An explicit value is validated synchronously at submit. With `auto`, an incompatibility triggers an async `InvalidParameter.TaskTypeConstraint` error. If the model's own classification differs from an explicit value, the task fails with async `InvalidParameter.TaskTypeMismatch`. |
| `resolution` | string | 2.5: default `720p`; values `480p`, `720p`, `1080p`. 1080p is 10-bit H.265/HEVC. (`4k` is 2.0 only.) |
| `ratio` | string | Values `16:9`, `4:3`, `1:1`, `3:4`, `9:16`, `21:9`, `adaptive`; 2.5 default `adaptive`. **Must be `adaptive`** for first-frame / first+last-frame, edit and extend tasks on 2.5. |
| `duration` | integer, seconds | 2.5: default `-1`; values `[4, 30]` or `-1` (the model picks). Edit tasks accept only `-1`; output ≈ the input length, possibly a non-integer and up to 0.4 s shorter. |
| `frames` | integer | **Seedance 1.0 pro / pro fast only** (`25+4n`, range [29, 289]). Not for 2.5. |
| `generate_audio` | boolean, default `true` | Supported on 2.5. Output audio is always **mono**. Put dialogue in double quotes. |
| `watermark` | boolean, default `false` | `true` adds an "AI Generated" mark in the lower-right corner |
| `output_format` | string, default `mp4` | 2.5 only. `mp4` \| `mov`. MOV is H.264 4:4:4 + PCM audio, recommended for edit/extend. |
| `seed` | integer, default `-1`, range [-1, 2147483647] | The docs list support for **Seedance 1.5 pro / 1.0 pro / 1.0 pro fast only**. 2.5 support is UNKNOWN; the Draft section implies 2.5 reuses a seed (see 3.5). |
| `camera_fixed` | boolean, default `false` | **1.5 pro / 1.0 pro / 1.0 pro fast only**; not supported in reference-image scenarios |
| `return_last_frame` | boolean, default `false` | Supported on 2.5 (S5 table). Returns a JPEG with no watermark at the video's resolution. |
| `draft` | boolean, default `false` | 2.5 and 1.5 pro. Draft output is 480p only; any other resolution errors. |
| `service_tier` | string, default `default` | `default` \| `flex`; **flex is not supported on 2.5 or 2.0**. Cannot be changed after submit. |
| `callback_url` | string | ModelArk POSTs a body shaped like the Retrieve response on each status change. Statuses: `queued`, `running`, `succeeded`, `failed`, `expired`. For succeeded/failed, delivery is retried 3× if no acknowledgement arrives within 5 s. |
| `execution_expires_after` | integer, default `172800`, range [3600, 259200] | Seconds from `created_at`; when exceeded the task becomes `expired` |
| `priority` | integer, default `0`, range [0, 9] | 2.5 / 2.0 only. Queue order within the same endpoint; does not pre-empt running tasks; not available with flex. |
| `safety_identifier` | string, ≤64 chars | A stable per-end-user ID; a hash is recommended |

### 3.3 `content[]` item types (S1, VERIFIED)
| `type` | Payload | `role` |
|---|---|---|
| `text` | `"text": "<prompt>"` | none |
| `image_url` | `"image_url": {"url": "<https URL \| data:image/<fmt>;base64,… \| asset://<ASSET_ID>>"}` | `first_frame` \| `last_frame` \| `reference_image`. With a single first-frame image, `role` may be omitted. |
| `video_url` | `"video_url": {"url": "<https URL \| asset://<ASSET_ID>>"}`. **No Base64** is listed for video. | `reference_video` |
| `audio_url` | `"audio_url": {"url": "<https URL \| data:audio/<fmt>;base64,… \| asset://<ASSET_ID>>"}` | `reference_audio` |
| `draft_task` | `"draft_task": {"id": "<draft task id>"}` | none (2.5 and 1.5 pro) |

- Allowed combinations: text; text(opt)+image; text(opt)+video; text(opt)+audio (audio-only works on 2.5); text(opt)+image+audio; text(opt)+image+video; text(opt)+video+audio; text(opt)+image+video+audio; or a draft task ID (VERIFIED, S1).
- **Mutually exclusive**: first-frame, first+last-frame and omni-reference (any `reference_*`) cannot be mixed. To approximate "first frame + references", name the frame in the prompt instead (VERIFIED, S1).
- Prompts refer to assets as `@Image1`, `@Video1`, `@Audio1` ("asset type + number"), numbered by order among same-type items in `content`. Raw asset IDs must not be used in the prompt (VERIFIED, S1/S5/S10 examples).
- 2.5 prompt languages include English, Spanish, Indonesian, Portuguese, Japanese, Malay, Thai, Arabic, Vietnamese and Korean (Chinese is listed in S5). Recommended prompt length is ≤1,000 English words (VERIFIED, S1, S5). **Punjabi is not listed** (VERIFIED by absence).

### 3.4 Task types and constraints (2.5) — S5 "Read before use", VERIFIED
| Task | Trigger | Constraints |
|---|---|---|
| Text-to-video | text only | none on ratio/duration |
| First / first+last frame | `role` `first_frame` (+ `last_frame`) | `ratio` must be `adaptive`; output keeps the first-frame aspect ratio. If the last frame's aspect ratio differs, it is cropped. |
| Reference-to-video | ≥1 `reference_*` | none on ratio/duration |
| Video edit | ≥1 `reference_video` + edit intent in the prompt ("edit the video", add, remove, replace…) | `ratio` `adaptive`, `duration` `-1`, ref video 4–30 s |
| Video extend | ≥1 `reference_video` + extend intent ("extend forward/backward", "continue") | `ratio` `adaptive`; duration `[4, 30]` or `-1` |

The model's own validation runs at submit (when the task type is explicit) **and** after the task starts. Async errors appear in `error` on Retrieve (S5, S2).

### 3.5 Draft mode (2.5) — S5, VERIFIED
1. `draft: true`, `resolution: "480p"` → returns a draft task ID, valid for 7 days. It is billed as a normal 480p video.
2. A final request with `content: [{"type":"draft_task","draft_task":{"id":"…"}}]`, `resolution: "1080p"` (the **only** final resolution allowed on 2.5) and the same `model`. `draft` must be omitted or `false`.
   - **Do NOT resend** prompt, references, `duration`, `ratio`, `seed`, `generate_audio` or `omni_reference_task_type`. Sending them raises an error even if the values are identical.
   - May resend `return_last_frame`, `output_format`, `watermark`, `service_tier`, `execution_expires_after`, `priority`, `callback_url` and `safety_identifier`.
- Retrieve returns `draft_task_id` on the final task (S2).

## 4. Retrieve — `GET /contents/generations/tasks/{id}` (S2, VERIFIED)
- Queryable window: records from the last 7 days.
- `status` values: `queued`, `running`, `cancelled`, `succeeded`, `failed`. The callback (S1) and delete table (S4) also use `expired`. The Retrieve page does not list `expired`, so treat it as possible (INFERRED).
- Response fields: `id`, `model`, `status`, `content.video_url`, `content.last_frame_url`, `created_at`, `updated_at` (Unix seconds), `draft`, `draft_task_id`, `duration` (int = floor(frames/24)), `frames`, `framespersecond`, `generate_audio`, `output_format`, `priority`, `ratio`, `resolution`, `safety_identifier`, `seed`, `service_tier`, `execution_expires_after`, `error{code,message}` (null on success), `usage{completion_tokens,total_tokens}` (input tokens are always 0).
- **`video_url` and `last_frame_url` are valid for 24 h**. A 2.5 URL can be **downloaded at most 100 times**. Download immediately.
- QPS: Retrieve 20, List 1, Cancel/Delete 20 per account (S5).

## 5. List and Cancel/Delete
- `GET /contents/generations/tasks?page_num=&page_size=&filter.status=&filter.task_ids=&filter.model=&filter.service_tier=`. `page_num` and `page_size` take [1, 500] (defaults 1 and 20). Repeat `filter.task_ids` once per ID. The response is `{total, items[]}`, where each item has the Retrieve fields (VERIFIED, S3).
- `DELETE /contents/generations/tasks/{id}`. A `queued` task becomes `cancelled`; `succeeded`, `failed` and `expired` records are deleted. A `running` or `cancelled` task cannot be cancelled or deleted. The response is `{}` (VERIFIED, S4). Cancelled tasks are auto-deleted after 24 h (S2).

## 6. Input asset constraints (2.5) — S1 + S5, VERIFIED
| Asset | Limits |
|---|---|
| Images | jpeg, png, webp, bmp, tiff, gif, heic, heif. Aspect ratio 0.4–2.5; sides 300–6000 px; <30 MB each. Counts: first frame 1; first+last 2; reference 1–30. |
| Videos | mp4/mov (H.264/H.265; audio AAC/MP3, plus PCM for mov per S5). Allowed resolutions 480p, 720p, 1080p, 4k. Aspect ratio 0.4–2.5; sides 300–6000 px; total pixels 407,696–8,295,044; ≤200 MB; 24–60 fps. Each clip is 2–30 s (4–30 s for edit). ≤10 clips, **total ≤30 s**. |
| Audio | wav/mp3, 2–30 s each, ≤10 clips, total ≤30 s, ≤15 MB each |
| Totals | ≤50 references (30 images + 10 videos + 10 audio). Request body ≤64 MB; do not Base64 large files. |
| Output | 480p/720p 8-bit; 1080p 10-bit HEVC. 24 fps. 4–30 s. mp4 or mov. |

Output pixel sizes for Seedance 2.5 (S1/S5):
- 480p: 16:9 854×480 · 4:3 752×560 · 1:1 640×640 · 3:4 560×752 · 9:16 480×854 · 21:9 992×432
- 720p: 16:9 1280×720 · 4:3 1112×834 · 1:1 960×960 · 3:4 834×1112 · 9:16 720×1280 · 21:9 1470×630
- 1080p: 16:9 1920×1080 · 4:3 1664×1248 · 1:1 1440×1440 · 3:4 1248×1664 · 9:16 1080×1920 · 21:9 2206×946

## 7. Pricing, activation, availability
- 2.5 is billed per output token (S8, VERIFIED):
  - 480p/720p: **USD 10.70/M** tokens without input video, **6.40/M** with input video.
  - 1080p: **11.7/M** without input video, **7.0/M** with input video.
  - Flex (offline) is not supported.
- Token estimate: `(input video duration + output duration) × width × height × fps / 1024`. The actual figure is `usage.completion_tokens` (VERIFIED, S8).
  - Check: 720p 16:9 5 s = 1280·720·24·5/1024 = 108,000 tokens ≈ USD 1.156, which matches the S8 example.
- S8 examples:
  - Without input video: 480p 5 s $0.514 ($0.103/s) · 720p 5 s $1.156 ($0.231/s) · 1080p 5 s $2.843 ($0.569/s).
  - With 2–30 s input video, 5 s output: 480p $0.553–2.152 · 720p $1.244–4.838 · 1080p $3.062–11.907.
- When the input includes video, a minimum token consumption applies. The minimum table is on a calculator page that was not read (UNKNOWN values).
- Only successful videos are charged; moderation failures are not billed (VERIFIED, S8).
- Activation (S9, VERIFIED) needs one of:
  - Credits/balance ≥ USD 30
  - An AI Savings Plan ≥ USD 30 (the $30 plan lasts 1 month; $60 and $100 plans last 3 months)
  - A Seedance resource pack ≥ USD 30 (valid 90 days)
  Then activate on the Model activation page. Deduction order: resource pack → Savings Plan → balance. None of these is refundable.
- Free quota for Seedance 2.5: none is documented. The error list has a generic "free trial quota exhausted" `QuotaExceeded` (UNKNOWN whether it applies to 2.5).
- Region: ap-southeast-1 only (VERIFIED, S7).

## 8. Real-person / likeness rules (S1, S10, VERIFIED)
- 2.5 and 2.0 **do not accept reference images or videos that contain real human faces**. They are rejected with `InputImageSensitiveContentDetected.PrivacyInformation` or `InputVideoSensitiveContentDetected.PrivacyInformation` (S11).
- Allowed routes:
  1. **Trusted outputs**: original, unedited face-containing outputs from the same account and platform, used within 30 days. This covers Seedance 2.5/2.0 videos (from 2026-03-11), their last-frame images (from 2026-04-16) and Seedream 5.0 lite/pro/flash T2I images (from 2026-04-16). Re-compressing or forwarding can break trust; keep originals in TOS.
  2. **Preset digital characters**: `asset://<ASSET_ID>` from the Digital characters library.
  3. **Authorized real-person assets**: real-person verification plus the person's authorization, then the asset is added to the asset library and gets an `asset://` ID. The onboarding steps are on a separate page that was not read (UNKNOWN detail).
- Trust covers inputs only; outputs can still be moderated.

## 9. Error codes and rate limits
- Rate limits for 2.5 (S5, S7, VERIFIED): enterprise **600 RPM / 10 concurrent**; individual **180 RPM / 3 concurrent**. Tasks beyond the concurrency limit queue; tasks beyond the RPM limit are rejected with 429. Limits are per primary account per model across versions and are "theoretical maximum" values.
- Key codes (S11, VERIFIED):
  - **400**: `MissingParameter`, `InvalidParameter`, `InvalidParameter.TaskTypeConstraint`, `InvalidParameter.TaskTypeMismatch`, `InvalidParameter.UnsupportedParameter`.
  - **400 moderation**: `Input{Text,Image,Video,Audio}SensitiveContentDetected`, `Output{Video,Audio,Image,Text}SensitiveContentDetected`, `….PolicyViolation` (copyright), `….PrivacyInformation` (real person), `OutputImageSensitiveContentDetected.DeepFake`.
  - **401**: `AuthenticationError`.
  - **403**: `AccountOverdueError`, `OperationDenied.ServiceNotOpen`, `AccessDenied`.
  - **404**: `ModelNotOpen`, `InvalidEndpointOrModel.NotFound`.
  - **429**: `ModelAccountRpmRateLimitExceeded`, `QuotaExceeded` (the "queued tasks exceed limit" variant), `RequestBurstTooFast`, `ServerOverloaded`, `SetLimitExceeded` (Safe Experience Mode).
  - **500**: `InternalServiceError`.

## 10. Adapter contract (documented fields only)
Endpoint `POST {BASE}/contents/generations/tasks`, with `BASE=https://ark.ap-southeast.bytepluses.com/api/v3`, headers `Authorization: Bearer <key>` and `Content-Type: application/json`.

**Text-to-video**
```json
{
  "model": "dreamina-seedance-2-5-260628",
  "content": [{ "type": "text", "text": "<prompt>" }],
  "resolution": "1080p",
  "ratio": "16:9",
  "duration": 10,
  "generate_audio": true,
  "output_format": "mov",
  "watermark": false,
  "return_last_frame": true
}
```

**Image-to-video (first frame)** — `ratio` must be `adaptive`
```json
{
  "model": "dreamina-seedance-2-5-260628",
  "content": [
    { "type": "text", "text": "<prompt>" },
    { "type": "image_url", "image_url": { "url": "https://…/first.png" }, "role": "first_frame" }
  ],
  "resolution": "720p",
  "ratio": "adaptive",
  "duration": 8,
  "generate_audio": true
}
```

**First + last frame**
```json
{
  "model": "dreamina-seedance-2-5-260628",
  "content": [
    { "type": "text", "text": "<prompt>" },
    { "type": "image_url", "image_url": { "url": "https://…/first.png" }, "role": "first_frame" },
    { "type": "image_url", "image_url": { "url": "https://…/last.png" },  "role": "last_frame" }
  ],
  "ratio": "adaptive",
  "duration": 5,
  "generate_audio": true
}
```

**Multimodal reference (images + video + audio)** — the prompt refers to `@Image1`, `@Video1`, `@Audio1`
```json
{
  "model": "dreamina-seedance-2-5-260628",
  "content": [
    { "type": "text", "text": "<prompt using @Image1 @Image2 @Video1 @Audio1>" },
    { "type": "image_url", "image_url": { "url": "https://…/ref1.png" }, "role": "reference_image" },
    { "type": "image_url", "image_url": { "url": "asset://<ASSET_ID>" },  "role": "reference_image" },
    { "type": "video_url", "video_url": { "url": "https://…/ref.mp4" },  "role": "reference_video" },
    { "type": "audio_url", "audio_url": { "url": "https://…/ref.wav" },  "role": "reference_audio" }
  ],
  "omni_reference_task_type": "reference",
  "resolution": "720p",
  "ratio": "16:9",
  "duration": 15,
  "generate_audio": true,
  "output_format": "mp4",
  "callback_url": "https://<your-host>/seedance-callback",
  "execution_expires_after": 172800,
  "priority": 0
}
```
(Edit variant: `"omni_reference_task_type": "edit"`, `"ratio": "adaptive"`, `"duration": -1`, ref video 4–30 s. Extend variant: `"extend"`, `"ratio": "adaptive"`.)

**Create response**: `{ "id": "cgt-2026******-****" }`

**Query response** (`GET {BASE}/contents/generations/tasks/{id}`). The fields come from S2; values are illustrative:
```json
{
  "id": "cgt-2026******-****",
  "model": "dreamina-seedance-2-5-260628",
  "status": "succeeded",
  "content": {
    "video_url": "https://ark-content-generation-ap-southeast-1.tos-ap-southeast-1.volces.com/xxx",
    "last_frame_url": "https://…"
  },
  "usage": { "completion_tokens": 108000, "total_tokens": 108000 },
  "error": null,
  "created_at": 1743414619,
  "updated_at": 1743414673,
  "seed": 10,
  "resolution": "720p",
  "ratio": "16:9",
  "duration": 5,
  "framespersecond": 24,
  "generate_audio": true,
  "output_format": "mp4",
  "service_tier": "default",
  "execution_expires_after": 172800,
  "priority": 0
}
```
On failure: `"status": "failed"`, `"error": { "code": "<code>", "message": "<msg>" }`.

**Adapter rules**
- Poll Retrieve; the docs' samples use a 10 s interval, and the QPS limit is 20.
- Treat `succeeded`, `failed`, `cancelled` and `expired` as terminal.
- Download `video_url` at once (24 h validity, 100 downloads).
- Never send `frames`, `camera_fixed` or `service_tier: "flex"` to 2.5.
- Force `ratio: "adaptive"` for first/last-frame, edit and extend.
- Reject real-face references unless they are `asset://` or trusted outputs.

## 11. UNKNOWNs / not confirmed
1. Whether `seed` is honoured by 2.5. S1 lists only 1.x models, but the Draft rules treat seed as a reused parameter.
2. Whether Retrieve can return `status: "expired"`. Its status list omits it; the callback and delete docs include it.
3. Seedance 2.5 minimum-token table values when the input includes video (calculator page not read).
4. Any free trial quota for 2.5. None is documented; activation needs USD 30.
5. The real-person asset onboarding API/process and the Digital characters library API (pages not read).
6. HTTP status/body for a callback acknowledgement (only "delivery confirmation within 5 s" is stated).
7. Whether Base64 is accepted for `video_url` (not listed; assume URL or `asset://` only).
8. Pro, lite, fast or other variants of 2.5: none exist in the model list as of 2026-10-17.
9. Punjabi prompt/dialogue support: not listed among the supported languages.
