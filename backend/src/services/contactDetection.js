// v1 heuristic: contact frame = minimal ball-to-racket distance.
// Confidence is boosted if the ball velocity changes around contact.

function euclidean(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function velocity(points, idx) {
  if (idx <= 0 || idx >= points.length) return null;
  const prev = points[idx - 1];
  const current = points[idx];
  if (!prev || !current) return null;
  return { x: current.x - prev.x, y: current.y - prev.y };
}

function directionalDelta(v1, v2) {
  if (!v1 || !v2) return 0;
  return Math.sqrt((v2.x - v1.x) ** 2 + (v2.y - v1.y) ** 2);
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

function pushLimited(arr, value, max = 500) {
  if (!Array.isArray(arr)) return;
  if (arr.length >= max) return;
  arr.push(value);
}

function getServeArmPlausibilityAtFrame({ poseTrack, frame, handedness = 'right' }) {
  if (!Array.isArray(poseTrack) || !Number.isFinite(frame) || frame < 0 || frame >= poseTrack.length) {
    return {
      available: false,
      plausible: true,
      hangingDown: false,
      score: 0.5,
      reason: 'pose_track_unavailable'
    };
  }
  const poseFrame = poseTrack[Math.round(frame)];
  const landmarks = poseFrame?.landmarks;
  if (!Array.isArray(landmarks) || landmarks.length < 29) {
    return {
      available: false,
      plausible: true,
      hangingDown: false,
      score: 0.5,
      reason: 'pose_frame_unavailable'
    };
  }

  const isLeft = String(handedness || 'right').toLowerCase() === 'left';
  const shoulderIdx = isLeft ? 11 : 12;
  const elbowIdx = isLeft ? 13 : 14;
  const wristIdx = isLeft ? 15 : 16;
  const hipIdx = isLeft ? 23 : 24;
  const shoulder = landmarks[shoulderIdx];
  const elbow = landmarks[elbowIdx];
  const wrist = landmarks[wristIdx];
  const hip = landmarks[hipIdx];
  const minVis = 0.25;
  const shoulderOk = shoulder && Number(shoulder.v) >= minVis;
  const elbowOk = elbow && Number(elbow.v) >= minVis;
  const wristOk = wrist && Number(wrist.v) >= minVis;

  if (!shoulderOk || !elbowOk || !wristOk) {
    return {
      available: false,
      plausible: true,
      hangingDown: false,
      score: 0.5,
      reason: 'arm_landmarks_low_visibility'
    };
  }

  const torsoPx = (hip && Number(hip.v) >= minVis)
    ? Math.abs(Number(hip.y) - Number(shoulder.y))
    : Math.hypot(Number(wrist.x) - Number(shoulder.x), Number(wrist.y) - Number(shoulder.y));
  const scalePx = Math.max(30, Number.isFinite(torsoPx) ? torsoPx : 60);
  const wristLiftNorm = (Number(shoulder.y) - Number(wrist.y)) / scalePx;
  const elbowLiftNorm = (Number(shoulder.y) - Number(elbow.y)) / scalePx;
  const wristLiftScore = clamp01((wristLiftNorm + 0.06) / 0.34);
  const elbowLiftScore = clamp01((elbowLiftNorm + 0.03) / 0.28);
  const score = clamp01(0.72 * wristLiftScore + 0.28 * elbowLiftScore);
  const hangingDown = wristLiftNorm < -0.08 && elbowLiftNorm < -0.04;
  const plausible = !hangingDown;

  return {
    available: true,
    plausible,
    hangingDown,
    score,
    wristLiftNorm,
    elbowLiftNorm
  };
}

function audioScoreAtFrame({ frame, fps, audioPeaks, windowMs = 45 }) {
  if (!Array.isArray(audioPeaks) || !audioPeaks.length || !Number.isFinite(frame) || !Number.isFinite(fps) || fps <= 0) {
    return { score: 0, peakTimeMs: null, deltaMs: null };
  }
  const targetMs = (frame / fps) * 1000;
  const radius = Math.max(1, Number(windowMs) || 45);
  let best = null;
  for (const p of audioPeaks) {
    const peakMs = Number(p?.timeMs);
    if (!Number.isFinite(peakMs)) continue;
    const delta = Math.abs(peakMs - targetMs);
    if (delta > radius) continue;
    const strength = clamp01(Number(p?.strength) || 0);
    const distScore = clamp01(1 - (delta / radius));
    const score = 0.65 * strength + 0.35 * distScore;
    if (!best || score > best.score) {
      best = { score, peakTimeMs: Math.round(peakMs), deltaMs: Math.round(delta) };
    }
  }
  return best || { score: 0, peakTimeMs: null, deltaMs: null };
}

function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const idx = Math.floor((sorted.length - 1) * q);
  return sorted[idx];
}

function smoothSeries(values, radius = 2) {
  const out = Array(values.length).fill(null);
  for (let i = 0; i < values.length; i += 1) {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - radius); j <= Math.min(values.length - 1, i + radius); j += 1) {
      const v = values[j];
      if (v === null || v === undefined) continue;
      sum += v;
      count += 1;
    }
    out[i] = count > 0 ? sum / count : null;
  }
  return out;
}

function averageFinite(values, from, to) {
  let sum = 0;
  let count = 0;
  for (let i = from; i <= to; i += 1) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    sum += v;
    count += 1;
  }
  return count > 0 ? sum / count : null;
}

