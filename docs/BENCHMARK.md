# Benchmark protocol (vs Higgsfield) — results PENDING

**Status (2026-10-18): no comparative results exist.** No live Seedance generation has been run (no credentials /
activation yet) and no Higgsfield generations were made (no account use authorised). Nothing below is a result.
Do not claim parity or superiority until this protocol has been run and the raw outputs are archived.

## Conditions
- Same underlying model where possible (Higgsfield Cinema Studio routes to Seedance 2.5 per public pages — INFERRED,
  verify per run in their UI), same resolution (720p for cost), same duration, same aspect, same reference assets
  (only assets we have rights to; no real faces unless authorised).
- 3 generations per brief per platform (variance), fixed order, same day.
- Record model/version strings shown by each platform.

## Briefs (`docs/benchmarks/briefs.json`)
1. Static dialogue close-up with one character reference (identity + framing).
2. Slow push-in, low-key Rembrandt light, 85 mm look (camera + light adherence).
3. Walk-and-talk tracking shot, two characters (motion + continuity).
4. Product hero orbit with one product reference (object fidelity).
5. Three-shot mini-scene with continuity (wardrobe, location, light across shots).
6. Reference recreation of a 3-cut, 10 s reference edit (structure + timing).
7. Object swap on a 6 s clip (preservation of unaffected areas).

## Measures
| Measure | How | Type |
|---|---|---|
| Prompt/control adherence | Blind 1–5 rating per control (framing, move, light, look) by Harry | Subjective, blind |
| Identity / object consistency | Blind 1–5 vs reference; plus first-frame SSIM where applicable | Subjective + heuristic |
| Camera motion accuracy | Blind 1–5: did the specified move happen, direction, speed | Subjective |
| Temporal stability | QC flicker spikes, unintended cuts, black frames | Measured |
| Preservation (edits) | SSIM source vs result outside the edited region (masked) | Measured |
| Generations per accepted shot | Count until Harry accepts | Measured |
| Cost per accepted shot | Sum of actual billed USD / accepted shots | Measured |
| Time and actions | Wall-clock + UI actions from brief to accepted shot (screen recording) | Measured |

## Procedure in this app
1. Create project "Benchmark YYYY-MM-DD", import briefs as shots.
2. Generate with `seedance`; approve each cost explicitly; keep all takes.
3. Run QC on every take; export QC JSON (`GET /api/projects/:id/qc`).
4. Rate blind (file names hashed) — ratings sheet in `docs/benchmarks/ratings-template.csv`.
5. Archive outputs + QC + ratings under `docs/benchmarks/runs/<date>/`.

## Expected structural differences (to report, not to score)
Higgsfield has trained identities (Soul ID), in-house models and a post grade panel; this app has explicit
control reporting, budgets/approval, idempotent jobs, inheritance, QC and NLE export. Model quality differences are
the model's, not the app's — compare orchestration outcomes (generations, cost, time per accepted shot) separately.
