#!/usr/bin/env python3
import argparse
import json
import math
import os
from pathlib import Path
import sys

import cv2


TRACKER_VERSION = "pose-yolo-source-modes-v1"


def parse_args():
    parser = argparse.ArgumentParser(description="Augment pose tracks with CourtSide YOLO ball/racket detections")
    parser.add_argument("--video", required=True, help="Input video path")
    parser.add_argument("--tracks", required=True, help="Existing pose tracks sidecar")
    parser.add_argument("--output", required=True, help="Output tracks sidecar")
    parser.add_argument("--model", default="Davidsv/CourtSide-Computer-Vision-v1", help="Ultralytics model id/path")
    parser.add_argument("--conf", type=float, default=0.15, help="YOLO confidence threshold")
    parser.add_argument("--imgsz", type=int, default=960, help="YOLO inference image size")
    parser.add_argument("--wrist-hand", default="right", choices=["right", "left"], help="Hitting wrist hand")
    parser.add_argument(
        "--ball-source",
        default="yolo_fallback_hough",
        choices=["hough", "yolo", "yolo_fallback_hough"],
        help="Canonical ballTrack source",
    )
    parser.add_argument(
        "--racket-source",
        default="yolo_fallback_pose",
        choices=["pose", "yolo", "yolo_fallback_pose"],
        help="Canonical racketTrack source",
    )
    return parser.parse_args()


def load_tracks(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def write_tracks(path, payload):
    out_dir = os.path.dirname(path)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f)


def repo_root():
    return Path(__file__).resolve().parents[2]


def resolve_model_path(model_ref):
    raw = str(model_ref or "").strip()
    if not raw:
        return raw
    if raw.startswith(("http://", "https://")):
        return raw
    if os.path.exists(raw):
        return raw
    if raw.endswith(".pt") and os.path.exists(os.path.expanduser(raw)):
        return os.path.expanduser(raw)
    if "/" not in raw:
        return raw

    cache_dir = repo_root() / "data" / "models" / raw.replace("/", "__")
    cache_dir.mkdir(parents=True, exist_ok=True)
    model_path = cache_dir / "model.pt"
    if model_path.exists() and model_path.stat().st_size > 0:
        return str(model_path)

    try:
        from huggingface_hub import hf_hub_download

        downloaded = hf_hub_download(
            repo_id=raw,
            filename="model.pt",
            local_dir=str(cache_dir),
            local_dir_use_symlinks=False,
        )
        return str(downloaded)
    except Exception as err:
        raise RuntimeError(f"model_download_failed: {raw}: {err}")


def dist(a, b):
    if not a or not b:
        return float("inf")
    return math.hypot(float(a["x"]) - float(b["x"]), float(a["y"]) - float(b["y"]))


def center(box):
    x0, y0, x1, y1 = box
    return {"x": float((x0 + x1) * 0.5), "y": float((y0 + y1) * 0.5)}


def box_area(box):
    x0, y0, x1, y1 = box
    return max(0.0, float(x1) - float(x0)) * max(0.0, float(y1) - float(y0))


def normalize_class_name(name):
    return str(name or "").strip().lower().replace("-", "_").replace(" ", "_")


def get_wrist_from_pose(pose_frame, wrist_hand):
    landmarks = pose_frame.get("landmarks") if isinstance(pose_frame, dict) else None
    if not isinstance(landmarks, list):
        return None
    idx = 15 if str(wrist_hand).lower() == "left" else 16
    if idx >= len(landmarks):
        return None
    p = landmarks[idx]
    if not isinstance(p, dict):
        return None
    if float(p.get("v", 0.0) or 0.0) < 0.25:
        return None
    x = float(p.get("x", float("nan")))
    y = float(p.get("y", float("nan")))
    if not math.isfinite(x) or not math.isfinite(y):
        return None
    return {"x": x, "y": y}


def predicted_next(prev, prev_prev, velocity_scale=0.85):
    if not prev or not prev_prev:
        return None
    return {
        "x": float(prev["x"]) + velocity_scale * (float(prev["x"]) - float(prev_prev["x"])),
        "y": float(prev["y"]) + velocity_scale * (float(prev["y"]) - float(prev_prev["y"])),
    }


def compact_detection(det):
    return {
        "className": det["className"],
        "confidence": round(float(det["confidence"]), 4),
        "box": [round(float(v), 2) for v in det["box"]],
        "center": {
            "x": round(float(det["point"]["x"]), 2),
            "y": round(float(det["point"]["y"]), 2),
        },
    }


