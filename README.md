# AI Tennis Compare (Serve v1 Prototype)

Server-side prototype for comparing one amateur serve video against a pro reference clip.

## What v1 does

- Upload one amateur serve video (`mp4`, `mov`, `webm`)
- Select pro serve from config-driven YouTube sources
- Optional mode: compare one pro clip against another pro clip (no upload)
- Optional mode: reuse a previously uploaded file without uploading again
- Download pro source video on-demand via `yt-dlp` (deduplicated by YouTube URL), then extract per-pro clips by configured timestamps
- Re-encode pro clips for smooth/frame-accurate scrubbing (`720p60`, all-I frames)
- Run server-side auto-tracking for:
  - ball center (OpenCV)
  - racket proxy (MediaPipe wrist/arm-chain with full-body subject lock + late-phase no-switch + fallback motion proxy)
- Detect one event (`ball contact`) via heuristic:
  - minimum ball-to-racket distance
  - ball velocity-change confidence boost
- Align playback by contact offset
- Scrubbable side-by-side comparison in browser
- Persist sessions locally and show global session list

## Important v1 limitations

- Auto-tracking quality depends on video quality, camera angle, and visibility.
- Right-handed assumption for wrist-based racket proxy.
- Generated tracks are cached to sidecar files:
  - `<video>.tracks.json` (auto-generated)
  - you can still provide this file manually to override tracking if needed.
- Sidecar format:

```json
{
  "ballTrack": [{ "x": 100, "y": 220 }, { "x": 104, "y": 216 }],
  "racketTrack": [{ "x": 140, "y": 210 }, { "x": 145, "y": 208 }]
}
```

If tracking fails, event detection returns `not_found`.

## Config

Edit `backend/config/pro_videos.json`:

- `maxUploadSeconds` (default `10`)
- `defaultOutput` (`16:9`, `1280x720`, `60fps`)
- `proVideos[]` entries (YouTube URL + timestamps)

If you change `startTime`/`endTime` for a pro entry, that clip is automatically regenerated on next use.

## Run

1. Install deps:

```bash
npm install
```

2. Install system tools:

```bash
brew install ffmpeg yt-dlp
```

3. Install Python deps (for server-side tracking):

```bash
python3 -m pip install -r backend/requirements.txt
```

4. Optional: pre-ingest pro clips:

```bash
npm run ingest:pros
```

5. Start backend:

```bash
npm run dev:backend
```

`dev:backend` uses `PYTHON_BIN=../.venv/bin/python` by default so tracking runs from your repo-level virtualenv.

6. Start frontend:

```bash
npm run dev:frontend
```

## API summary

- `GET /api/pro-videos`
- `GET /api/uploads`
- `POST /api/upload` (multipart: `video`, `proVideoId`)
- `POST /api/compare-upload` (json: `uploadFileName`, `proVideoId`)
- `POST /api/compare-pros` (json: `amateurProVideoId`, `proVideoId`)
- `GET /api/sessions`
- `GET /api/sessions/:id`
- `POST /api/sessions/:id/recalculate` (re-run detection/alignment with latest generation logic)
- `GET /api/debug/pro-detections` (run + return detection diagnostics for all pro videos)
  - when diagnostics are regenerated, an auto detection-run snapshot is created (deduplicated if identical to latest auto run)
- `GET /api/debug/refresh-status` (check whether clips/tracks/audio caches need regeneration)
- `POST /api/debug/refresh-all` (one-shot regenerate-needed flow + diagnostics refresh)
- `POST /api/debug/pro-detections/runs` (create versioned detection run snapshot; optional stable baseline update)
- `GET /api/debug/pro-detection-runs` (list versioned runs + current stable run id)
- `GET /api/debug/pro-detection-runs/:runId` (get one run snapshot)
- `POST /api/debug/pro-detection-runs/:runId/stable` (set stable baseline run)
- `POST /api/debug/pro-videos` (append to `pro_videos.json` and enqueue async processing)
- `GET /api/debug/pro-videos/jobs` (list async processing jobs)
- `GET /api/debug/pro-videos/jobs/:jobId` (single async processing job status)
- `POST /api/debug/clear-derived` (keep input videos, clear tracks/analysis/sessions)
- `POST /api/debug/clear-caches` (full clear, including input videos)

## Chrome Extension (YouTube Clip Capture)

A standalone extension lives in:

- `youtube-pro-capture-extension/`

It opens a side panel on youtube.com and saves clip metadata to:

- `POST /api/debug/pro-videos`

Load it in Chrome:

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select `youtube-pro-capture-extension`

## Refresh And Cache Guide

For exact refresh behavior, cache invalidation, and "which change needs which trigger", see:

- `docs/refresh-and-cache-workflow.md`

## Detection Logic Guide

For the current contact-detection pipeline, fallback ordering, thresholds, and scoring criteria, see:

- `docs/detection-logic.md`

## TODOs queued

- Handedness support (left/right matching)
- User-friendly `event_not_found` UX
- Event jump navigation
- Future normalization mode between first/last event
- Tracks debug endpoint + UI toggle for tracking overlay/diagnostics
- Manual event marker correction UI
- Historical diagnostics + track playback compare (visual A/B across runs)
- Ball detector bake-off: keep CourtSide YOLO for racket tracking, test ball-only YOLO/Roboflow/TrackNet lanes against labeled pro clips
- Scalable storage (object storage + DB)
