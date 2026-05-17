# Contact Detection Logic And Fallbacks

This document describes the current contact detection flow implemented in `backend/src/services/contactDetection.js`.

When logic changes in that file, update this document in the same change.

## Scope

- Primary target: tennis serve contact frame detection.
- Main inputs:
  - `racketTrack` (per-frame fused racket proxy points; currently pose wrist proxy for contact detection)
  - `poseTrack` (per-frame pose landmarks; used for serve arm plausibility checks)
  - `fps`, `width`, `height`
  - `context`: `strokeType`, `handedness`, `courtSide`
  - optional `audioPeaks` and `detectionOptions`

Ball tracks may still be generated and visualized for debugging, but serve contact detection no longer consumes ball position, ball-racket distance, ball velocity, or ball-derived confidence scoring.

## Tracking Inputs

Track generation now runs two detection passes for fresh `*.tracks.json` sidecars:

1. Pose/OpenCV pass (`backend/src/scripts/auto_track.py`)
- Produces `poseTrack`, pose wrist proxy racket points, and OpenCV/Hough ball candidates.
- Preserved in sidecars as `poseRacketTrack` and `houghBallTrack` after object augmentation.

2. CourtSide YOLO object pass (`backend/src/scripts/object_track.py`)
- Uses the pretrained Ultralytics model `Davidsv/CourtSide-Computer-Vision-v1` by default.
- Reads the pose sidecar and runs object detection for `tennis_ball` and `racket`.
- Selects the racket candidate using confidence plus proximity to the hitting wrist and previous racket point.
- Writes raw object detections and diagnostics to:
  - `objectDetections`
  - `objectFrameDiagnostics`
  - `objectBallTrack`
  - `objectRacketTrack`
  - `objectDetectorMeta`

The object pass always writes raw YOLO tracks, but the canonical tracks consumed by contact detection are source-configurable:

- `ballTrack`: controlled by `tracking.objectBallSource`.
  - `hough`: OpenCV/Hough ball point only. This is the current ball-control experiment default.
  - `yolo`: YOLO ball point only.
  - `yolo_fallback_hough`: YOLO ball point when available, otherwise OpenCV/Hough ball point.
- `racketTrack`: controlled by `tracking.objectRacketSource`.
  - `pose`: pose wrist proxy only. This is the current ball-control experiment default.
  - `yolo`: YOLO racket point only.
  - `yolo_fallback_pose`: YOLO racket point when available, otherwise pose wrist proxy.
- `poseTrack`: always retained as the serve/body phase signal.

Current contact-detection policy:

- `detection.useBallForContact=false`.
- Ball tracks are ignored by serve contact detection.
- The active serve path is pose/racket apex detection plus optional audio assist.
- Ball-guided toss windows, ball-racket distance scoring, and ball velocity scoring remain in legacy code only for explicitly re-enabling experiments.

## High-Level Flow

1. Validate tracks.
- In the active serve path, require only `racketTrack`.
- If `racketTrack` is missing/empty, return `found: false`, reason `missing_racket_track_data`.

2. Resolve profile/options.
- `isRightHandServeAdSide` is true for `serve + right + ad`.
- `useBallForContact=false` in current config, so serve detection bypasses all ball-guided logic.
- `audioAssistEnabled` only applies for serves.
- `minContactConfidence=0.55` is the final acceptance threshold used by app processing; candidates below it are reported as not found instead of being shown as contact points.

3. Pose/racket primary branch.
- If `strokeType=serve` and `useBallForContact=false`:
  - Run `detectRacketApexFallback`.
  - Optionally apply local audio-based frame shift around the pose/racket frame.
  - Return diagnostics `path: pose_primary`.

4. Legacy ball-guided branch (disabled by current config).
- Run `detectServeTossWindow`.
- If toss window fails:
  - Try `detectRacketApexFallback`.
  - If not left-handed serve, then try `detectLatePhaseBallRacketFallback`.
  - Return failure with toss-window reason if no fallback succeeds.