def pick_ball(candidates, prev, prev_prev, wrist, frame_diag):
    if not candidates:
        return None
    pred = predicted_next(prev, prev_prev)

    def score(det):
        point = det["point"]
        conf = float(det["confidence"])
        area = box_area(det["box"])
        total = 0.0
        weight = 0.0
        if pred:
            total += 0.45 * min(dist(point, pred) / 220.0, 2.0)
            weight += 0.45
        if prev:
            total += 0.25 * min(dist(point, prev) / 180.0, 2.0)
            weight += 0.25
        if wrist:
            total += 0.15 * min(dist(point, wrist) / 420.0, 2.0)
            weight += 0.15
        total += 0.10 * min(area / 2400.0, 2.0)
        total += 0.30 * (1.0 - conf)
        weight += 0.40
        return total / max(weight, 1e-6)

    chosen = min(candidates, key=score)
    frame_diag["ballCandidateCount"] = len(candidates)
    frame_diag["ballConfidence"] = round(float(chosen["confidence"]), 4)
    return chosen


def pick_racket(candidates, wrist, prev):
    if not candidates:
        return None

    def score(det):
        point = det["point"]
        conf = float(det["confidence"])
        total = 0.20 * (1.0 - conf)
        if wrist:
            total += 0.65 * min(dist(point, wrist) / 260.0, 2.0)
        if prev:
            total += 0.15 * min(dist(point, prev) / 220.0, 2.0)
        return total

    return min(candidates, key=score)


def detections_from_result(result, model_names):
    detections = []
    boxes = getattr(result, "boxes", None)
    if boxes is None:
        return detections
    for box in boxes:
        cls_idx = int(box.cls[0])
        class_name = normalize_class_name(model_names.get(cls_idx, str(cls_idx)))
        if class_name not in ("tennis_ball", "ball", "racket", "tennis_racket"):
            continue
        xyxy = [float(v) for v in box.xyxy[0].tolist()]
        conf = float(box.conf[0])
        detections.append({
            "className": "tennis_ball" if class_name in ("tennis_ball", "ball") else "racket",
            "confidence": conf,
            "box": xyxy,
            "point": center(xyxy),
        })
    return detections


