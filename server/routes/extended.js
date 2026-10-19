// Milestones 2–5: presets, AI Director, reference analysis + transforms,
// continuity chaining, batch generation, QC, version compare, NLE export.
import fs from 'node:fs';
import path from 'node:path';
import { hydrate, now, uid, logEvent } from '../db.js';
import { deepMerge, resolveSpec } from '../engine/shotspec.js';
import { breakdown } from '../engine/director.js';
import { analyzeReference, planTransform, TRANSFORMS } from '../engine/transform.js';
import { runQc, compareVersions } from '../engine/qc.js';
import { edl, fcpxml, otio } from '../engine/exports.js';
import { conformToReference } from '../engine/conform.js';
import { reframe, upscale } from '../engine/post.js';
import { analyzeCameraPath, framePattern, encodeSequence } from '../engine/previz.js';
import { registerFile } from '../services/assets.js';
import { planGeneration, createJob, approveJob, httpError } from '../services/generation.js';

export function registerExtendedRoutes(r, ctx) {
  const { db, providers, runner, config, one, all, must, insertShot, touchProject } = ctx;

  // ------------------------------------------------------------ presets
  r.get('/api/presets', (_p, q) => {
    const pid = q.get('project_id');
    return pid ? all('SELECT * FROM presets WHERE project_id IS NULL OR project_id = ? ORDER BY builtin DESC, kind, name', pid) : all('SELECT * FROM presets WHERE project_id IS NULL ORDER BY builtin DESC, kind, name');
  });
  r.post('/api/presets', (_p, _q, b) => {
    if (!b.name || !b.data) throw httpError(400, 'name and data required');
    const id = uid();
    db.prepare('INSERT INTO presets (id, project_id, kind, name, data_json, builtin, created_at) VALUES (?,?,?,?,?,0,?)').run(id, b.project_id ?? null, b.kind ?? 'shot', b.name, JSON.stringify(stripVolatile(b.data)), now());
    return [201, one('SELECT * FROM presets WHERE id = ?', id)];
  });
  r.del('/api/presets/:id', ({ id }) => {
    const p = must(one('SELECT * FROM presets WHERE id = ?', id), 'preset');
    if (p.builtin) throw httpError(409, 'built-in presets cannot be deleted');
    db.prepare('DELETE FROM presets WHERE id = ?').run(id);
    return { deleted: true };
  });
  r.post('/api/shots/:id/apply-preset', ({ id }, _q, b) => {
    const s = must(one('SELECT * FROM shots WHERE id = ?', id), 'shot');
    const p = must(one('SELECT * FROM presets WHERE id = ?', b.preset_id), 'preset');
    const spec = deepMerge(s.spec, p.data);
    spec.preset_id = p.id; // remembered so links/URLs can show which preset the shot uses
    db.prepare('UPDATE shots SET spec_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(spec), now(), id);
    return one('SELECT * FROM shots WHERE id = ?', id);
  });

  // ------------------------------------------------------------ AI Director (deterministic tier)
  r.post('/api/director/breakdown', (_p, _q, b) => {
    if (!b.script?.trim()) throw httpError(400, 'script text required');
    const known = b.project_id ? new Set(all('SELECT handle FROM refs WHERE project_id = ?', b.project_id).map((x) => x.handle)) : new Set();
    return { ...breakdown(b.script, { knownHandles: known }), tier: 'deterministic', note: 'Rule-based coverage plan. Review every shot; it is a starting point, not a cut.' };
  });
  // Apply a breakdown: creates scenes + draft shots (never touches existing shots).
  r.post('/api/projects/:id/director/apply', ({ id }, _q, b) => {
    must(one('SELECT id FROM projects WHERE id = ?', id), 'project');
    const plan = b.breakdown ?? breakdown(b.script ?? '');
    const created = [];
    for (const sc of plan.scenes) {
      const sid = uid(), t = now();
      const idx = (db.prepare('SELECT MAX(idx) m FROM scenes WHERE project_id = ?').get(id).m ?? 0) + 1;
      db.prepare('INSERT INTO scenes (id, project_id, idx, heading, script_text, settings_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(sid, id, idx, sc.heading, b.script ?? '', JSON.stringify({}), t, t);
      const scene = one('SELECT * FROM scenes WHERE id = ?', sid);
      const shots = sc.shots.map((s) => insertShot(scene, { title: s.title, spec: { ...s.spec, director_note: s.rationale } }));
      created.push({ scene_id: sid, heading: sc.heading, shots: shots.length });
    }
    if (b.create_character_refs) {
      for (const c of plan.characters ?? []) {
        if (one('SELECT id FROM refs WHERE project_id = ? AND handle = ?', id, c.handle)) continue;
        db.prepare('INSERT INTO refs (id, project_id, type, name, handle, description, asset_ids_json, attrs_json, consent_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
          .run(uid(), id, 'character', c.name, c.handle, '', '[]', '{}', '{}', now(), now());
      }
    }
    touchProject(id);
    logEvent(db, 'info', 'director.apply', `created ${created.length} scenes`, { project_id: id });
    return [201, { created }];
  });

  // ------------------------------------------------------------ continuity: chain from previous shot's last frame
  r.post('/api/shots/:id/chain-from-previous', ({ id }) => {
    const s = must(one('SELECT * FROM shots WHERE id = ?', id), 'shot');
    const prev = one('SELECT * FROM shots WHERE scene_id = ? AND idx < ? ORDER BY idx DESC LIMIT 1', s.scene_id, s.idx);
    if (!prev) throw httpError(409, 'no previous shot in this scene');
    const job = prev.selected_job_id ? one('SELECT * FROM jobs WHERE id = ?', prev.selected_job_id) : null;
    const lf = job?.result?.last_frame_asset_id;
    let assetId = lf;
    if (!assetId && job?.output_asset_id) assetId = `extract:${job.output_asset_id}`;
    if (!assetId) throw httpError(409, 'previous shot has no selected generation');
    if (assetId.startsWith('extract:')) throw httpError(409, 'previous generation has no last-frame image (use Extract Frame in Edit Studio first)');
    const refs = (s.spec.references ?? []).filter((x) => x.role !== 'first_frame' && !['reference_image', 'reference_video', 'reference_audio'].includes(x.role));
    const spec = { ...s.spec, references: [...refs, { role: 'first_frame', asset_id: assetId, note: `continues from ${prev.title}` }], workflow: '' };
    db.prepare('UPDATE shots SET spec_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(spec), now(), id);
    return { shot: one('SELECT * FROM shots WHERE id = ?', id), note: 'First frame set to the previous shot\'s last frame. Reference inputs were removed because the provider cannot combine first-frame and reference modes; subject identity now relies on the frame itself.' };
  });

  // Extract a still from any video asset (derived asset; original untouched).
  r.post('/api/assets/:id/extract-frame', async ({ id }, _q, b) => {
    const a = must(one('SELECT * FROM assets WHERE id = ?', id), 'asset');
    if (a.kind !== 'video') throw httpError(400, 'not a video');
    const { extractFrame } = await import('../media.js');
    const at = b.at === 'last' ? Math.max(0, (a.meta?.duration_s ?? 1) - 0.05) : Number(b.at ?? 0);
    const out = path.join(path.dirname(a.path), `${path.parse(a.filename).name}_f${at.toFixed(2)}.png`);
    await extractFrame(a.path, out, at);
    const asset = await registerFile(db, { projectId: a.project_id, file: out, origin: 'derived', meta: { derived_from: a.id, at_s: at, trusted_output: !!a.meta?.trusted_output },
      rights: { ...a.rights, source: `frame of ${a.filename}` }, tags: ['frame'] });
    return [201, asset];
  });

  // ------------------------------------------------------------ reference analysis + transforms
  r.post('/api/assets/:id/analyze', async ({ id }, _q, b) => {
    const a = must(one('SELECT * FROM assets WHERE id = ?', id), 'asset');
    if (a.kind !== 'video') throw httpError(400, 'reference analysis needs a video');
    const result = await analyzeReference(a, { threshold: b.threshold ?? 0.3 });
    // Register keyframes as derived assets so they can be used as references.
    for (const s of result.segments) {
      const kf = await registerFile(db, { projectId: a.project_id, file: s.keyframe_file, origin: 'derived', meta: { derived_from: a.id, segment: s.index },
        rights: { ...a.rights, source: `keyframe of ${a.filename}` }, tags: ['keyframe'] });
      s.keyframe_asset_id = kf.id;
      delete s.keyframe_file;
    }
    const aid = uid();
    db.prepare('INSERT INTO analyses (id, project_id, asset_id, kind, result_json, created_at) VALUES (?,?,?,?,?,?)').run(aid, a.project_id, a.id, 'shot_segmentation', JSON.stringify(result), now());
    return [201, { id: aid, ...result }];
  });
  r.get('/api/assets/:id/analyses', ({ id }) => all('SELECT * FROM analyses WHERE asset_id = ? ORDER BY created_at DESC', id));
  r.get('/api/transforms', () => TRANSFORMS);
  r.post('/api/projects/:id/transform', ({ id }, _q, b) => {
    must(one('SELECT id FROM projects WHERE id = ?', id), 'project');
    const source = must(one('SELECT * FROM assets WHERE id = ? AND project_id = ?', b.source_asset_id, id), 'source asset');
    if (source.kind !== 'video') throw httpError(400, 'source must be a video');
    const analysis = b.analysis_id ? one('SELECT * FROM analyses WHERE id = ?', b.analysis_id)?.result : null;
    const swapRefs = (b.ref_handles ?? []).map((h) => must(one('SELECT * FROM refs WHERE project_id = ? AND handle = ?', id, h), `reference ${h}`));
    const plans = planTransform(b.type, { analysis, source, brief: b.brief, swapRefs, target: b.target, replacement: b.replacement, direction: b.direction, extendSeconds: b.extend_seconds, aspect: b.aspect, scope: b.scope === 'face' ? 'face' : 'character' });
    // A transform becomes its own scene so the original material is never touched.
    const sid = uid(), t = now();
    const idx = (db.prepare('SELECT MAX(idx) m FROM scenes WHERE project_id = ?').get(id).m ?? 0) + 1;
    db.prepare('INSERT INTO scenes (id, project_id, idx, heading, script_text, settings_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(sid, id, idx, `${TRANSFORMS[b.type].label}: ${source.filename}`, b.brief ?? '', JSON.stringify({ transform: { type: b.type, source_asset_id: source.id } }), t, t);
    const scene = one('SELECT * FROM scenes WHERE id = ?', sid);
    const shots = plans.map((p) => {
      const spec = { ...p.spec };
      if (b.type === 'recreate') {
        const seg = analysis.segments.find((s) => s.index === p.spec.transform.segment.index);
        spec.references = [{ role: 'reference_image', asset_id: seg.keyframe_asset_id, note: `composition of reference segment ${seg.index}` }];
      }
      return insertShot(scene, { title: p.title, spec });
    });
    return [201, { scene_id: sid, shots, classification: TRANSFORMS[b.type].classification, note: TRANSFORMS[b.type].note }];
  });

  // ------------------------------------------------------------ local post: reframe + upscale (new derived files)
  const postOut = (a, suffix) => {
    const dir = path.join(config.outputsDir, a.project_id);
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, `${path.parse(a.filename).name}_${suffix}_${Date.now()}.mp4`);
  };
  r.post('/api/assets/:id/reframe', async ({ id }, _q, b) => {
    const a = must(one('SELECT * FROM assets WHERE id = ?', id), 'asset');
    if (a.kind !== 'video') throw httpError(400, 'reframe works on video');
    const out = postOut(a, `reframe${String(b.aspect ?? '9:16').replace(/[:.]/g, 'x')}_${b.mode ?? 'crop'}`);
    const res = await reframe(a.path, out, { aspect: b.aspect, mode: b.mode, position: b.position });
    const asset = await registerFile(db, { projectId: a.project_id, file: out, origin: 'derived', meta: { derived_from: a.id, reframe: res, trusted_output: false }, rights: { ...a.rights, source: `reframe of ${a.filename}` }, tags: ['reframe', res.aspect] });
    return [201, { asset, ...res }];
  });
  r.post('/api/assets/:id/upscale', async ({ id }, _q, b) => {
    const a = must(one('SELECT * FROM assets WHERE id = ?', id), 'asset');
    if (a.kind !== 'video') throw httpError(400, 'upscale works on video');
    const out = postOut(a, `up${b.target ?? '1080p'}`);
    const res = await upscale(a.path, out, { target: b.target, sharpen: b.sharpen !== false });
    const asset = await registerFile(db, { projectId: a.project_id, file: out, origin: 'derived', meta: { derived_from: a.id, upscale: res, trusted_output: false }, rights: { ...a.rights, source: `upscale of ${a.filename}` }, tags: ['upscale', b.target ?? '1080p'] });
    return [201, { asset, ...res }];
  });

  // ------------------------------------------------------------ Blender previz → motion reference
  // Import a Blender render: a folder with an image sequence (encoded to a clip) or a video file.
  // A camera.json beside it (docs/blender/export_camera_json.py) adds the derived camera moves + lens.
  r.post('/api/projects/:id/previz/import', async ({ id }, _q, b) => {
    must(one('SELECT id FROM projects WHERE id = ?', id), 'project');
    const src = String(b.path ?? '').trim().replace(/^"|"$/g, '');
    if (!src || !fs.existsSync(src)) throw httpError(400, `path not found: ${src || '(empty)'}`);
    const fps = Number(b.fps) || 24;
    const dir = path.join(config.assetsDir, id);
    fs.mkdirSync(dir, { recursive: true });
    const st = fs.statSync(src);
    const base = (b.name || path.basename(src).replace(/\.[^.]+$/, '')).replace(/[^\w.\- ]+/g, '_').slice(0, 60) || 'previz';
    const out = path.join(dir, `previz_${base}_${Date.now()}.mp4`);
    let camFile = null, frames = null;
    if (st.isDirectory()) {
      const seq = framePattern(src);
      if (!seq) throw httpError(400, 'no image sequence (png/jpg/exr/tif) in that folder');
      await encodeSequence(seq, out, fps);
      frames = seq.count;
      camFile = ['camera.json', `${base}.camera.json`].map((n) => path.join(src, n)).find((p) => fs.existsSync(p)) ?? null;
    } else {
      if (!/\.(mp4|mov|mkv|webm|avi)$/i.test(src)) throw httpError(400, 'expected a folder of frames or a video file');
      fs.copyFileSync(src, out); // never touch the original render
      const side = src.replace(/\.[^.]+$/, '.camera.json');
      camFile = [side, path.join(path.dirname(src), 'camera.json')].find((p) => fs.existsSync(p)) ?? null;
    }
    let camera = null;
    if (camFile) {
      try { camera = analyzeCameraPath(JSON.parse(fs.readFileSync(camFile, 'utf8'))); camera.source = path.basename(camFile); }
      catch (e) { camera = { error: `camera.json unreadable: ${e.message.slice(0, 120)}` }; }
    }
    const asset = await registerFile(db, { projectId: id, file: out, origin: 'derived',
      meta: { previz: { imported_from: src, frames, fps, camera } }, rights: { rights_confirmed: true, source: 'Blender previz render (own work)' }, tags: ['previz'] });
    logEvent(db, 'info', 'previz.import', `imported previz ${base}${camera?.moves ? ` (${camera.moves.join(' → ')})` : ''}`, { asset_id: asset.id });
    return [201, { asset, camera }];
  });

  // Make a shot from a previz clip. mode "motion": the clip is a reference video for camera/blocking;
  // mode "first_frame": its first frame locks the composition (storyboard-locked, image-to-video).
  r.post('/api/assets/:id/previz-shot', async ({ id }, _q, b) => {
    const a = must(one('SELECT * FROM assets WHERE id = ?', id), 'asset');
    if (a.kind !== 'video') throw httpError(400, 'previz must be a video');
    const cam = a.meta?.previz?.camera;
    const mode = b.mode === 'first_frame' ? 'first_frame' : 'motion';
    let scene = b.scene_id ? must(one('SELECT * FROM scenes WHERE id = ? AND project_id = ?', b.scene_id, a.project_id), 'scene') : null;
    if (!scene) {
      const sid = uid(), t = now();
      const idx = (db.prepare('SELECT MAX(idx) m FROM scenes WHERE project_id = ?').get(a.project_id).m ?? 0) + 1;
      db.prepare('INSERT INTO scenes (id, project_id, idx, heading, script_text, settings_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(sid, a.project_id, idx, `Previz: ${a.filename}`, '', JSON.stringify({ previz: { asset_id: a.id } }), t, t);
      scene = one('SELECT * FROM scenes WHERE id = ?', sid);
    }
    let refAsset = a.id;
    if (mode === 'first_frame') {
      const { extractFrame } = await import('../media.js');
      const outF = path.join(path.dirname(a.path), `${path.parse(a.filename).name}_first.png`);
      await extractFrame(a.path, outF, 0);
      refAsset = (await registerFile(db, { projectId: a.project_id, file: outF, origin: 'derived', meta: { derived_from: a.id, at_s: 0 }, rights: a.rights, tags: ['previz', 'frame'] })).id;
    }
    const brief = String(b.brief ?? '').trim();
    const moves = cam?.moves?.filter((m) => m !== 'static') ?? [];
    const spec = {
      intent: { summary: mode === 'motion'
        ? `Render the greybox previz as a finished, photoreal shot${brief ? `: ${brief}` : ''}. Follow the previz camera move, framing, timing and blocking exactly; replace the grey placeholder shapes with real people, set and props.`
        : `${brief || 'The scene in the previz frame, rendered as a finished, photoreal shot'}. Keep the composition of the first frame.` },
      duration_s: Math.max(4, Math.min(15, Math.round(a.meta?.duration_s ?? cam?.duration_s ?? 5))),
      camera: moves.length ? { movement: moves[0], moves, speed: cam.speed ?? '' } : cam?.moves?.[0] === 'static' ? { movement: 'static' } : {},
      lens: cam?.focal_mm ? { focal_mm: cam.focal_mm } : {},
      references: [{ role: mode === 'motion' ? 'reference_video' : 'first_frame', asset_id: refAsset, note: mode === 'motion' ? 'previz: camera + blocking' : 'previz first frame' }],
      previz: { asset_id: a.id, mode, camera: cam ?? null },
    };
    const shot = insertShot(scene, { title: `${mode === 'motion' ? 'Previz → shot' : 'Previz frame → shot'} · ${path.parse(a.filename).name}`.slice(0, 80), spec });
    return [201, { shot, scene_id: scene.id, mode, camera: cam ?? null }];
  });

  // ------------------------------------------------------------ OG Katana: conform to reference + recipes
  // Conform a recreation scene: selected takes cut to the reference shot lengths, reference size/fps,
  // reference soundtrack underneath. Missing takes become black slates so the timing still holds.
  r.post('/api/scenes/:id/conform', async ({ id }) => {
    const scene = must(one('SELECT * FROM scenes WHERE id = ?', id), 'scene');
    const tr = scene.settings?.transform;
    if (tr?.type !== 'recreate') throw httpError(409, 'conform works on OG Katana recreation scenes');
    const src = must(one('SELECT * FROM assets WHERE id = ?', tr.source_asset_id), 'reference video');
    const shots = all(`SELECT sh.*, j.output_asset_id AS out_id FROM shots sh LEFT JOIN jobs j ON j.id = sh.selected_job_id WHERE sh.scene_id = ? ORDER BY sh.idx`, id);
    const report = [];
    const items = shots.map((s) => {
      const seg = s.spec?.transform?.segment;
      const take = s.out_id ? one('SELECT * FROM assets WHERE id = ?', s.out_id) : null;
      const dur = seg?.duration_s ?? s.spec?.duration_s ?? 4;
      report.push({ shot: s.title, segment_s: dur, take_s: take?.meta?.duration_s ?? null, status: !take ? 'black slate (no selected take)' : take.meta?.duration_s < dur ? 'held last frame' : 'trimmed' });
      return { file: take?.path ?? null, duration_s: dur };
    });
    const dir = path.join(config.outputsDir, scene.project_id);
    fs.mkdirSync(dir, { recursive: true });
    const out = path.join(dir, `katana_conform_${scene.id.slice(0, 8)}_${Date.now()}.mp4`);
    const v = src.meta?.video ?? {};
    const res = await conformToReference({ items, width: v.width ?? 1280, height: v.height ?? 720, fps: v.fps ?? 24, soundtrackFile: src.meta?.audio ? src.path : null, out });
    const asset = await registerFile(db, { projectId: scene.project_id, file: out, origin: 'derived',
      meta: { conform: { scene_id: id, reference_asset_id: src.id, segments: report }, derived_from: src.id }, rights: { ...src.rights, source: `Katana conform of ${src.filename}` }, tags: ['conform', 'katana'] });
    logEvent(db, 'info', 'katana.conform', `conformed ${items.length} shots to ${src.filename}`, { scene_id: id, asset_id: asset.id });
    return [201, { asset, report, ...res, soundtrack: !!src.meta?.audio }];
  });

  // Recipes: a reference's timing structure saved for reuse (project-scoped; keyframes live in the project).
  r.post('/api/analyses/:id/recipe', ({ id }, _q, b) => {
    const an = must(one('SELECT * FROM analyses WHERE id = ?', id), 'analysis');
    const res = an.result;
    const data = { source_asset_id: an.asset_id, analysis_id: an.id, brief: b.brief ?? '',
      segments: res.segments.map((s) => ({ index: s.index, start_s: s.start_s, end_s: s.end_s, duration_s: s.duration_s, keyframe_asset_id: s.keyframe_asset_id })),
      edit_rhythm: res.edit_rhythm, bpm: res.soundtrack?.bpm ?? null, cuts_on_beat: res.cut_alignment ? `${res.cut_alignment.on_beat}/${res.cut_alignment.total}` : null,
      size: { width: res.source.width, height: res.source.height, fps: res.source.fps }, total_s: res.source.duration_s };
    const pid = uid();
    db.prepare('INSERT INTO presets (id, project_id, kind, name, data_json, builtin, created_at) VALUES (?,?,?,?,?,0,?)')
      .run(pid, an.project_id, 'recipe', b.name?.trim() || `Recipe · ${res.segments.length} shots · ${res.source.duration_s}s`, JSON.stringify(data), now());
    return [201, one('SELECT * FROM presets WHERE id = ?', pid)];
  });
  r.post('/api/projects/:id/recipes/:rid/apply', ({ id, rid }, _q, b) => {
    const rec = must(one(`SELECT * FROM presets WHERE id = ? AND kind = 'recipe' AND project_id = ?`, rid, id), 'recipe');
    const source = must(one('SELECT * FROM assets WHERE id = ?', rec.data.source_asset_id), 'recipe reference video');
    const swapRefs = (b.ref_handles ?? []).map((h) => must(one('SELECT * FROM refs WHERE project_id = ? AND handle = ?', id, h), `reference ${h}`));
    const plans = planTransform('recreate', { analysis: { segments: rec.data.segments }, source, brief: b.brief ?? rec.data.brief, swapRefs });
    const sid = uid(), t = now();
    const idx = (db.prepare('SELECT MAX(idx) m FROM scenes WHERE project_id = ?').get(id).m ?? 0) + 1;
    db.prepare('INSERT INTO scenes (id, project_id, idx, heading, script_text, settings_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(sid, id, idx, `${rec.name}${b.brief ? ` — ${b.brief.slice(0, 40)}` : ''}`, b.brief ?? '', JSON.stringify({ transform: { type: 'recreate', source_asset_id: source.id, recipe_id: rec.id } }), t, t);
    const scene = one('SELECT * FROM scenes WHERE id = ?', sid);
    const shots = plans.map((pl) => {
      const seg = rec.data.segments.find((s) => s.index === pl.spec.transform.segment.index);
      return insertShot(scene, { title: pl.title, spec: { ...pl.spec, references: seg?.keyframe_asset_id ? [{ role: 'reference_image', asset_id: seg.keyframe_asset_id, note: `composition of recipe shot ${seg.index}` }] : [] } });
    });
    touchProject(id);
    return [201, { scene_id: sid, shots }];
  });

  // ------------------------------------------------------------ batch generation for a scene
  r.post('/api/scenes/:id/generate-all', ({ id }, _q, b) => {
    const scene = must(one('SELECT * FROM scenes WHERE id = ?', id), 'scene');
    const shots = all('SELECT * FROM shots WHERE scene_id = ? ORDER BY idx', scene.id).filter((s) => !b.only_ids || b.only_ids.includes(s.id));
    const results = [];
    for (const s of shots) {
      try {
        const plan = planGeneration(db, providers, { shotId: s.id, providerId: b.provider, model: b.model });
        if (plan.errors.length) { results.push({ shot_id: s.id, title: s.title, ok: false, errors: plan.errors }); continue; }
        const { job, duplicate } = createJob(db, plan);
        results.push({ shot_id: s.id, title: s.title, ok: true, job_id: job.id, status: job.status, duplicate, usd: plan.estimate.usd });
      } catch (e) { results.push({ shot_id: s.id, title: s.title, ok: false, errors: [e.message] }); }
    }
    runner.tick();
    const total = results.filter((x) => x.ok && x.status === 'awaiting_approval').reduce((s, x) => s + (x.usd ?? 0), 0);
    return { results, awaiting_approval_usd: Math.round(total * 10000) / 10000 };
  });
  // Approve several billable jobs at once with one confirmation of the exact total.
  r.post('/api/jobs/approve-batch', (_p, _q, b) => {
    const jobs = (b.job_ids ?? []).map((id) => must(one('SELECT * FROM jobs WHERE id = ?', id), `job ${id}`));
    const total = Math.round(jobs.reduce((s, j) => s + Number(j.estimate.usd ?? 0), 0) * 10000) / 10000;
    if (Number(b.confirm_usd_total) !== total) throw httpError(400, `confirmation must equal the batch total ($${total.toFixed(4)})`);
    const out = [];
    for (const j of jobs) {
      try { out.push({ id: j.id, ok: true, status: approveJob(db, j.id, { confirmUsd: Number(j.estimate.usd ?? 0) }).status }); }
      catch (e) { out.push({ id: j.id, ok: false, error: e.message }); break; } // stop at the first budget refusal
    }
    runner.tick();
    return { total, results: out };
  });

  // ------------------------------------------------------------ QC + compare
  r.post('/api/assets/:id/qc', async ({ id }) => {
    const asset = must(one('SELECT * FROM assets WHERE id = ?', id), 'asset');
    if (asset.kind !== 'video') throw httpError(400, 'QC runs on video assets');
    const job = asset.meta?.job_id ? one('SELECT * FROM jobs WHERE id = ?', asset.meta.job_id) : null;
    const spec = job?.spec_snapshot ?? null;
    const referenceAssets = (job?.request?.inputs ?? []).map((i) => ({ role: i.role, asset: one('SELECT * FROM assets WHERE id = ?', i.asset_id) })).filter((x) => x.asset);
    const report = await runQc({ asset, job, spec, referenceAssets });
    const rid = uid();
    db.prepare('INSERT INTO qc_reports (id, project_id, asset_id, job_id, report_json, created_at) VALUES (?,?,?,?,?,?)').run(rid, asset.project_id, asset.id, job?.id ?? null, JSON.stringify(report), now());
    return [201, { id: rid, ...report }];
  });
  r.get('/api/projects/:id/qc', ({ id }) => all('SELECT * FROM qc_reports WHERE project_id = ? ORDER BY created_at DESC LIMIT 200', id));
  r.post('/api/compare', async (_p, _q, b) => {
    const a = must(one('SELECT * FROM assets WHERE id = ?', b.a), 'asset a');
    const c = must(one('SELECT * FROM assets WHERE id = ?', b.b), 'asset b');
    return compareVersions(a, c);
  });

  // ------------------------------------------------------------ shot revision (new version, keeps the old one)
  r.post('/api/shots/:id/revise', ({ id }, _q, b) => {
    const s = must(one('SELECT * FROM shots WHERE id = ?', id), 'shot');
    const spec = deepMerge(s.spec, b.changes ?? {});
    if (b.note) spec.revision_note = b.note;
    db.prepare('UPDATE shots SET spec_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(spec), now(), id);
    const parent = s.selected_job_id;
    const plan = planGeneration(db, providers, { shotId: id, providerId: b.provider, model: b.model });
    const { job, duplicate } = createJob(db, plan, { parentJobId: parent });
    runner.tick();
    return [201, { job, duplicate, previous_job_id: parent }];
  });

  // ------------------------------------------------------------ NLE export (Resolve: File > Import > Timeline)
  r.get('/api/projects/:id/export/:format', ({ id, format }, q, _b, req, res) => {
    const p = must(one('SELECT * FROM projects WHERE id = ?', id), 'project');
    const sceneFilter = q.get('scene_id');
    const rows = db.prepare(`SELECT s.title AS shot_title, sc.heading AS scene_heading, j.id AS job_id, a.path AS file, a.meta_json
        FROM shots s JOIN scenes sc ON sc.id = s.scene_id JOIN jobs j ON j.id = s.selected_job_id JOIN assets a ON a.id = j.output_asset_id
        WHERE s.project_id = ? ${sceneFilter ? 'AND s.scene_id = ?' : ''} ORDER BY sc.idx, s.idx`).all(...[id, sceneFilter].filter(Boolean))
      .map((x) => { const m = JSON.parse(x.meta_json); return { ...x, duration_s: m.duration_s ?? 5, fps: m.video?.fps ?? 24, width: m.video?.width, height: m.video?.height, has_audio: !!m.audio }; });
    if (!rows.length) { res.writeHead(409, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'no shots with a selected generation to export' })); }
    const title = p.name;
    const fps = Math.round(rows[0].fps) || 24;
    const body = format === 'edl' ? edl(title, rows, fps) : format === 'fcpxml' ? fcpxml(title, rows, { fps, width: rows[0].width ?? 1920, height: rows[0].height ?? 1080 }) : format === 'otio' ? otio(title, rows, fps) : null;
    if (body == null) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'format must be edl, fcpxml or otio' })); }
    const ext = { edl: 'edl', fcpxml: 'fcpxml', otio: 'otio' }[format];
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${title.replace(/[^\w-]+/g, '_')}.${ext}"` });
    res.end(body);
  }, { raw: true });
}

function stripVolatile(data) {
  const { intent, dialogue, references, subjects, timeline, seed, ...rest } = data;
  return rest; // presets carry look/camera/lens/light only, never story content
}