5. Legacy ball-guided search window.
- Start from toss window (`mode: toss_window`).
- Low/very-low toss handling can move `windowStart` later and optionally narrow around a racket apex candidate from `selectServeApexWindow`.
- Right-handed ad-side serves tighten `windowEnd` near toss apex.

6. Legacy ball-guided scoring.
- For each valid frame with both ball and racket:
  - Serve-only hard gate: reject frames where pose indicates the hitting arm is clearly hanging down (`armRejectedCandidates`).
  - `distScore`: relative+absolute ball-racket distance.
  - `velScore`: local ball velocity-change proxy.
  - `temporalScore`: Gaussian prior around expected contact after apex.
  - `racketHeightScore`: relative racket height in window.
  - `serveArmScore`: pose-based arm-elevation plausibility score.
  - Ad-side only: `positionGateScore` penalizes implausible low ball Y.
  - Optional audio blend within phase-gated interval.

7. Select best frame and compute confidence.
- Choose frame with max combined score.
- Confidence is geometry-based score (plus limited audio contribution).
- Damp confidence near clip edges.
- Internal branch-level guards still reject clearly weak candidates around `0.35`.
- Final app-level acceptance requires confidence >= `minContactConfidence` (`0.55` in current config). If a lower-confidence frame was selected, the event is converted to `found: false`, `reason: low_confidence_no_contact`, and diagnostics keep the rejected frame/timestamp/confidence.

8. Plausibility reroutes.
- If serve result is implausibly early (`<30%` clip), switch to late-phase fallback when available (`switchedFrom: implausibly_early_toss_window_pick`).
- If right-handed ad-side and min distance is weak (`>150`), switch to pose fallback (`switchedFrom: weak_ball_racket_proximity_ad_side`).

9. Return final event.
- `frame`, `timestampMs`, `confidence`, and `diagnostics`.
- Missing/low-confidence events include `noDetectionTag`:
  - `no_contact` when a candidate exists but is too weak or no reliable contact point is available.
  - `no_serve` when serve-phase evidence such as toss/track/apex data is missing.

## Detailed Components

### `detectServeTossWindow`

Goal: find a plausible serve phase around toss apex.

Key rules:
- Smooth ball Y (radius 2).
- Need at least 12 valid smoothed points.
- Scan for apex in early-to-mid clip (`5%` to `85%`), with guard against noisy late apex (`>75%`).
- Compute baseline Y from early frames (`q60`).
- Require toss magnitude:
  - `tossMagnitude = baselineY - apexY`
  - minimum = `max(20 px, 0.04 * frameHeight)`.
- Toss start threshold at `baselineY - 0.2 * tossMagnitude`.
- Window:
  - start near apex (`apexIdx - 0.08s`) but not before toss start.
  - end at `apexIdx + 0.9s`.

Failure reasons include:
- `insufficient_ball_track`
- `no_apex_detected`
- `no_baseline_detected`
- `toss_not_detected`
- `invalid_toss_window`

### `selectServeApexWindow`

Used only for very-low toss clips to tighten toss window around racket apex behavior.

Candidate requirements:
- Local Y minimum on smoothed racket Y.
- Sufficient extension/recovery against local context.

Scores:
- `heightScore` (higher racket extension)
- `laterScore` (later in current window)
- `verticalScore` (more vertical move)
- Combined: `0.45*height + 0.35*later + 0.20*vertical`.

Outputs narrowed window around selected apex.

### `detectRacketApexFallback`

Pose-only fallback based on racket track shape in late serve phase.

Window profile:
- Uses handedness and aspect ratio to set start/end/center fractions.
- Trims quiet tail by motion threshold:
  - `motionThreshold = max(2, 0.015 * yRange)`.

Primary branch: extension/recovery candidates.
- Requires:
  - `extension >= max(6, 0.08*yRange)`
  - `recovery >= max(6, 0.06*yRange)`
  - Serve-arm plausibility gate: reject frames where hitting arm is clearly hanging down.