function selectServeApexWindow({ racketTrack, searchWindow, fps }) {
  const start = searchWindow.windowStart;
  const end = searchWindow.windowEnd;
  if (end - start < 10) return null;

  const yRaw = Array(end - start + 1).fill(null).map((_, k) => {
    const r = racketTrack[start + k];
    return r ? Number(r.y) : null;
  });
  const xRaw = Array(end - start + 1).fill(null).map((_, k) => {
    const r = racketTrack[start + k];
    return r ? Number(r.x) : null;
  });
  const ySmooth = smoothSeries(yRaw, 2);

  const yValid = ySmooth.filter((v) => Number.isFinite(v));
  if (yValid.length < 12) return null;
  const yMin = Math.min(...yValid);
  const yMax = Math.max(...yValid);
  const yRange = Math.max(1, yMax - yMin);

  const candidates = [];
  const minGap = Math.max(4, Math.round((fps || 60) * 0.05));
  let lastPicked = -9999;

  for (let k = 3; k < ySmooth.length - 3; k += 1) {
    const yc = ySmooth[k];
    if (!Number.isFinite(yc)) continue;
    const prev = ySmooth[k - 1];
    const next = ySmooth[k + 1];
    if (!Number.isFinite(prev) || !Number.isFinite(next)) continue;
    const isLocalMin = yc <= prev && yc <= next;
    if (!isLocalMin) continue;
    if (k - lastPicked < minGap) continue;

    const beforeY = averageFinite(ySmooth, Math.max(0, k - 8), Math.max(0, k - 2));
    const afterY = averageFinite(ySmooth, Math.min(ySmooth.length - 1, k + 2), Math.min(ySmooth.length - 1, k + 8));
    if (!Number.isFinite(beforeY) || !Number.isFinite(afterY)) continue;

    const extension = beforeY - yc;
    const recovery = afterY - yc;
    if (extension < Math.max(4, 0.08 * yRange) || recovery < Math.max(4, 0.05 * yRange)) {
      continue;
    }

    const idx = start + k;
    const heightScore = clamp01((yMax - yc) / yRange);
    const laterScore = clamp01((idx - start) / Math.max(1, end - start));

    const x0 = averageFinite(xRaw, Math.max(0, k - 4), Math.max(0, k - 1));
    const y0 = averageFinite(ySmooth, Math.max(0, k - 4), Math.max(0, k - 1));
    let verticalScore = 0.5;
    if (Number.isFinite(x0) && Number.isFinite(y0) && Number.isFinite(xRaw[k]) && Number.isFinite(ySmooth[k])) {
      const dx = Math.abs(xRaw[k] - x0);
      const dy = Math.abs(ySmooth[k] - y0);
      verticalScore = clamp01(dy / Math.max(1, dx + dy));
    }

    const combined = 0.45 * heightScore + 0.35 * laterScore + 0.20 * verticalScore;
    candidates.push({
      idx,
      combined,
      heightScore,
      laterScore,
      verticalScore,
      y: yc
    });
    lastPicked = k;
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => b.combined - a.combined);
  const best = candidates[0];

  const winStart = Math.max(start, best.idx - Math.round((fps || 60) * 0.06));
  const winEnd = Math.min(end, best.idx + Math.round((fps || 60) * 0.32));
  if (winStart >= winEnd) return null;

  return {
    selectedApexIdx: best.idx,
    selectedApexScore: best.combined,
    selectedApexHeightScore: best.heightScore,
    selectedApexLaterScore: best.laterScore,
    selectedApexVerticalScore: best.verticalScore,
    narrowedWindowStart: winStart,
    narrowedWindowEnd: winEnd,
    candidateCount: candidates.length
  };
}

function detectServeTossWindow({ ballTrack, fps, height, length }) {
  const yRaw = ballTrack.slice(0, length).map((p) => (p ? Number(p.y) : null));
  const y = smoothSeries(yRaw, 2);
  const validIdx = [];
  for (let i = 0; i < y.length; i += 1) {
    if (Number.isFinite(y[i])) validIdx.push(i);
  }
  if (validIdx.length < 12) {
    return { ok: false, reason: 'insufficient_ball_track' };
  }

  const scanStart = Math.floor(length * 0.05);
  // Ignore tail section to avoid false late apex picks from noisy tracking.
  const scanEnd = Math.max(scanStart + 1, Math.ceil(length * 0.85));
  let apexIdx = -1;
  let apexY = Number.POSITIVE_INFINITY;
  for (let i = scanStart; i < scanEnd; i += 1) {
    const yi = y[i];
    if (!Number.isFinite(yi)) continue;
    if (yi < apexY) {
      apexY = yi;
      apexIdx = i;
    }
  }
  // Guard against noisy late apex picks near clip tail.
  if (apexIdx > Math.floor(length * 0.75)) {
    let earlyIdx = -1;
    let earlyY = Number.POSITIVE_INFINITY;
    const earlyEnd = Math.max(scanStart + 1, Math.floor(length * 0.75));
    for (let i = scanStart; i < earlyEnd; i += 1) {
      const yi = y[i];
      if (!Number.isFinite(yi)) continue;
      if (yi < earlyY) {
        earlyY = yi;
        earlyIdx = i;
      }
    }
    if (earlyIdx >= 0) {
      apexIdx = earlyIdx;
      apexY = earlyY;
    }
  }
  if (apexIdx < 0) {
    return { ok: false, reason: 'no_apex_detected' };
  }

  // Baseline from early part of clip before apex.
  const baselineCandidates = [];
  const baselineEnd = Math.min(apexIdx - 1, Math.floor(length * 0.4));
  for (let i = 0; i <= baselineEnd; i += 1) {
    const yi = y[i];
    if (Number.isFinite(yi)) baselineCandidates.push(yi);
  }
  if (!baselineCandidates.length) {
    return { ok: false, reason: 'no_baseline_detected' };
  }
  baselineCandidates.sort((a, b) => a - b);
  const baselineY = quantile(baselineCandidates, 0.6);
  const tossMagnitude = baselineY - apexY;
  const minTossPixels = Math.max(20, (height || 1080) * 0.04);
  if (tossMagnitude < minTossPixels) {
    return {
      ok: false,
      reason: 'toss_not_detected',
      diagnostics: { tossMagnitude, minTossPixels, apexIdx, apexY, baselineY }
    };
  }

  // Toss starts when the ball has moved meaningfully upward from baseline.
  const tossStartThreshold = baselineY - 0.2 * tossMagnitude;
  let tossStartIdx = -1;
  for (let i = 0; i < apexIdx; i += 1) {
    const yi = y[i];
    if (!Number.isFinite(yi)) continue;
    if (yi <= tossStartThreshold) {
      tossStartIdx = i;
      break;
    }
  }
  if (tossStartIdx < 0) {
    tossStartIdx = Math.max(0, apexIdx - Math.round((fps || 60) * 0.5));
  }

  const preApexLeadFrames = Math.max(1, Math.round((fps || 60) * 0.08));
  const postApexTailFrames = Math.max(2, Math.round((fps || 60) * 0.9));
  const windowStart = Math.max(tossStartIdx, apexIdx - preApexLeadFrames);
  const windowEnd = Math.min(length - 1, apexIdx + postApexTailFrames);
  if (windowStart >= windowEnd) {
    return { ok: false, reason: 'invalid_toss_window' };
  }

  return {
    ok: true,
    windowStart,
    windowEnd,
    apexIdx,
    tossStartIdx,
    diagnostics: { tossMagnitude, minTossPixels, apexY, baselineY }
  };
}

