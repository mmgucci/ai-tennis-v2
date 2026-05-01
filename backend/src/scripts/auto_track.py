#!/usr/bin/env python3
import argparse
import json
import math
import os
import sys

import cv2
import numpy as np


def parse_args():
    parser = argparse.ArgumentParser(description="Auto-track tennis ball and racket proxy")
    parser.add_argument("--video", required=True, help="Input video path")
    parser.add_argument("--output", required=True, help="Output tracks json path")
    parser.add_argument(
        "--wrist-hand",
        default="right",
        choices=["right", "left"],
        help="Select pose wrist landmark to use as racket proxy",
    )
    return parser.parse_args()


def center_of_bbox(x, y, w, h):
    return {"x": float(x + w / 2.0), "y": float(y + h / 2.0)}


def dist(a, b):
    return math.hypot(a["x"] - b["x"], a["y"] - b["y"])


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def preprocess_ball_channel(gray):
    # Improve local contrast for low-contrast ball/background scenarios.
    clahe = cv2.createCLAHE(clipLimit=2.2, tileGridSize=(8, 8))
    enhanced = clahe.apply(gray)
    blur = cv2.GaussianBlur(enhanced, (5, 5), 1.2)
    return blur


def detect_circles(gray):
    return cv2.HoughCircles(
        gray,
        cv2.HOUGH_GRADIENT,
        dp=1.2,
        minDist=10,
        param1=90,
        param2=13,
        minRadius=2,
        maxRadius=14,
    )


def detect_ball_candidates(frame, roi=None):
    h, w = frame.shape[:2]
    x0, y0, x1, y1 = 0, 0, w, h
    if roi is not None:
        x0 = int(clamp(roi["x0"], 0, w))
        y0 = int(clamp(roi["y0"], 0, h))
        x1 = int(clamp(roi["x1"], x0 + 1, w))
        y1 = int(clamp(roi["y1"], y0 + 1, h))

    crop = frame[y0:y1, x0:x1]
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    proc = preprocess_ball_channel(gray)

    circles = detect_circles(proc)
    if circles is None:
        return []

    circles = np.round(circles[0, :]).astype("int")
    return [
        {"x": float(x + x0), "y": float(y + y0), "r": float(r)}
        for (x, y, r) in circles
    ]


def centered_roi(center, half_w, half_h, frame_w, frame_h):
    return {
        "x0": clamp(center["x"] - half_w, 0, frame_w - 1),
        "y0": clamp(center["y"] - half_h, 0, frame_h - 1),
        "x1": clamp(center["x"] + half_w, 1, frame_w),
        "y1": clamp(center["y"] + half_h, 1, frame_h),
    }


def pick_ball_candidate(candidates, prev_ball, predicted_ball, wrist):
    if not candidates:
        return None

    if prev_ball is None and predicted_ball is None:
        return min(candidates, key=lambda c: c["r"])

    def score(c):
        total = 0.0
        weight = 0.0
        if predicted_ball is not None:
            total += 0.60 * dist(c, predicted_ball)
            weight += 0.60
        if prev_ball is not None:
            total += 0.25 * dist(c, prev_ball)
            weight += 0.25
        if wrist is not None:
            total += 0.15 * dist(c, wrist)
            weight += 0.15
        if weight <= 0:
            return c["r"]
        return total / weight

    return min(candidates, key=score)


def init_pose_estimator():
    try:
        import mediapipe as mp

        pose = mp.solutions.pose.Pose(
            static_image_mode=False,
            model_complexity=1,
            enable_segmentation=False,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        )
        return mp, pose, None
    except Exception as err:
        return None, None, str(err)


def get_pose_frame(frame, mp, pose, wrist_hand="right"):
    if not mp or not pose:
        return None, None

    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    result = pose.process(rgb)
    if not result.pose_landmarks:
        return None, None

    h, w = frame.shape[:2]
    lm = result.pose_landmarks.landmark

    pose_landmarks = []
    for p in lm:
        pose_landmarks.append(
            {
                "x": float(p.x * w),
                "y": float(p.y * h),
                "v": float(p.visibility),
            }
        )

    wrist = None
    wrist_idx = (
        mp.solutions.pose.PoseLandmark.LEFT_WRIST
        if str(wrist_hand).lower() == "left"
        else mp.solutions.pose.PoseLandmark.RIGHT_WRIST
    )
    wp = lm[wrist_idx]
    if wp.visibility >= 0.35:
        wrist = {"x": float(wp.x * w), "y": float(wp.y * h)}

    return wrist, {"landmarks": pose_landmarks}


