# Refresh And Cache Workflow

This document is the source of truth for what gets generated, what is cached, and which refresh action to run after each type of change.

When workflow behavior changes, update this file in the same change.

## Generated Artifacts

| Artifact | Path pattern | Produced by | Regenerated when |
|---|---|---|---|
| Pro source video | `backend/data/pros_sources/src-<hash>.mp4` | `downloadYoutubeSource` (`yt-dlp`) | Missing, invalid, or source sanity check fails |
| Pro normalized clip | `backend/data/pros/<id>.mp4` | `ensureProVideoAvailable` / ffmpeg extract | Clip missing, invalid, metadata mismatch (`clip-meta-v*`) |
| Pro clip meta + QC | `backend/data/pros/<id>.mp4.meta.json` | Pro clip generation | Regenerated with clip |
| Pro normalized marker | `backend/data/pros/<id>.mp4.normalized.v2` | Pro clip generation | Regenerated with clip |
| Tracks cache | `*.tracks.json` | `getOrCreateTracks` (`auto_track.py` + `object_track.py`) | Missing, legacy, config/version mismatch, object detector unavailable retry |
| Audio peaks cache | `*.audio_peaks.json` | `getOrCreateAudioPeaks` | Missing or audio cache version mismatch |
| Pro diagnostics cache | `backend/data/processed/pro_diagnostics.latest.json` | `GET /api/debug/pro-detections` | `refresh=1`, signature mismatch, or file removed |
| Detection run history snapshots | `backend/data/processed/detection_runs/*.json` + `index.json` | auto-created when diagnostics are regenerated; manual tagging via runs endpoint | On regenerated diagnostics (auto, deduped) or explicit run creation |
| Session analysis | `backend/data/processed/<session>.analysis.json` | compare/recalculate flow | New compare/recalculate run |
| Session metadata | `backend/data/sessions/*.json` | compare/recalculate flow | New compare/recalculate run |

## Refresh Actions

| Action | What it does | What it does not do |
|---|---|---|
| `GET /api/debug/pro-detections` | Returns diagnostics; uses cache if signature matches | Does not force regeneration |
| `GET /api/debug/pro-detections` (when diagnostics source is `generated`) | Auto-creates a detection run history snapshot (`runType=auto`) unless identical to latest auto snapshot | Does not mark stable automatically |
| `GET /api/debug/pro-detections?refresh=1` | Forces diagnostics rebuild; ensures clips/tracks/audio exist on demand | Does not wipe source videos |
| `GET /api/debug/refresh-status` | Non-destructive freshness check for clip/tracks/audio per pro video | Does not regenerate data |
| `POST /api/debug/refresh-all` | One-shot regenerate-needed flow; runs full diagnostics refresh and returns before/after freshness summary | Does not force destructive cache clear |
| `POST /api/debug/pro-detections/runs` | Creates an explicit detection run snapshot (optionally marks stable) | Does not replace/remove auto snapshots |
| `POST /api/debug/pro-videos` | Appends config entry and enqueues async processing job | Does not block until all jobs finish |
| `GET /api/debug/pro-videos/jobs` | Shows job queue/results | No regeneration by itself |
| `POST /api/debug/pro-videos/:id/player` | Updates `playerName` (and optional handedness) in config | No direct clip/tracks deletion |
| `POST /api/debug/clear-derived` | Clears derived artifacts: tracks/audio peaks/processed/sessions/debug frames and pro normalized markers | Keeps uploaded videos, pro clips, and pro source files |
| `POST /api/debug/clear-caches` | Full clear including pro clips and pro sources | Nothing is preserved except config/code |
| `npm run ingest:pros` | Pre-download/pre-generate pro clips only | Does not create diagnostics/tracks for all clips |

## Minimal Trigger By Change Type

| Change type | Required action |
|---|---|
| Contact detection logic (`contactDetection.js`) | `GET /api/debug/pro-detections?refresh=1` |
| Tracking logic (`auto_track.py`, `object_track.py`, `trackingService.js`) | Clear impacted `*.tracks.json` or run `POST /api/debug/clear-derived`, then `GET /api/debug/pro-detections?refresh=1` |
| Audio peak logic (`audioAnalysis.js`) | Clear impacted `*.audio_peaks.json` or run `POST /api/debug/clear-derived`, then `GET /api/debug/pro-detections?refresh=1` |
| Clip extraction/transcode logic (`proLibrary.js`) | Bump clip meta version if behavior changed, then `GET /api/debug/pro-detections?refresh=1` |
| Source download strategy (`ytdlp.js`) | Re-fetch affected source(s): remove affected `pros_sources/src-*.mp4` or run `POST /api/debug/clear-caches`, then regenerate via diagnostics |
| Pro clip config timestamps/URL/output | `GET /api/debug/pro-detections?refresh=1` (clip meta mismatch triggers regen) |
| Player/camera/court labels only | `GET /api/debug/pro-detections` is enough; `refresh=1` optional |
| Frontend-only changes | No backend cache clear needed |

## Cache Version Levers

Use explicit version keys to trigger safe regeneration when behavior changes:

- Pro clip format/extraction: `CLIP_META_VERSION` in `backend/src/services/proLibrary.js`
- Track generation schema/behavior: `TRACKER_CACHE_VERSION` in `backend/src/services/trackingService.js`
- Audio peak extraction schema/behavior: `AUDIO_CACHE_VERSION` in `backend/src/services/audioAnalysis.js`

If you change behavior but do not bump the matching version, old sidecars may be reused.

## Detection Run History Notes

- `backend/data/processed/pro_diagnostics.latest.json` is still a moving latest file.
- Persistent run history lives in `backend/data/processed/detection_runs/`.
- Auto snapshots are deduplicated against the newest auto run using:
  - logic fingerprint
  - generation version
  - pro-videos signature
  - diagnostics fingerprint
- Auto retention keeps the newest 120 auto snapshots; stable runs are preserved.

## Typical Workflows

### Add new pro clips (extension)
1. Save clips via extension (`POST /api/debug/pro-videos`).
2. Wait for async jobs to complete (`GET /api/debug/pro-videos/jobs`).
3. Open Lab and run `GET /api/debug/pro-detections?refresh=1` once for full consistency report.

### Detection iteration
1. Change detection/tracking/audio logic.
2. Run minimal clear needed (see matrix).
3. Run `GET /api/debug/pro-detections?refresh=1`.
4. Review per-clip QC and error deltas.

### Lab one-button refresh
1. Open Lab page.
2. Lab auto-checks freshness (`GET /api/debug/refresh-status`).
3. If needed, Lab auto-runs `POST /api/debug/refresh-all`.
4. Lab then loads diagnostics and shows status "everything is up to date".

### Recover from suspicious source media
1. If clips look audio-only/black for one URL, remove affected source `src-<hash>.mp4`.
2. Re-run diagnostics with `refresh=1` to force fresh download and clip regeneration.