def augment_tracks(args):
    try:
        from ultralytics import YOLO
    except Exception as err:
        raise RuntimeError(f"missing_dependency: ultralytics import failed: {err}")

    tracks = load_tracks(args.tracks)
    pose_track = tracks.get("poseTrack") if isinstance(tracks.get("poseTrack"), list) else []
    pose_racket_track = tracks.get("racketTrack") if isinstance(tracks.get("racketTrack"), list) else []
    hough_ball_track = tracks.get("ballTrack") if isinstance(tracks.get("ballTrack"), list) else []

    cap = cv2.VideoCapture(args.video)
    if not cap.isOpened():
        raise RuntimeError(f"could_not_open_video: {args.video}")
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    cap.release()
    total = max(frame_count, len(pose_track), len(pose_racket_track), len(hough_ball_track))

    yolo_ball_track = [None] * total
    yolo_racket_track = [None] * total
    raw_detections = [[] for _ in range(total)]
    frame_diagnostics = [None] * total
    fused_ball_track = [None] * total
    fused_racket_track = [None] * total

    os.environ.setdefault("YOLO_CONFIG_DIR", "/tmp/Ultralytics")
    resolved_model = resolve_model_path(args.model)
    model = YOLO(resolved_model)
    names = getattr(model, "names", {}) or {}
    prev_ball = None
    prev_prev_ball = None
    prev_racket = None

    results = model.predict(
        source=args.video,
        conf=max(0.01, float(args.conf)),
        imgsz=max(320, int(args.imgsz)),
        stream=True,
        verbose=False,
    )

    processed = 0
    for frame_idx, result in enumerate(results):
        if frame_idx >= total:
            break
        processed += 1
        wrist = get_wrist_from_pose(pose_track[frame_idx] if frame_idx < len(pose_track) else None, args.wrist_hand)
        if wrist is None and frame_idx < len(pose_racket_track):
            wrist = pose_racket_track[frame_idx]

        detections = detections_from_result(result, names)
        raw_detections[frame_idx] = [compact_detection(d) for d in detections]
        ball_candidates = [d for d in detections if d["className"] == "tennis_ball"]
        racket_candidates = [d for d in detections if d["className"] == "racket"]
        diag = {
            "rawCount": len(detections),
            "ballCandidateCount": len(ball_candidates),
            "racketCandidateCount": len(racket_candidates),
        }

        hough_ball = hough_ball_track[frame_idx] if frame_idx < len(hough_ball_track) else None
        ball_det = pick_ball(ball_candidates, prev_ball, prev_prev_ball, wrist, diag)
        if ball_det:
            point = ball_det["point"]
            yolo_ball_track[frame_idx] = point
            prev_prev_ball = prev_ball
            prev_ball = point

        if args.ball_source == "hough":
            fused_ball_track[frame_idx] = hough_ball
            diag["ballSource"] = "hough_configured" if hough_ball else "missing"
        elif args.ball_source == "yolo":
            fused_ball_track[frame_idx] = yolo_ball_track[frame_idx]
            diag["ballSource"] = "yolo_configured" if yolo_ball_track[frame_idx] else "missing"
        elif yolo_ball_track[frame_idx]:
            fused_ball_track[frame_idx] = yolo_ball_track[frame_idx]
            diag["ballSource"] = "yolo"
        elif hough_ball:
            fused_ball_track[frame_idx] = hough_ball
            diag["ballSource"] = "hough_fallback"
        else:
            diag["ballSource"] = "missing"

        pose_racket = wrist
        racket_det = pick_racket(racket_candidates, wrist, prev_racket)
        if racket_det:
            point = racket_det["point"]
            yolo_racket_track[frame_idx] = point
            prev_racket = point
            diag["racketConfidence"] = round(float(racket_det["confidence"]), 4)

        if args.racket_source == "pose":
            fused_racket_track[frame_idx] = pose_racket
            diag["racketSource"] = "pose_configured" if pose_racket else "missing"
        elif args.racket_source == "yolo":
            fused_racket_track[frame_idx] = yolo_racket_track[frame_idx]
            diag["racketSource"] = "yolo_configured" if yolo_racket_track[frame_idx] else "missing"
        elif yolo_racket_track[frame_idx]:
            fused_racket_track[frame_idx] = yolo_racket_track[frame_idx]
            diag["racketSource"] = "yolo"
        elif pose_racket:
            fused_racket_track[frame_idx] = pose_racket
            diag["racketSource"] = "pose_fallback"
        else:
            diag["racketSource"] = "missing"

        frame_diagnostics[frame_idx] = diag

    # Preserve existing fallback tracks if OpenCV reports fewer frames than the sidecar.
    for i in range(processed, total):
        if i < len(hough_ball_track):
            fused_ball_track[i] = hough_ball_track[i]
        if i < len(pose_racket_track):
            fused_racket_track[i] = pose_racket_track[i]

    ball_yolo_count = sum(1 for p in yolo_ball_track if p)
    racket_yolo_count = sum(1 for p in yolo_racket_track if p)
    tracks["ballTrack"] = fused_ball_track
    tracks["racketTrack"] = fused_racket_track
    tracks["objectBallTrack"] = yolo_ball_track
    tracks["objectRacketTrack"] = yolo_racket_track
    tracks["poseRacketTrack"] = pose_racket_track
    tracks["houghBallTrack"] = hough_ball_track
    tracks["objectDetections"] = raw_detections
    tracks["objectFrameDiagnostics"] = frame_diagnostics
    tracks["objectRuntimeAvailable"] = True
    tracks["objectRuntimeError"] = None
    tracks["objectDetectorMeta"] = {
        "enabled": True,
        "model": args.model,
        "resolvedModel": resolved_model,
        "confidence": float(args.conf),
        "imageSize": int(args.imgsz),
        "classNames": {str(k): v for k, v in dict(names).items()},
        "processedFrames": int(processed),
        "totalFrames": int(total),
        "ballYoloFrames": int(ball_yolo_count),
        "racketYoloFrames": int(racket_yolo_count),
        "ballSource": args.ball_source,
        "racketSource": args.racket_source,
    }
    tracks["trackerMeta"] = {
        **(tracks.get("trackerMeta") or {}),
        "wristHand": str(args.wrist_hand).lower(),
        "version": TRACKER_VERSION,
        "objectDetectorEnabled": True,
        "objectDetectorModel": args.model,
        "objectBallSource": args.ball_source,
        "objectRacketSource": args.racket_source,
    }
    return tracks


def main():
    args = parse_args()
    tracks = augment_tracks(args)
    write_tracks(args.output, tracks)


if __name__ == "__main__":
    try:
        main()
    except Exception as err:
        print(str(err), file=sys.stderr)
        sys.exit(1)