def landmarks_visible_count(landmarks, indices, min_vis=0.35):
    count = 0
    for idx in indices:
        if idx < 0 or idx >= len(landmarks):
            continue
        p = landmarks[idx]
        if not isinstance(p, dict):
            continue
        if float(p.get("v", 0.0) or 0.0) >= float(min_vis):
            count += 1
    return count


def pose_bbox(landmarks, min_vis=0.35):
    pts = []
    for p in landmarks:
        if not isinstance(p, dict):
            continue
        if float(p.get("v", 0.0) or 0.0) < float(min_vis):
            continue
        pts.append((float(p["x"]), float(p["y"])))
    if not pts:
        return None
    xs = [x for x, _ in pts]
    ys = [y for _, y in pts]
    x0, x1 = min(xs), max(xs)
    y0, y1 = min(ys), max(ys)
    return {
        "x0": x0,
        "y0": y0,
        "x1": x1,
        "y1": y1,
        "w": max(1.0, x1 - x0),
        "h": max(1.0, y1 - y0),
        "cx": (x0 + x1) * 0.5,
        "cy": (y0 + y1) * 0.5,
    }


def evaluate_pose_subject_quality(pose_frame, frame_h):
    if not isinstance(pose_frame, dict):
        return {
            "score": 0.0,
            "center": None,
            "scale": None,
            "reason": "pose_missing",
        }
    landmarks = pose_frame.get("landmarks")
    if not isinstance(landmarks, list) or len(landmarks) < 29:
        return {
            "score": 0.0,
            "center": None,
            "scale": None,
            "reason": "pose_landmarks_missing",
        }

    core_idxs = [11, 12, 23, 24]
    lower_idxs = [25, 26, 27, 28]
    major_idxs = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]
    core_vis = landmarks_visible_count(landmarks, core_idxs, min_vis=0.35)
    lower_vis = landmarks_visible_count(landmarks, lower_idxs, min_vis=0.30)
    major_vis = landmarks_visible_count(landmarks, major_idxs, min_vis=0.35)
    bbox = pose_bbox(landmarks, min_vis=0.35)
    if bbox is None:
        return {
            "score": 0.0,
            "center": None,
            "scale": None,
            "reason": "pose_bbox_missing",
        }

    body_height_ratio = bbox["h"] / max(1.0, float(frame_h))
    full_body_visible = (
        core_vis >= 3
        and lower_vis >= 3
        and major_vis >= 8
        and body_height_ratio >= 0.22
    )
    score = (
        0.40 * clamp(core_vis / 4.0, 0.0, 1.0)
        + 0.30 * clamp(lower_vis / 4.0, 0.0, 1.0)
        + 0.20 * clamp(major_vis / 12.0, 0.0, 1.0)
        + 0.10 * clamp((body_height_ratio - 0.10) / 0.28, 0.0, 1.0)
    )
    return {
        "score": float(score),
        "center": {"x": float(bbox["cx"]), "y": float(bbox["cy"])},
        "scale": float(math.hypot(bbox["w"], bbox["h"])),
        "reason": "ok",
        "coreVisible": int(core_vis),
        "lowerVisible": int(lower_vis),
        "majorVisible": int(major_vis),
        "bodyHeightRatio": float(body_height_ratio),
        "fullBodyVisible": bool(full_body_visible),
    }


def pose_continuity_ok(quality, last_center, last_scale, frame_w, frame_h, missing_count):
    center = quality.get("center")
    scale = float(quality.get("scale") or 0.0)
    if center is None or scale <= 0:
        return False
    if last_center is None or last_scale is None:
        return True

    frame_diag = max(1.0, math.hypot(float(frame_w), float(frame_h)))
    center_jump = dist(center, last_center) / frame_diag
    missing = max(0, int(missing_count))
    max_jump = min(0.28, 0.09 + 0.020 * missing)
    if center_jump > max_jump:
        return False

    ratio = scale / max(1e-5, float(last_scale))
    max_ratio = min(2.0, 1.55 + 0.08 * min(missing, 5))
    min_ratio = 1.0 / max_ratio
    return min_ratio <= ratio <= max_ratio