function fallbackServePhaseWindow(length) {
  return {
    ok: true,
    windowStart: Math.max(0, Math.floor(length * 0.55)),
    windowEnd: Math.max(1, Math.min(length - 1, Math.floor(length * 0.95))),
    mode: 'late_serve_phase'
  };
}

function detectRacketApexFallback({
  racketTrack,
  poseTrack = [],
  fps,
  length,
  width,
  height,
  handedness = 'right',
  debugCaptureCandidates = false
}) {
  const isLeftHanded = String(handedness || 'right').toLowerCase() === 'left';
  const landscape = (width || 0) >= (height || 0);
  const startFrac = landscape ? (isLeftHanded ? 0.52 : 0.55) : (isLeftHanded ? 0.50 : 0.50);
  const endFrac = landscape ? (isLeftHanded ? 0.84 : 0.95) : (isLeftHanded ? 0.84 : 0.90);
  const centerFrac = landscape ? (isLeftHanded ? 0.68 : 0.72) : (isLeftHanded ? 0.66 : 0.66);
  const sigmaFrac = landscape ? 0.10 : 0.16;
  const weightHeight = landscape ? 0.20 : 0.65;
  const weightTemporal = landscape ? 0.35 : 0.35;

  const window = {
    ok: true,
    windowStart: Math.max(0, Math.floor(length * startFrac)),
    windowEnd: Math.max(1, Math.min(length - 1, Math.floor(length * endFrac))),
    mode: 'late_serve_phase'
  };

  const values = [];
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const ySeries = Array(length).fill(null);
  for (let i = window.windowStart; i <= window.windowEnd; i += 1) {
    const r = racketTrack[i];
    if (!r) continue;
    values.push({ idx: i, y: r.y });
    ySeries[i] = r.y;
    if (r.y < minY) minY = r.y;
    if (r.y > maxY) maxY = r.y;
  }

  if (!values.length) {
    return {
      found: false,
      confidence: 0,
      reason: 'no_valid_racket_frames_in_fallback_window'
    };
  }

  const yRange = Number.isFinite(maxY) && Number.isFinite(minY) ? Math.max(1, maxY - minY) : 1;
  const smoothRadius = 2;

  const smoothY = Array(length).fill(null);
  for (let i = window.windowStart; i <= window.windowEnd; i += 1) {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(window.windowStart, i - smoothRadius); j <= Math.min(window.windowEnd, i + smoothRadius); j += 1) {
      const v = ySeries[j];
      if (!Number.isFinite(v)) continue;
      sum += v;
      count += 1;
    }
    smoothY[i] = count > 0 ? sum / count : null;
  }

  // Trim quiet clip tails so longer endTime does not shift fallback later.
  let effectiveWindowEnd = window.windowEnd;
  const motionThreshold = Math.max(2, yRange * 0.015);
  let lastMotionIdx = -1;
  for (let i = window.windowStart + 1; i <= window.windowEnd; i += 1) {
    const a = smoothY[i - 1];
    const b = smoothY[i];
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    if (Math.abs(b - a) >= motionThreshold) lastMotionIdx = i;
  }
  if (lastMotionIdx > window.windowStart + 12) {
    const tail = Math.max(2, Math.round((fps || 60) * 0.14));
    effectiveWindowEnd = Math.min(window.windowEnd, lastMotionIdx + tail);
  }
  if (effectiveWindowEnd <= window.windowStart + 6) {
    effectiveWindowEnd = window.windowEnd;
  }

  const centerIdx = Math.round(window.windowStart + ((effectiveWindowEnd - window.windowStart) * centerFrac));
  const sigmaFrames = Math.max(4, Math.round((effectiveWindowEnd - window.windowStart + 1) * sigmaFrac));

  function avgAround(arr, from, to) {
    let sum = 0;
    let count = 0;
    for (let i = from; i <= to; i += 1) {
      const v = arr[i];
      if (!Number.isFinite(v)) continue;
      sum += v;
      count += 1;
    }
    return count > 0 ? sum / count : null;
  }

  let best = null;
  const extensionCandidates = [];
  const debugEvaluatedFrames = debugCaptureCandidates ? [] : null;
  const debugRejectedFrames = debugCaptureCandidates ? [] : null;
  const extThreshold = Math.max(6, 0.08 * yRange);
  const recThreshold = Math.max(6, 0.06 * yRange);

  for (let i = window.windowStart + 8; i <= effectiveWindowEnd - 8; i += 1) {
    const yi = smoothY[i];
    if (!Number.isFinite(yi)) {
      if (debugCaptureCandidates) pushLimited(debugRejectedFrames, { idx: i, reason: 'invalid_smoothed_y' });
      continue;
    }
    const before = avgAround(smoothY, i - 8, i - 2);
    const after = avgAround(smoothY, i + 2, i + 8);
    if (!Number.isFinite(before) || !Number.isFinite(after)) {
      if (debugCaptureCandidates) pushLimited(debugRejectedFrames, { idx: i, reason: 'missing_context' });
      continue;
    }

    const extension = before - yi;
    const recovery = after - yi;
    if (extension < extThreshold || recovery < recThreshold) {
      if (debugCaptureCandidates) {
        pushLimited(debugRejectedFrames, {
          idx: i,
          reason: extension < extThreshold ? 'low_extension' : 'low_recovery',
          extension: Number(extension.toFixed(4)),
          recovery: Number(recovery.toFixed(4))
        });
      }
      continue;
    }

    const armPlausibility = getServeArmPlausibilityAtFrame({ poseTrack, frame: i, handedness });
    if (armPlausibility.available && armPlausibility.hangingDown) {
      if (debugCaptureCandidates) pushLimited(debugRejectedFrames, { idx: i, reason: 'arm_hanging_down' });
      continue;
    }

    const extScore = clamp01(extension / Math.max(1, 0.25 * yRange));
    const recScore = clamp01(recovery / Math.max(1, 0.25 * yRange));
    const apexHeightScore = clamp01((maxY - yi) / yRange);
    const z = (i - centerIdx) / sigmaFrames;
    const temporalScore = clamp01(Math.exp(-0.5 * z * z));
    const armScore = armPlausibility.available ? armPlausibility.score : 0.5;
    const combined = 0.33 * extScore + 0.20 * recScore + 0.12 * temporalScore + 0.25 * apexHeightScore + 0.10 * armScore;
    extensionCandidates.push({ idx: i, y: yi, extScore, recScore, temporalScore, apexHeightScore, armScore, combined });
    if (debugCaptureCandidates) {
      pushLimited(debugEvaluatedFrames, {
        idx: i,
        stage: 'extension_primary',
        combined: Number(combined.toFixed(6)),
        extensionScore: Number(extScore.toFixed(4)),
        recoveryScore: Number(recScore.toFixed(4)),
        temporalScore: Number(temporalScore.toFixed(4)),
        apexHeightScore: Number(apexHeightScore.toFixed(4)),
        serveArmScore: Number(armScore.toFixed(4))
      });
    }
  }

  if (extensionCandidates.length > 0) {
    extensionCandidates.sort((a, b) => b.combined - a.combined);
    const winner = (() => {
      if (!isLeftHanded) return extensionCandidates[0];
      const bestScore = extensionCandidates[0].combined;
      const tolerance = 0.08;
      const viable = extensionCandidates
        .filter((c) => c.combined >= (bestScore - tolerance))
        .sort((a, b) => a.idx - b.idx);
      return viable[0] || extensionCandidates[0];
    })();
    const rangeScore = clamp01(yRange / Math.max(30, (height || 1080) * 0.12));
    const confidence = clamp01(0.35 + 0.30 * rangeScore + 0.35 * winner.combined);
    return {
      found: true,
      frame: winner.idx,
      timestampMs: Math.round((winner.idx / (fps || 60)) * 1000),
      confidence,
      diagnostics: {
        mode: 'pose_extension_primary',
        yRange,
        centerIdx,
        selectedFrameScore: winner.combined,
        extensionScore: winner.extScore,
        recoveryScore: winner.recScore,
        apexHeightScore: winner.apexHeightScore,
        serveArmScore: winner.armScore,
        window: {
          ...window,
          effectiveWindowEnd,
          lastMotionIdx,
          motionThreshold
        },
        ...(debugCaptureCandidates
          ? {
              debug: {
                acceptedFrame: winner.idx,
                evaluatedFrames: debugEvaluatedFrames,
                rejectedFrames: debugRejectedFrames
              }
            }
          : {})
      }
    };
  }

  const apexCandidates = [];
  for (const v of values) {
    if (v.idx > effectiveWindowEnd) continue;
    const armPlausibility = getServeArmPlausibilityAtFrame({ poseTrack, frame: v.idx, handedness });
    if (armPlausibility.available && armPlausibility.hangingDown) {
      if (debugCaptureCandidates) pushLimited(debugRejectedFrames, { idx: v.idx, reason: 'arm_hanging_down' });
      continue;
    }
    const heightScore = clamp01((maxY - v.y) / yRange);
    const z = (v.idx - centerIdx) / sigmaFrames;
    const temporalScore = clamp01(Math.exp(-0.5 * z * z));
    const armScore = armPlausibility.available ? armPlausibility.score : 0.5;
    const combined = 0.60 * heightScore + 0.25 * temporalScore + 0.15 * armScore;
    apexCandidates.push({ ...v, heightScore, temporalScore, armScore, combined });
    if (debugCaptureCandidates) {
      pushLimited(debugEvaluatedFrames, {
        idx: v.idx,
        stage: 'apex_secondary',
        combined: Number(combined.toFixed(6)),
        heightScore: Number(heightScore.toFixed(4)),
        temporalScore: Number(temporalScore.toFixed(4)),
        serveArmScore: Number(armScore.toFixed(4))
      });
    }
    if (!best || combined > best.combined) {
      best = { ...v, heightScore, temporalScore, armScore, combined };
    }
  }

  if (!best) {
    return {
      found: false,
      confidence: 0,
      reason: 'no_plausible_racket_frames_in_fallback_window'
    };
  }

  if (isLeftHanded && apexCandidates.length > 1) {
    const bestScore = best.combined;
    const tolerance = 0.07;
    const viable = apexCandidates
      .filter((c) => c.combined >= (bestScore - tolerance))
      .sort((a, b) => a.idx - b.idx);
    if (viable.length) best = viable[0];
  }

  const rangeScore = clamp01(yRange / Math.max(30, (height || 1080) * 0.12));
  const confidence = clamp01(0.35 + 0.35 * rangeScore + 0.30 * best.combined);

  return {
    found: true,
    frame: best.idx,
    timestampMs: Math.round((best.idx / (fps || 60)) * 1000),
    confidence,
    diagnostics: {
      mode: 'pose_apex_secondary',
      yRange,
      centerIdx,
      selectedFrameScore: best.combined,
      serveArmScore: best.armScore,
      window: {
        ...window,
        effectiveWindowEnd,
        lastMotionIdx,
        motionThreshold
      },
      ...(debugCaptureCandidates
        ? {
            debug: {
              acceptedFrame: best.idx,
              evaluatedFrames: debugEvaluatedFrames,
              rejectedFrames: debugRejectedFrames
            }
          }
        : {})
    }
  };
}

