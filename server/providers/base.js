// Provider adapter contract. A provider turns a provider-neutral GenerationRequest
//   { model, workflow, prompt, params, inputs: [{asset_id, role, kind, handle?, path, mime}] }
// into wire calls. Everything provider-specific (field names, limits, pricing,
// reference tokens) lives in the adapter, never in the engine.
//
// Required members:
//   id, label, billable (bool), description
//   models()                      -> [{ id, label, workflows: [...], caps }]
//   caps(modelId)                 -> capability descriptor (below)
//   validate(modelId, req)        -> { errors: [], warnings: [] }
//   estimate(modelId, req)        -> { usd, basis, confidence: 'documented'|'approximate'|'unknown' }
//   async submit(modelId, req, ctx) -> { task_id }        ctx: { credentials, signal }
//   async poll(task_id, ctx)      -> { status: 'running'|'succeeded'|'failed', progress?, result?: { url? , file? }, usage?, error? }
//   async cancel(task_id, ctx)
//   async download(result, destPath, ctx)
//   async testConnection(ctx)     -> { ok, detail }
//
// Capability descriptor:
//   native_params: params the API accepts as real parameters (duration_s, aspect, resolution, seed, camera_fixed, generate_audio, negative_prompt)
//   workflows: generate | image_to_video | first_last_frame | reference_to_video | edit | extend
//   durations: { min, max, step? } ; resolutions: [...] ; aspects: [...]
//   max_refs: { image, video, audio } ; exclusive: human-readable rules
//
// Errors thrown by adapters should be ProviderError so the job runner can decide
// whether a retry is safe (never retry a submit whose outcome is unknown).

export class ProviderError extends Error {
  // category: auth | quota | rate_limit | invalid_request | moderation | provider | network_pre_send | network_unknown | timeout
  constructor(category, message, { status, code, retryable = false, details } = {}) {
    super(message);
    this.category = category;
    this.status = status;
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }
  toJSON() { return { category: this.category, message: this.message, status: this.status, code: this.code, retryable: this.retryable }; }
}

// Common check of a request against a capability descriptor.
export function validateAgainstCaps(caps, req) {
  const errors = [];
  const warnings = [];
  const p = req.params ?? {};
  if (!caps.workflows.includes(req.workflow)) errors.push(`model does not support workflow "${req.workflow}" (supports: ${caps.workflows.join(', ')})`);
  if (p.duration_s != null && caps.durations) {
    const { min, max, allowed } = caps.durations;
    if (allowed && !allowed.includes(p.duration_s)) errors.push(`duration ${p.duration_s}s not allowed (allowed: ${allowed.join(', ')})`);
    else if (p.duration_s < min || p.duration_s > max) errors.push(`duration ${p.duration_s}s out of range ${min}–${max}s`);
    if (!Number.isInteger(p.duration_s) && caps.durations.integer) errors.push('duration must be a whole number of seconds');
  }
  if (p.resolution && caps.resolutions && !caps.resolutions.includes(p.resolution)) errors.push(`resolution ${p.resolution} not supported (${caps.resolutions.join(', ')})`);
  if (p.aspect && caps.aspects && !caps.aspects.includes(p.aspect)) errors.push(`aspect ${p.aspect} not supported (${caps.aspects.join(', ')})`);
  const count = (role) => req.inputs.filter((i) => i.role === role).length;
  const refImg = count('reference_image'), refVid = count('reference_video'), refAud = count('reference_audio');
  if (caps.max_refs) {
    if (refImg > (caps.max_refs.image ?? 0)) errors.push(`${refImg} reference images > max ${caps.max_refs.image ?? 0}`);
    if (refVid > (caps.max_refs.video ?? 0)) errors.push(`${refVid} reference videos > max ${caps.max_refs.video ?? 0}`);
    if (refAud > (caps.max_refs.audio ?? 0)) errors.push(`${refAud} reference audio clips > max ${caps.max_refs.audio ?? 0}`);
  }
  const frames = count('first_frame') + count('last_frame');
  if (frames && refImg + refVid + refAud && caps.frames_exclusive_with_refs)
    errors.push('first/last-frame inputs cannot be combined with reference inputs on this model — use a storyboard-locked OR a reference-locked shot');
  if (req.workflow === 'image_to_video' && !count('first_frame')) errors.push('image_to_video needs a first_frame image');
  if (req.workflow === 'first_last_frame' && (!count('first_frame') || !count('last_frame'))) errors.push('first_last_frame needs both a first_frame and a last_frame');
  if (req.workflow === 'reference_to_video' && !(refImg + refVid + refAud)) errors.push('reference_to_video needs at least one reference input');
  if ((req.workflow === 'edit' || req.workflow === 'extend') && !refVid) errors.push(`${req.workflow} needs a source video (reference_video)`);
  if (p.generate_audio && !caps.audio) errors.push('model cannot generate audio');
  for (const i of req.inputs) {
    if (i.role === 'reference_audio' && i.kind !== 'audio') errors.push(`input ${i.label ?? i.asset_id} has role reference_audio but is ${i.kind}`);
    if (i.role === 'reference_video' && i.kind !== 'video') errors.push(`input ${i.label ?? i.asset_id} has role reference_video but is ${i.kind}`);
    if (['first_frame', 'last_frame', 'reference_image'].includes(i.role) && i.kind !== 'image') errors.push(`input ${i.label ?? i.asset_id} has role ${i.role} but is ${i.kind}`);
  }
  if (!req.prompt?.trim() && !req.inputs.length) errors.push('empty request: no prompt and no inputs');
  return { errors, warnings };
}