- Combined score:
  - `0.33*ext + 0.20*rec + 0.12*temporal + 0.25*apexHeight + 0.10*serveArm`
- Mode: `pose_extension_primary`.

Secondary branch: apex-only candidates.
- Combined score:
  - `0.60*height + 0.25*temporal + 0.15*serveArm`
- Mode: `pose_apex_secondary`.

Left-handed tie-break:
- Prefer earlier candidate within small score tolerance.

### `detectLatePhaseBallRacketFallback`

Distance-based fallback in generic late serve phase when toss modeling is not trusted.

Window:
- `55%` to `95%` of clip.
- Expected center around `70%` of this window.

Score:
- `0.65*dist + 0.25*vel + 0.10*temporal`
- Confidence:
  - `0.70*dist + 0.20*vel + 0.10*temporal`
- Must be >= `0.35`.

Mode: `ball_late_phase_secondary`.

### Audio assist (`audioScoreAtFrame`)

Used as a bounded helper, never full override.

Per-frame audio score in local window (default `45 ms`):
- Blend of peak strength and temporal proximity:
  - `0.65*strength + 0.35*distanceScore`.

Main flow gating:
- Serve only.
- Peaks restricted to plausible serve-contact phase after apex.
- Effective weight gated by temporal plausibility and after-apex condition.

Ball-disabled branch:
- Can shift pose-only result in local neighborhood if audio score is strong (`>=0.40`).

## Diagnostic Modes / Switch Tags

Common `diagnostics.mode` values:
- `pose_extension_primary`
- `pose_apex_secondary`
- `ball_late_phase_secondary` (legacy disabled branch)
- (legacy main toss-window path has no explicit named mode)

Common switch/fallback tags:
- `fallbackFrom: <toss_window_failure_reason>`
- `switchedFrom: ball_disabled_pose_primary` / `path: pose_primary`
- `switchedFrom: implausibly_early_toss_window_pick` (legacy disabled branch)
- `switchedFrom: weak_ball_racket_proximity_ad_side` (legacy disabled branch)
- `reason: low_confidence_no_contact`
- `noDetectionTag: no_contact`
- `noDetectionTag: no_serve`

Additional path tag:
- `path: pose_primary` when serve detection runs in default pose-first mode (`useBallForContact=false`).

## Current Behavior Notes

- `earlyBiasFrames` is currently `0` (disabled).
- `audioAssistWeight` defaults from options and is clamped.
- Internal branch-level confidence guards still use `0.35` for clearly invalid candidates.
- Final app-level acceptance threshold is `minContactConfidence=0.55`; this prevents every clip/window from displaying a contact marker merely because the scorer can rank a best available frame.
- Ball tracking is intentionally excluded from serve contact detection because the observed YOLO/Hough ball tracks are not reliable enough for model decisions.
- Pro diagnostics use the same detector output as user video processing, but curated pro clips with manual ground truth treat `found: false` as a missed detection. The summary keeps those clips in `evaluatedWithGroundTruth`, increments `missedDetections`, and assigns a miss penalty equal to the clip frame count for aggregate error metrics.
- Tracker-side motion fallback is subject-gated: if subject gate is closed (`allowPoseTrack=false`), motion fallback no longer injects racket points.
- Fresh track generation attempts both the MediaPipe/OpenCV pose pass and the CourtSide YOLO object pass. If the YOLO runtime/model is unavailable, the sidecar records `objectRuntimeAvailable: false`; with the default retry setting, freshness checks keep treating that sidecar as needing regeneration so installing the dependency/model can upgrade it without a code change.
- Tracker cache freshness includes the object detector model and configured canonical source modes (`tracking.objectBallSource`, `tracking.objectRacketSource`) so changing lanes regenerates sidecars.

## Update Rule

Any change to:
- scoring weights
- thresholds
- mode selection
- fallback ordering
- diagnostic tags

must be reflected in this document in the same PR/change.