function detectLatePhaseBallRacketFallback({ ballTrack, racketTrack, fps, length, width, height }) {
  const window = fallbackServePhaseWindow(length);
  const diagonal = Math.sqrt(width * width + height * height) || 2000;
  const expectedContactIdx = window.windowStart + Math.round((window.windowEnd - window.windowStart) * 0.70);
  const sigmaFrames = Math.max(6, Math.round((fps || 60) * 0.20));

  const candidates = [];
  for (let i = window.windowStart; i <= window.windowEnd; i += 1) {
    const ball = ballTrack[i];
    const racket = racketTrack[i];
    if (!ball || !racket) continue;
    const d = euclidean(ball, racket);
    candidates.push({ idx: i, distance: d });
  }
  if (!candidates.length) {
    return {
      found: false,
      confidence: 0,
      reason: 'no_valid_ball_racket_frames_in_late_phase'
    };
  }

  const distances = candidates.map((c) => c.distance);
  const sorted = [...distances].sort((a, b) => a - b);
  const p10 = quantile(sorted, 0.1);
  const p50 = quantile(sorted, 0.5);
  const relDenom = Math.max(1, p50 - p10);

  let best = null;
  for (const c of candidates) {
    const distRelativeScore = clamp01((p50 - c.distance) / relDenom);
    const distAbsoluteScore = clamp01(1 - c.distance / (0.6 * diagonal));
    const distScore = 0.85 * distRelativeScore + 0.15 * distAbsoluteScore;

    let velocityChange = 0;
    const start = Math.max(1, c.idx - 3);
    const end = Math.min(length - 2, c.idx + 3);
    for (let i = start; i <= end; i += 1) {
      const vPre = velocity(ballTrack, i);
      const vPost = velocity(ballTrack, i + 1);
      velocityChange = Math.max(velocityChange, directionalDelta(vPre, vPost));
    }
    const velScore = clamp01(velocityChange / 15);

    const z = (c.idx - expectedContactIdx) / sigmaFrames;
    const temporalScore = clamp01(Math.exp(-0.5 * z * z));
    const combinedScore = 0.65 * distScore + 0.25 * velScore + 0.10 * temporalScore;

    if (!best || combinedScore > best.combinedScore) {
      best = {
        idx: c.idx,
        distance: c.distance,
        velocityChange,
        distScore,
        velScore,
        temporalScore,
        combinedScore
      };
    }
  }

  const confidence = clamp01(0.70 * best.distScore + 0.20 * best.velScore + 0.10 * best.temporalScore);
  if (confidence < 0.35) {
    return {
      found: false,
      confidence,
      reason: 'low_confidence_late_phase_ball_racket'
    };
  }

  return {
    found: true,
    frame: best.idx,
    timestampMs: Math.round((best.idx / (fps || 60)) * 1000),
    confidence,
    diagnostics: {
      mode: 'ball_late_phase_secondary',
      minDistance: best.distance,
      velocityChange: best.velocityChange,
      p10Distance: p10,
      p50Distance: p50,
      selectedFrameScore: best.combinedScore,
      expectedContactIdx,
      window
    }
  };
}

