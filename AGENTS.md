# Detection Workflow Policy

This repository requires a full refresh + evaluation cycle for any detection logic changes.

## Mandatory Rule

If a change touches detection/tracking, use tiered cache invalidation and only clear what is necessary:

1. Detection-only logic change (for example `backend/src/services/contactDetection.js`):
   - Run only: `GET /api/debug/pro-detections?refresh=1`
   - Do not clear derived tracks.
2. Tracker-generation change (for example `backend/src/scripts/auto_track.py`, `backend/src/services/trackingService.js`):
   - Clear only affected derived track artifacts (`*.tracks.json` / related tracker sidecars) for impacted videos.
   - Then run: `GET /api/debug/pro-detections?refresh=1`
3. Label-only change:
   - Run only: `GET /api/debug/pro-detections?refresh=1`
4. Use broad clear (`POST /api/debug/clear-derived`) only when explicitly needed or when the scope is uncertain.

After any change to detection or tracker generation logic, ask the user:

- "Do you want to tag this version?"

If yes, create a detection run snapshot with `logicVersion` and optional `notes`, and ask whether to mark it as stable.

Detection/tracking behavior includes (non-exhaustive):

- `backend/src/services/contactDetection.js`
- `backend/src/scripts/auto_track.py`
- `backend/src/services/trackingService.js`
- Detection-related config in `backend/config/pro_videos.json`
- Any code that changes generated tracks, audio peaks, or contact-frame scoring

## Required Chat Report

After the API flow above, report:

- Cache-clear confirmation (deleted counts)
- Overall summary metrics in frames only (no ms)
- Per-set summary metrics in frames only (`core`, `edge`, etc.)
- Per-video outcomes in frames only (detected frame, ground-truth frame, abs error, confidence)
- Any failed videos or regeneration errors
- Change vs previous detection run (delta) in a table format

Delta table format requirements:

- Default comparison target is the stable detection run baseline.
- If user asks to compare to "latest", use the latest run baseline (not latest stable).
- If no stable baseline exists, compare against the most recent prior run and state that fallback.
- Always show explicit `before -> after` values sourced from stored runs (not only deltas), for overall + per-set + key clips discussed.
- Include at minimum: `meanAbsErrorFrames`, `maxAbsErrorFrames`, and `evaluatedWithGroundTruth` (overall and per set)
- Include per-video `absErrorFrames` delta where ground truth exists
- Use compact emoji status markers for deltas:
  - `🟢 improved` when error decreases
  - `🔴 worse` when error increases
  - `⚪ unchanged` when equal

Do not describe technical execution steps for this workflow unless explicitly requested.

## Detection Documentation Requirement

The contact detection spec must stay synchronized with implementation:

- Source of truth doc: `docs/detection-logic.md`
- Implementation file: `backend/src/services/contactDetection.js`

Any change to detection steps, thresholds, scoring weights, fallback order, or diagnostics tags must include a matching update to `docs/detection-logic.md` in the same change.

## Cache/Artifact Freshness Requirement

The API refresh flow must remain the source of truth for web-app inputs, while minimizing unnecessary invalidation:

- Clears only required caches/artifacts based on change scope
- Regenerates needed tracks/analysis/diagnostics from current code
- Rewrites `backend/data/processed/pro_diagnostics.latest.json`

Do not rely on stale sidecars after detection logic changes.

## Versioning Workflow (Non-Git)

- Do not rely on assistant memory for rollback points.
- Use detection run snapshots as the project-local version history for detection experiments.
- Stable versions are explicitly user-selected by marking a run as stable.
- Feature exploration runs must be tagged as `feature-branch` and must not change stable unless explicitly requested in a separate step.
- Support future parallel exploration by allowing separate experiment lanes/groups (generic, not tied to any specific library/tool).

## Future Reminder Rule

- If debugging/evaluation would benefit from visual before/after comparison (for example ambiguous clips, outliers, regressions, or refactor validation), remind the user about the planned feature:
  - historical diagnostics + track playback compare across runs.