def fallback_motion_proxy(frame, bg_subtractor, roi=None):
    h, w = frame.shape[:2]
    x0, y0, x1, y1 = 0, 0, w, h
    if roi is not None:
        x0 = int(clamp(roi["x0"], 0, w))
        y0 = int(clamp(roi["y0"], 0, h))
        x1 = int(clamp(roi["x1"], x0 + 1, w))
        y1 = int(clamp(roi["y1"], y0 + 1, h))

    crop = frame[y0:y1, x0:x1]
    if crop.size == 0:
        return None
    mask = bg_subtractor.apply(crop)
    _, mask = cv2.threshold(mask, 200, 255, cv2.THRESH_BINARY)
    kernel = np.ones((3, 3), np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)

    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None

    # Prefer elongated larger moving contour as a rough racket-arm proxy.
    best = None
    best_score = -1
    for c in contours:
        x, y, w, h = cv2.boundingRect(c)
        area = w * h
        if area < 80:
            continue
        elong = max(w, h) / max(1, min(w, h))
        score = area * (1.0 + 0.25 * elong)
        if score > best_score:
            best_score = score
            best = (x, y, w, h)

    if best is None:
        return None

    x, y, w, h = best
    return center_of_bbox(x + x0, y + y0, w, h)


def estimate_wrist_from_arm_chain(pose_frame, wrist_hand="right"):
    if not isinstance(pose_frame, dict):
        return None
    landmarks = pose_frame.get("landmarks")
    if not isinstance(landmarks, list) or len(landmarks) < 17:
        return None

    is_left = str(wrist_hand).lower() == "left"
    shoulder_idx = 11 if is_left else 12
    elbow_idx = 13 if is_left else 14
    shoulder = landmarks[shoulder_idx] if shoulder_idx < len(landmarks) else None
    elbow = landmarks[elbow_idx] if elbow_idx < len(landmarks) else None
    if not isinstance(shoulder, dict) or not isinstance(elbow, dict):
        return None

    sv = float(shoulder.get("v", 0.0) or 0.0)
    ev = float(elbow.get("v", 0.0) or 0.0)
    if sv < 0.35 or ev < 0.35:
        return None

    sx, sy = float(shoulder["x"]), float(shoulder["y"])
    ex, ey = float(elbow["x"]), float(elbow["y"])
    vx = ex - sx
    vy = ey - sy
    arm_len = math.hypot(vx, vy)
    if arm_len < 8:
        return None

    # Extend shoulder->elbow direction to approximate the wrist.
    # This keeps arm identity (racket arm) when wrist landmark visibility drops.
    extension = 0.95
    return {"x": ex + extension * vx, "y": ey + extension * vy}


def arm_chain_points(pose_frame, hand="right", min_vis=0.25):
    if not isinstance(pose_frame, dict):
        return []
    landmarks = pose_frame.get("landmarks")
    if not isinstance(landmarks, list) or len(landmarks) < 17:
        return []

    is_left = str(hand).lower() == "left"
    idxs = [11, 13, 15] if is_left else [12, 14, 16]
    pts = []
    for idx in idxs:
        if idx >= len(landmarks):
            continue
        p = landmarks[idx]
        if not isinstance(p, dict):
            continue
        if float(p.get("v", 0.0) or 0.0) < float(min_vis):
            continue
        pts.append({"x": float(p["x"]), "y": float(p["y"])})
    return pts


def min_dist_to_points(point, points):
    if point is None or not points:
        return None
    return min(dist(point, p) for p in points)


def passes_arm_identity_gate(candidate, pose_frame, wrist_hand="right"):
    if candidate is None:
        return False
    hit_hand = "left" if str(wrist_hand).lower() == "left" else "right"
    off_hand = "right" if hit_hand == "left" else "left"
    hit_pts = arm_chain_points(pose_frame, hand=hit_hand, min_vis=0.25)
    off_pts = arm_chain_points(pose_frame, hand=off_hand, min_vis=0.25)
    hit_d = min_dist_to_points(candidate, hit_pts)
    off_d = min_dist_to_points(candidate, off_pts)

    if hit_d is None:
        return True
    if off_d is None:
        return True

    # Reject candidates that are clearly closer to the non-hitting arm.
    margin_px = 12.0
    return not (off_d + margin_px < hit_d)