export function detectContactEvent({
  ballTrack,
  racketTrack,
  poseTrack = [],
  fps,
  width = 0,
  height = 0,
  context = {},
  audioPeaks = [],
  detectionOptions = {}
}) {
  if (!Array.isArray(ballTrack) || !Array.isArray(racketTrack) || ballTrack.length === 0 || racketTrack.length === 0) {
    return {
      found: false,
      confidence: 0,
      reason: 'missing_track_data'
    };
  }

  const length = Math.min(ballTrack.length, racketTrack.length);
  const strokeType = String(context?.strokeType || 'serve').toLowerCase();
  const handedness = String(context?.handedness || 'right').toLowerCase();
  const courtSide = String(context?.courtSide || '').toLowerCase();
  const isRightHandServeAdSide = strokeType === 'serve' && handedness === 'right' && courtSide === 'ad';
  const enableBallGuidedPath = detectionOptions?.useBallForContact !== false;
  const audioAssistEnabled = Boolean(detectionOptions?.audioAssistEnabled) && strokeType === 'serve';
  const audioAssistWeight = audioAssistEnabled ? clamp01(Number(detectionOptions?.audioAssistWeight ?? 0.14)) : 0;
  const audioAssistWindowMs = Math.max(15, Number(detectionOptions?.audioAssistWindowMs ?? 45));
  const debugCaptureCandidates = Boolean(detectionOptions?.debugCaptureCandidates);

  if (strokeType === 'serve' && !enableBallGuidedPath) {
    const poseOnly = detectRacketApexFallback({
      racketTrack,
      poseTrack,
      fps,
      length,
      width,
      height,
      handedness,
      debugCaptureCandidates
    });
    if (!poseOnly.found) return poseOnly;
    const baseDiagnostics = {
      ...poseOnly.diagnostics,
      path: 'pose_primary',
      switchedFrom: 'ball_disabled_pose_primary'
    };
    if (audioAssistEnabled) {
      const baseFrame = Number(poseOnly.frame);
      const baseWindow = baseDiagnostics?.window || {};
      const phaseStartIdx = Math.max(
        0,
        Number.isFinite(Number(baseWindow.windowStart))
          ? Number(baseWindow.windowStart)
          : Math.floor(length * 0.50)
      );
      const phaseEndIdx = Math.min(
        length - 1,
        Number.isFinite(Number(baseWindow.effectiveWindowEnd))
          ? Number(baseWindow.effectiveWindowEnd)
          : (Number.isFinite(Number(baseWindow.windowEnd))
              ? Number(baseWindow.windowEnd)
              : Math.floor(length * 0.95))
      );
      const phaseStartMs = (phaseStartIdx / Math.max(1, fps)) * 1000;
      const phaseEndMs = (phaseEndIdx / Math.max(1, fps)) * 1000;
      const phaseAudioPeaks = audioPeaks.filter((p) => {
        const t = Number(p?.timeMs);
        return Number.isFinite(t) && t >= phaseStartMs && t <= phaseEndMs;
      });
      const searchRadiusFrames = Math.max(3, Math.round((fps || 60) * 0.10));
      const searchStart = Math.max(phaseStartIdx, baseFrame - searchRadiusFrames);
      const searchEnd = Math.min(phaseEndIdx, baseFrame + searchRadiusFrames);
      let bestShift = null;
      const sigma = Math.max(2, Math.round((fps || 60) * 0.05));
      const poseWeight = clamp01(1 - Math.min(0.35, Math.max(0.08, audioAssistWeight * 2.8)));
      const audioWeight = 1 - poseWeight;
      for (let i = searchStart; i <= searchEnd; i += 1) {
        const audio = audioScoreAtFrame({ frame: i, fps, audioPeaks: phaseAudioPeaks, windowMs: audioAssistWindowMs });
        const dz = (i - baseFrame) / sigma;
        const posePrior = clamp01(Math.exp(-0.5 * dz * dz));
        const combined = poseWeight * posePrior + audioWeight * audio.score;
        if (!bestShift || combined > bestShift.combined) {
          bestShift = {
            frame: i,
            combined,
            posePrior,
            audioScore: audio.score,
            audioPeakTimeMs: audio.peakTimeMs,
            audioDeltaMs: audio.deltaMs
          };
        }
      }

      if (bestShift && bestShift.audioScore >= 0.40) {
        const baseMs = Math.round((baseFrame / Math.max(1, fps)) * 1000);
        const shifted = {
          ...poseOnly,
          frame: bestShift.frame,
          timestampMs: Math.round((bestShift.frame / Math.max(1, fps)) * 1000),
          confidence: clamp01((1 - 0.20) * poseOnly.confidence + 0.20 * bestShift.combined),
          diagnostics: {
            ...baseDiagnostics,
            audioAssistEnabled,
            audioAssistWeight,
            audioPeakWindowCount: phaseAudioPeaks.length,
            audioScore: bestShift.audioScore,
            audioPeakTimeMs: bestShift.audioPeakTimeMs,
            audioDeltaMs: bestShift.audioDeltaMs,
            audioAdjustedFromFrame: baseFrame,
            audioAdjustedFromMs: baseMs,
            audioAdjustedByFrames: bestShift.frame - baseFrame,
            audioAdjustedByMs: Math.round(((bestShift.frame - baseFrame) / Math.max(1, fps)) * 1000)
          }
        };
        return shifted;
      }
    }
    return {
      ...poseOnly,
      diagnostics: baseDiagnostics
    };
  }

  const tossWindow = detectServeTossWindow({ ballTrack, fps, height, length });
  if (!tossWindow.ok) {
    const fallbackEvent = detectRacketApexFallback({
      racketTrack,
      poseTrack,
      fps,
      length,
      width,
      height,
      handedness,
      debugCaptureCandidates
    });
    if (fallbackEvent.found) {
      return {
        ...fallbackEvent,
        diagnostics: {
          ...fallbackEvent.diagnostics,
          fallbackFrom: tossWindow.reason
        }
      };
    }

    const isLeftHandServe = strokeType === 'serve' && handedness === 'left';
    if (!isLeftHandServe) {
      const latePhaseEvent = detectLatePhaseBallRacketFallback({ ballTrack, racketTrack, fps, length, width, height });
      if (latePhaseEvent.found) {
        return {
          ...latePhaseEvent,
          diagnostics: {
            ...latePhaseEvent.diagnostics,
            fallbackFrom: tossWindow.reason
          }
        };
      }
    }

    return {
      ...fallbackEvent,
      reason: tossWindow.reason
    };
  }

  const searchWindow = tossWindow.ok
    ? { ...tossWindow, mode: 'toss_window' }
    : fallbackServePhaseWindow(length);

  const tossMagnitude = Number(searchWindow?.diagnostics?.tossMagnitude);
  const minTossPixels = Number(searchWindow?.diagnostics?.minTossPixels);
  const lowToss = Number.isFinite(tossMagnitude)
    && Number.isFinite(minTossPixels)
    && tossMagnitude < (minTossPixels * 1.25);

  const veryLowToss = Number.isFinite(tossMagnitude)
    && Number.isFinite(minTossPixels)
    && tossMagnitude < (minTossPixels * 1.08);

  if (searchWindow.mode === 'toss_window' && veryLowToss) {
    const minOffsetFrames = Math.round((fps || 60) * 0.42);
    searchWindow.windowStart = Math.max(searchWindow.windowStart, searchWindow.apexIdx + minOffsetFrames);
    if (searchWindow.windowStart >= searchWindow.windowEnd) {
      searchWindow.windowStart = Math.max(searchWindow.apexIdx, searchWindow.windowEnd - 2);
    }

    const apexWindow = selectServeApexWindow({ racketTrack, searchWindow, fps });
    if (apexWindow) {
      searchWindow.windowStart = Math.max(searchWindow.windowStart, apexWindow.narrowedWindowStart);
      searchWindow.windowEnd = Math.min(searchWindow.windowEnd, apexWindow.narrowedWindowEnd);
      searchWindow.apexSelection = apexWindow;
    }
  }

  // Small profile tweak for right-handed ad-side serves:
  // keep search slightly tighter around toss apex to avoid late false picks.
  if (isRightHandServeAdSide && searchWindow.mode === 'toss_window') {
    const adTailFrames = Math.max(2, Math.round((fps || 60) * 0.60));
    searchWindow.windowEnd = Math.min(searchWindow.windowEnd, searchWindow.apexIdx + adTailFrames);
  }

  let minDistance = Number.POSITIVE_INFINITY;
  let minIdx = -1;
  const candidates = [];
  let armRejectedCandidates = 0;
  const debugEvaluatedCandidates = debugCaptureCandidates ? [] : null;
  const debugRejectedCandidates = debugCaptureCandidates ? [] : null;

  for (let i = searchWindow.windowStart; i <= searchWindow.windowEnd; i += 1) {
    const ball = ballTrack[i];
    const racket = racketTrack[i];
    if (!ball || !racket) continue;
    const serveArm = strokeType === 'serve'
      ? getServeArmPlausibilityAtFrame({ poseTrack, frame: i, handedness })
      : { available: false, plausible: true, hangingDown: false, score: 0.5 };
    if (strokeType === 'serve' && serveArm.available && serveArm.hangingDown) {
      armRejectedCandidates += 1;
      if (debugCaptureCandidates) pushLimited(debugRejectedCandidates, { idx: i, reason: 'arm_hanging_down' });
      continue;
    }
    const d = euclidean(ball, racket);
    candidates.push({
      idx: i,
      distance: d,
      ballY: Number(ball.y),
      racketY: Number(racket.y),
      serveArmScore: Number(serveArm.score ?? 0.5),
      serveArmAvailable: Boolean(serveArm.available)
    });
    if (d < minDistance) {
      minDistance = d;
      minIdx = i;
    }
  }

  if (minIdx < 0) {
    return {
      found: false,
      confidence: 0,
      reason: armRejectedCandidates > 0 ? 'no_plausible_frames_in_search_window' : 'no_valid_frames_in_search_window',
      diagnostics: {
        armRejectedCandidates
      }
    };
  }

  const distances = candidates.map((c) => c.distance);
  const sorted = [...distances].sort((a, b) => a - b);
  const p10 = quantile(sorted, 0.1);
  const p50 = quantile(sorted, 0.5);

  // Select candidate by combined score: distance + ball velocity change + temporal prior.
  const relDenom = Math.max(1, p50 - p10);
  const diagonal = Math.sqrt(width * width + height * height) || 2000;
  const expectedContactIdx = searchWindow.apexIdx + Math.round((fps || 60) * (isRightHandServeAdSide ? 0.20 : 0.24));
  const sigmaFrames = Math.max(4, Math.round((fps || 60) * 0.16));
  const racketYValues = candidates
    .map((c) => c.racketY)
    .filter((v) => Number.isFinite(v));
  const racketYMax = racketYValues.length ? Math.max(...racketYValues) : 0;
  const racketYMin = racketYValues.length ? Math.min(...racketYValues) : 0;
  const racketYRange = Math.max(1, racketYMax - racketYMin);

  // Audio is only allowed to influence scoring inside a plausible serve-contact phase window.
  const servePhaseAudioPeaks = audioAssistEnabled
    ? (() => {
      const phaseStartIdx = Math.max(
        searchWindow.windowStart,
        Number(searchWindow.apexIdx || 0) + Math.round((fps || 60) * 0.10)
      );
      const phaseEndIdx = Math.min(
        searchWindow.windowEnd,
        Number(searchWindow.apexIdx || 0) + Math.round((fps || 60) * (isRightHandServeAdSide ? 0.38 : 0.44))
      );
      const startMs = (phaseStartIdx / Math.max(1, fps)) * 1000;
      const endMs = (phaseEndIdx / Math.max(1, fps)) * 1000;
      if (endMs <= startMs) return [];
      return audioPeaks.filter((p) => {
        const t = Number(p?.timeMs);
        return Number.isFinite(t) && t >= startMs && t <= endMs;
      });
    })()
    : [];

  let bestCandidate = null;
  for (const c of candidates) {
    const distRelativeScore = clamp01((p50 - c.distance) / relDenom);
    const distAbsoluteScore = clamp01(1 - c.distance / (0.6 * diagonal));
    const distScore = 0.8 * distRelativeScore + 0.2 * distAbsoluteScore;

    let velocityChange = 0;
    const start = Math.max(1, c.idx - 3);
    const end = Math.min(length - 2, c.idx + 3);
    for (let i = start; i <= end; i += 1) {
      const vPre = velocity(ballTrack, i);
      const vPost = velocity(ballTrack, i + 1);
      velocityChange = Math.max(velocityChange, directionalDelta(vPre, vPost));
    }
    const velScore = clamp01(velocityChange / 15);

    const z = (c.idx - expectedContactIdx) / sigmaFrames;
    const temporalScore = clamp01(Math.exp(-0.5 * z * z));
    const racketHeightScore = Number.isFinite(c.racketY)
      ? clamp01((racketYMax - c.racketY) / racketYRange)
      : 0.5;
    const serveArmScore = strokeType === 'serve' ? clamp01(Number(c.serveArmScore ?? 0.5)) : 0.5;

    let positionGateScore = 1;
    if (isRightHandServeAdSide && searchWindow.mode === 'toss_window') {
      const baselineY = Number(searchWindow?.diagnostics?.baselineY);
      const tossMagnitude = Number(searchWindow?.diagnostics?.tossMagnitude);
      const ballY = Number(c.ballY);
      if (Number.isFinite(baselineY) && Number.isFinite(tossMagnitude) && tossMagnitude > 0 && Number.isFinite(ballY)) {
        const maxContactY = baselineY - 0.35 * tossMagnitude;
        if (ballY > maxContactY) {
          positionGateScore = clamp01(1 - (ballY - maxContactY) / Math.max(1, 0.35 * tossMagnitude));
        }
      }
    }

    const baseScore = isRightHandServeAdSide
      ? 0.47 * distScore + 0.19 * velScore + 0.16 * temporalScore + 0.08 * racketHeightScore + 0.10 * serveArmScore
      : 0.55 * distScore + 0.18 * velScore + 0.09 * temporalScore + 0.08 * racketHeightScore + 0.10 * serveArmScore;
    const geometryScore = 0.80 * baseScore + 0.20 * positionGateScore;
    const audio = audioAssistEnabled
      ? audioScoreAtFrame({ frame: c.idx, fps, audioPeaks: servePhaseAudioPeaks, windowMs: audioAssistWindowMs })
      : { score: 0, peakTimeMs: null, deltaMs: null };
    const temporalAudioGate = clamp01((temporalScore - 0.45) / 0.55);
    const afterApexGate = searchWindow.mode === 'toss_window'
      ? (c.idx >= Number(searchWindow.apexIdx || 0) ? 1 : 0)
      : 1;
    const effectiveAudioWeight = audioAssistWeight * temporalAudioGate * afterApexGate;
    const combinedScore = (1 - effectiveAudioWeight) * geometryScore + effectiveAudioWeight * audio.score;

    if (!bestCandidate || combinedScore > bestCandidate.combinedScore) {
      bestCandidate = {
        idx: c.idx,
        distance: c.distance,
        velocityChange,
        distScore,
        velScore,
        temporalScore,
        racketHeightScore,
        serveArmScore,
        positionGateScore,
        combinedScore,
        audioScore: audio.score,
        audioTemporalGate: temporalAudioGate,
        audioEffectiveWeight: effectiveAudioWeight,
        audioPeakTimeMs: audio.peakTimeMs,
        audioDeltaMs: audio.deltaMs
      };
    }
    if (debugCaptureCandidates) {
      pushLimited(debugEvaluatedCandidates, {
        idx: c.idx,
        combinedScore: Number(combinedScore.toFixed(6)),
        distScore: Number(distScore.toFixed(4)),
        velScore: Number(velScore.toFixed(4)),
        temporalScore: Number(temporalScore.toFixed(4)),
        racketHeightScore: Number(racketHeightScore.toFixed(4)),
        serveArmScore: Number(serveArmScore.toFixed(4)),
        positionGateScore: Number(positionGateScore.toFixed(4)),
        audioScore: Number(audio.score.toFixed(4)),
        accepted: false
      });
    }
  }

  minIdx = bestCandidate.idx;
  minDistance = bestCandidate.distance;
  if (debugCaptureCandidates && Array.isArray(debugEvaluatedCandidates)) {
    const chosen = debugEvaluatedCandidates.find((x) => Number(x?.idx) === Number(minIdx));
    if (chosen) chosen.accepted = true;
  }

  // Empirical correction: tracker tends to lag a few frames on pro toss window clips.
  const earlyBiasFrames = 0;
  if (searchWindow.mode === 'toss_window' && earlyBiasFrames > 0) {
    minIdx = Math.max(searchWindow.windowStart, minIdx - earlyBiasFrames);
    const biased = candidates.find((c) => c.idx === minIdx);
    if (biased) {
      minDistance = biased.distance;
    }
  }

  let confidence = clamp01(
    (isRightHandServeAdSide
      ? 0.47 * bestCandidate.distScore + 0.19 * bestCandidate.velScore + 0.16 * bestCandidate.temporalScore + 0.08 * bestCandidate.racketHeightScore + 0.10 * bestCandidate.serveArmScore
      : 0.55 * bestCandidate.distScore + 0.18 * bestCandidate.velScore + 0.09 * bestCandidate.temporalScore + 0.08 * bestCandidate.racketHeightScore + 0.10 * bestCandidate.serveArmScore)
    * (0.85 + 0.15 * bestCandidate.positionGateScore)
  );
  if (audioAssistEnabled) {
    const confidenceAudioWeight = Math.min(0.08, Math.max(0, bestCandidate.audioEffectiveWeight));
    confidence = clamp01((1 - confidenceAudioWeight) * confidence + confidenceAudioWeight * bestCandidate.audioScore);
  }

  // If candidate sits at very start/end of clip, confidence should be damped.
  const edgeWindow = Math.max(2, Math.floor(length * 0.03));
  if (minIdx <= edgeWindow || minIdx >= length - 1 - edgeWindow) {
    confidence *= 0.6;
  }

  const found = confidence >= 0.35;
  if (!found) {
    return {
      found: false,
      confidence,
      reason: 'low_confidence',
      diagnostics: {
        fallbackFrom: tossWindow.ok ? null : tossWindow.reason,
        searchWindow
      }
    };
  }

  if (strokeType === 'serve' && minIdx < Math.floor(length * 0.30)) {
    const latePhaseEvent = detectLatePhaseBallRacketFallback({ ballTrack, racketTrack, fps, length, width, height });
    if (latePhaseEvent.found) {
      return {
        ...latePhaseEvent,
        diagnostics: {
          ...latePhaseEvent.diagnostics,
          switchedFrom: 'implausibly_early_toss_window_pick',
          originalFrame: minIdx,
          fallbackFrom: tossWindow.ok ? null : tossWindow.reason
        }
      };
    }
  }

  // For right-handed ad-side serves, toss detection can still be triggered by noisy ball tracks.
  // If ball-racket proximity is weak, prefer pose-only fallback.
  if (strokeType === 'serve' && isRightHandServeAdSide && Number.isFinite(minDistance) && minDistance > 150) {
    const poseFallback = detectRacketApexFallback({ racketTrack, poseTrack, fps, length, width, height, handedness });
    if (poseFallback.found) {
      return {
        ...poseFallback,
        diagnostics: {
          ...poseFallback.diagnostics,
          switchedFrom: 'weak_ball_racket_proximity_ad_side',
          originalFrame: minIdx,
          originalMinDistance: minDistance
        }
      };
    }
  }

  return {
    found: true,
    frame: minIdx,
    timestampMs: Math.round((minIdx / (fps || 60)) * 1000),
    confidence,
    diagnostics: {
      minDistance,
      velocityChange: bestCandidate.velocityChange,
      p10Distance: p10,
      p50Distance: p50,
      expectedContactIdx,
      selectedFrameScore: bestCandidate.combinedScore,
      racketHeightScore: bestCandidate.racketHeightScore,
      serveArmScore: bestCandidate.serveArmScore,
      armRejectedCandidates,
      audioAssistEnabled,
      audioAssistWeight,
      audioPeakWindowCount: servePhaseAudioPeaks.length,
      audioScore: bestCandidate.audioScore,
      audioTemporalGate: bestCandidate.audioTemporalGate,
      audioEffectiveWeight: bestCandidate.audioEffectiveWeight,
      audioPeakTimeMs: bestCandidate.audioPeakTimeMs,
      audioDeltaMs: bestCandidate.audioDeltaMs,
      profile: {
        strokeType,
        handedness,
        courtSide,
        isRightHandServeAdSide
      },
      searchWindow,
      lowToss,
      veryLowToss,
      fallbackFrom: tossWindow.ok ? null : tossWindow.reason,
      ...(debugCaptureCandidates
        ? {
            debug: {
              acceptedFrame: minIdx,
              evaluatedCandidates: debugEvaluatedCandidates,
              rejectedCandidates: debugRejectedCandidates
            }
          }
        : {})
    }
  };
}