def max_wrist_jump_px(frame_w, frame_h, missing_count):
    # Cap sudden single-frame jumps, but relax gradually after missing spans
    # so the tracker can re-acquire when the player actually relocates.
    base = max(55.0, 0.055 * max(frame_w, frame_h))
    growth = min(max(0, int(missing_count)), 12) * 22.0
    cap = 0.28 * max(frame_w, frame_h)
    return min(cap, base + growth)


def track_video(video_path, wrist_hand="right"):
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"failed_to_open_video: {video_path}")

    mp, pose, pose_runtime_error = init_pose_estimator()
    bg_subtractor = cv2.createBackgroundSubtractorMOG2(history=120, varThreshold=25, detectShadows=False)

    ball_track = []
    racket_track = []
    pose_track = []

    prev_ball = None
    prev_prev_ball = None
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    last_valid_wrist = None
    frames_since_valid_wrist = 0
    pending_reacquire_count = 0
    last_subject_center = None
    last_subject_scale = None
    frames_since_subject = 0
    subject_lock_confidence = 0.0
    subject_grace_frames = 0

    try:
        frame_idx = 0
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            h, w = frame.shape[:2]

            wrist_source = "none"
            pose_wrist, pose_frame = get_pose_frame(frame, mp, pose, wrist_hand=wrist_hand)
            subject_quality = evaluate_pose_subject_quality(pose_frame, h)
            continuity_ok = pose_continuity_ok(
                subject_quality,
                last_subject_center,
                last_subject_scale,
                w,
                h,
                frames_since_subject,
            )
            quality_score = float(subject_quality.get("score") or 0.0)
            full_body_visible = bool(subject_quality.get("fullBodyVisible"))
            in_late_phase = total_frames > 0 and frame_idx >= int(total_frames * 0.72)

            # Late-phase no-switch: once a subject lock exists, do not accept
            # continuity breaks in the end of the serve.
            if in_late_phase and last_subject_center is not None and not continuity_ok and subject_lock_confidence >= 0.45:
                continuity_ok = False

            subject_strong = full_body_visible and quality_score >= 0.58 and continuity_ok
            subject_usable = full_body_visible and quality_score >= 0.48 and continuity_ok

            if subject_strong:
                last_subject_center = subject_quality.get("center")
                last_subject_scale = subject_quality.get("scale")
                frames_since_subject = 0
                subject_lock_confidence = clamp(subject_lock_confidence + 0.22, 0.0, 1.0)
                subject_grace_frames = 0
            elif subject_usable and subject_lock_confidence >= 0.55 and subject_grace_frames < 8:
                frames_since_subject += 1
                subject_lock_confidence = clamp(subject_lock_confidence - 0.03, 0.0, 1.0)
                subject_grace_frames += 1
            else:
                frames_since_subject += 1
                subject_lock_confidence = clamp(subject_lock_confidence - 0.12, 0.0, 1.0)
                if subject_grace_frames < 16:
                    subject_grace_frames += 1

            allow_pose_track = subject_strong or (
                subject_usable and subject_lock_confidence >= 0.50 and subject_grace_frames <= 10
            )

            wrist = None
            if pose_wrist is not None and allow_pose_track:
                wrist = pose_wrist
                wrist_source = "pose"
            if wrist is None and allow_pose_track:
                wrist = estimate_wrist_from_arm_chain(pose_frame, wrist_hand=wrist_hand)
                if wrist is not None:
                    wrist_source = "arm_chain"

            if wrist is None and allow_pose_track and last_valid_wrist is not None:
                local_roi = centered_roi(last_valid_wrist, 220, 220, w, h)
                local_motion = fallback_motion_proxy(frame, bg_subtractor, roi=local_roi)
                if local_motion is not None:
                    jump_limit = max_wrist_jump_px(w, h, frames_since_valid_wrist) * (0.75 if in_late_phase else 1.15)
                    if dist(local_motion, last_valid_wrist) <= jump_limit:
                        wrist = local_motion
                        wrist_source = "motion_fallback_local"

            if wrist is None and allow_pose_track and (not in_late_phase) and frames_since_valid_wrist >= 10:
                wrist = fallback_motion_proxy(frame, bg_subtractor)
                if wrist is not None:
                    wrist_source = "motion_fallback_global"

            if wrist is not None and not passes_arm_identity_gate(wrist, pose_frame, wrist_hand=wrist_hand):
                wrist = None
                wrist_source = "rejected_off_arm"

            if wrist is not None and last_valid_wrist is not None:
                jump_px = dist(wrist, last_valid_wrist)
                allowed_jump_px = max_wrist_jump_px(w, h, frames_since_valid_wrist)
                if jump_px > allowed_jump_px:
                    wrist = None
                    wrist_source = "rejected_jump"

            # Temporal re-acquisition stability:
            # after a gap, require 2 consecutive non-pose candidates before accepting.
            if wrist is not None and frames_since_valid_wrist > 0 and wrist_source != "pose":
                pending_reacquire_count += 1
                if pending_reacquire_count < 2:
                    wrist = None
                else:
                    pending_reacquire_count = 0

            if wrist is not None:
                last_valid_wrist = wrist
                frames_since_valid_wrist = 0
                pending_reacquire_count = 0
            else:
                frames_since_valid_wrist += 1

            if isinstance(pose_frame, dict):
                pose_frame["subjectQuality"] = {
                    "score": round(quality_score, 4),
                    "continuityOk": bool(continuity_ok),
                    "strong": bool(subject_strong),
                    "usable": bool(subject_usable),
                    "fullBodyVisible": bool(full_body_visible),
                    "allowPoseTrack": bool(allow_pose_track),
                    "motionFallbackAllowed": bool(allow_pose_track),
                    "lockConfidence": round(float(subject_lock_confidence), 4),
                    "graceFrames": int(subject_grace_frames),
                    "latePhase": bool(in_late_phase),
                }
            pose_track.append(pose_frame)

            predicted_ball = None
            if prev_ball is not None and prev_prev_ball is not None:
                vx = prev_ball["x"] - prev_prev_ball["x"]
                vy = prev_ball["y"] - prev_prev_ball["y"]
                predicted_ball = {
                    "x": prev_ball["x"] + 0.8 * vx,
                    "y": prev_ball["y"] + 0.8 * vy,
                }

            roi_candidates = []
            if predicted_ball is not None:
                roi_candidates.append(centered_roi(predicted_ball, 140, 140, w, h))
            if prev_ball is not None:
                roi_candidates.append(centered_roi(prev_ball, 180, 180, w, h))
            if wrist is not None:
                # During serve clips, the ball is usually above/near hitting arm in the action phase.
                in_action_phase = total_frames <= 0 or frame_idx > int(total_frames * 0.30)
                if in_action_phase:
                    wrist_center = {"x": wrist["x"], "y": wrist["y"] - 120}
                    roi_candidates.append(centered_roi(wrist_center, 260, 260, w, h))

            candidates = []
            for roi in roi_candidates[:2]:
                candidates.extend(detect_ball_candidates(frame, roi=roi))
            if not candidates:
                candidates = detect_ball_candidates(frame, roi=None)

            ball = pick_ball_candidate(candidates, prev_ball, predicted_ball, wrist)
            if ball is None:
                ball_track.append(None)
            else:
                current_ball = {"x": ball["x"], "y": ball["y"]}
                ball_track.append(current_ball)
                prev_prev_ball = prev_ball
                prev_ball = current_ball
            racket_track.append(wrist)
            frame_idx += 1
    finally:
        cap.release()
        if pose:
            pose.close()

    return {
        "ballTrack": ball_track,
        "racketTrack": racket_track,
        "poseTrack": pose_track,
        "poseRuntimeAvailable": bool(mp and pose),
        "poseRuntimeError": pose_runtime_error,
        "trackerMeta": {
            "wristHand": str(wrist_hand).lower(),
            "version": "wrist-hand-v4-subject-gated-fallback",
        },
    }


def main():
    args = parse_args()
    tracks = track_video(args.video, wrist_hand=args.wrist_hand)

    out_dir = os.path.dirname(args.output)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(tracks, f)


if __name__ == "__main__":
    try:
        main()
    except Exception as err:
        print(str(err), file=sys.stderr)
        sys.exit(1)
