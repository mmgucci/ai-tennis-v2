import path from 'node:path';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';
import { ensureDir, readJson, writeJson } from '../utils/fs.js';
import { getVideoMetadata, processVideoForContact } from './videoProcessing.js';

const STORE_VERSION = 'user-video-mgmt-v1';

function nowIso() {
  return new Date().toISOString();
}

function sha1(value) {
  return createHash('sha1').update(String(value || '')).digest('hex');
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

async function runCmd(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      if (err.code === 'ENOENT') {
        reject(new Error(`missing_dependency: '${cmd}' not found in PATH`));
        return;
      }
      reject(err);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      if (code !== 0) {
        reject(new Error(`${cmd} failed (${code}): ${stderr}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function inspectVideoTechnicalProfile(videoPath) {
  const args = [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_name,codec_tag_string,width,height,r_frame_rate,avg_frame_rate,nb_frames,duration:format=duration',
    '-of', 'json',
    videoPath
  ];
  const { stdout } = await runCmd('ffprobe', args);
  const parsed = JSON.parse(stdout || '{}');
  const stream = parsed?.streams?.[0] || {};
  const format = parsed?.format || {};

  const parseRate = (x) => {
    const s = String(x || '');
    if (!s) return null;
    if (!s.includes('/')) {
      const n = Number(s);
      return Number.isFinite(n) && n > 0 ? n : null;
    }
    const [a, b] = s.split('/').map(Number);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
    const r = a / b;
    return Number.isFinite(r) && r > 0 ? r : null;
  };

  const nominalFps = parseRate(stream?.r_frame_rate);
  const avgFps = parseRate(stream?.avg_frame_rate);
  const vfrLikely = Number.isFinite(nominalFps) && Number.isFinite(avgFps)
    ? Math.abs(nominalFps - avgFps) / Math.max(1e-6, nominalFps) > 0.02
    : null;

  return {
    codec: String(stream?.codec_name || '').trim() || null,
    codecTag: String(stream?.codec_tag_string || '').trim() || null,
    width: Number(stream?.width || 0) || null,
    height: Number(stream?.height || 0) || null,
    nominalFps: Number.isFinite(nominalFps) ? Number(nominalFps.toFixed(6)) : null,
    avgFps: Number.isFinite(avgFps) ? Number(avgFps.toFixed(6)) : null,
    durationSec: Number.isFinite(Number(format?.duration)) ? Number(Number(format.duration).toFixed(6)) : null,
    frameCount: Number.isFinite(Number(stream?.nb_frames)) ? Number(stream.nb_frames) : null,
    vfrLikely
  };
}

async function computeLogicVersionsFingerprint() {
  const files = [
    path.join(config.rootDir, 'src', 'services', 'contactDetection.js'),
    path.join(config.rootDir, 'src', 'scripts', 'auto_track.py')
  ];
  const out = {};
  for (const p of files) {
    try {
      const raw = await fs.readFile(p, 'utf-8');
      out[path.basename(p)] = sha1(raw).slice(0, 16);
    } catch {
      out[path.basename(p)] = null;
    }
  }
  return out;
}

async function deleteBestEffort(filePath) {
  await fs.unlink(filePath).catch(() => {});
}

async function clearDerivedSidecarsFor(videoPath) {
  await Promise.all([
    deleteBestEffort(`${videoPath}.tracks.json`),
    deleteBestEffort(`${videoPath}.audio_peaks.json`)
  ]);
}

async function extractSegment({
  inputPath,
  outputPath,
  startSec,
  durationSec,
  scaleWidth = null,
  fps = null
}) {
  const vf = [];
  if (Number.isFinite(scaleWidth) && scaleWidth > 0) {
    vf.push(`scale=${Math.round(scaleWidth)}:-2`);
  }
  if (Number.isFinite(fps) && fps > 0) {
    vf.push(`fps=${Math.round(fps)}`);
  }
  const args = [
    '-y',
    '-ss',
    String(Math.max(0, startSec)),
    '-t',
    String(Math.max(0.05, durationSec)),
    '-i',
    inputPath,
    ...(vf.length ? ['-vf', vf.join(',')] : []),
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-c:a',
    'aac',
    '-movflags',
    '+faststart',
    outputPath
  ];
  await runCmd('ffmpeg', args);
}

function scoreWindowResult(result, handedness) {
  const event = result?.event;
  if (!event?.found) return null;
  const confidence = Number(event?.confidence);
  if (!Number.isFinite(confidence)) return null;
  const timestampMs = Number(event?.timestampMs);
  if (!Number.isFinite(timestampMs)) return null;
  return {
    handedness,
    confidence,
    timestampMs,
    frame: Number.isFinite(Number(event?.frame)) ? Math.round(Number(event.frame)) : null,
    reason: event?.reason || null,
    mode: event?.diagnostics?.mode || null
  };
}

function mergeCandidateContacts(rawContacts, minGapSec = 1.8) {
  if (!Array.isArray(rawContacts) || !rawContacts.length) return [];
  const sorted = [...rawContacts].sort((a, b) => a.contactSec - b.contactSec);
  const merged = [];
  for (const c of sorted) {
    if (!merged.length) {
      merged.push(c);
      continue;
    }
    const prev = merged[merged.length - 1];
    if (Math.abs(c.contactSec - prev.contactSec) <= minGapSec) {
      if (c.confidence > prev.confidence) {
        merged[merged.length - 1] = c;
      }
      continue;
    }
    merged.push(c);
  }
  return merged;
}

function confidenceHistogramFromWindows(windowDebug) {
  const bins = Array.from({ length: 10 }, (_, i) => ({
    range: `${(i / 10).toFixed(1)}-${((i + 1) / 10).toFixed(1)}`,
    count: 0
  }));
  for (const w of (windowDebug || [])) {
    const c = Number(w?.decision?.selectedConfidence);
    if (!Number.isFinite(c)) continue;
    const clamped = Math.max(0, Math.min(0.999999, c));
    const idx = Math.max(0, Math.min(9, Math.floor(clamped * 10)));
    bins[idx].count += 1;
  }
  return bins;
}

function summarizeDetectionStatus(windowDebug, mergedContacts) {
  if (Array.isArray(mergedContacts) && mergedContacts.length > 0) {
    return {
      status: 'serve_contact_detected',
      reason: 'accepted_contact_candidates'
    };
  }
  const attempts = (windowDebug || []).flatMap((w) => Array.isArray(w?.attempts) ? w.attempts : []);
  const hasLowConfidenceCandidate = attempts.some((a) => {
    const confidence = Number(a?.confidence);
    const reason = String(a?.reason || '').toLowerCase();
    return Boolean(a?.found) || reason.includes('low_confidence') || (Number.isFinite(confidence) && confidence > 0);
  });
  const hasNoServeSignal = attempts.some((a) => String(a?.noDetectionTag || '').toLowerCase() === 'no_serve');
  if (hasLowConfidenceCandidate) {
    return {
      status: 'no_contact_point_detected',
      reason: 'all_candidates_below_confidence_threshold'
    };
  }
  if (hasNoServeSignal) {
    return {
      status: 'no_serve_detected',
      reason: 'serve_phase_not_detected'
    };
  }
  return {
    status: 'no_serve_detected',
    reason: 'no_contact_candidates'
  };
}

function normalizeStore(store) {
  if (!store || typeof store !== 'object') {
    return {
      schemaVersion: STORE_VERSION,
      entries: []
    };
  }
  return {
    schemaVersion: STORE_VERSION,
    entries: Array.isArray(store.entries) ? store.entries : []
  };
}

async function readStore() {
  const raw = await readJson(config.userVideoManagementPath, null);
  return normalizeStore(raw);
}

async function writeStore(store) {
  await ensureDir(path.dirname(config.userVideoManagementPath));
  await writeJson(config.userVideoManagementPath, normalizeStore(store));
}

export async function initUserVideoManagementStore() {
  await ensureDir(config.userClipsDir);
  await ensureDir(path.dirname(config.userVideoManagementPath));
  const store = await readStore();
  await writeStore(store);
}

export async function listUserVideoManagementEntries() {
  const store = await readStore();
  const entries = [...store.entries].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return entries;
}

async function appendUserVideoManagementEntry(entry) {
  const store = await readStore();
  store.entries = [...store.entries, entry];
  await writeStore(store);
  return entry;
}

export async function updateUserVideoManagementClientMetrics(entryId, metrics = {}) {
  const id = String(entryId || '').trim();
  if (!id) throw new Error('invalid_user_video_entry_id');
  const store = await readStore();
  const idx = store.entries.findIndex((e) => String(e?.id || '') === id);
  if (idx < 0) throw new Error('user_video_entry_not_found');
  const prev = store.entries[idx] || {};
  const nextDebug = {
    ...(prev.debug || {}),
    clientMetrics: {
      ...((prev.debug && prev.debug.clientMetrics) ? prev.debug.clientMetrics : {}),
      ...metrics
    }
  };
  const next = {
    ...prev,
    debug: nextDebug
  };
  store.entries[idx] = next;
  await writeStore(store);
  return next;
}

export async function scanAndExtractServeClips({
  inputVideoPath,
  sourceFileName,
  clientMetrics = null,
  scanWindowSec = 6,
  scanStepSec = 3,
  confidenceThreshold = 0.55,
  preContactSec = 3,
  postContactSec = 2,
  onProgress = null
}) {
  const emitProgress = (payload) => {
    if (typeof onProgress !== 'function') return;
    try {
      onProgress(payload);
    } catch {
      // best effort progress updates
    }
  };
  const metadata = await getVideoMetadata(inputVideoPath);
  const sourceProfile = await inspectVideoTechnicalProfile(inputVideoPath).catch(() => null);
  const logicVersions = await computeLogicVersionsFingerprint();
  const durationSec = (() => {
    const a = Number(metadata?.duration || 0);
    if (Number.isFinite(a) && a > 0.2) return a;
    const b = Number(sourceProfile?.durationSec || 0);
    if (Number.isFinite(b) && b > 0.2) return b;
    return 0;
  })();
  if (!Number.isFinite(durationSec) || durationSec <= 0.2) {
    throw new Error('invalid_video_duration_for_scan');
  }

  const runId = uuidv4();
  const processingStartedAtMs = Date.now();
  emitProgress({ stage: 'preparing', percent: 0, message: 'Preparing scan windows...' });
  const workDir = path.join(config.processedDir, 'user_scan_tmp', runId);
  await ensureDir(workDir);
  await ensureDir(config.userClipsDir);

  const windows = [];
  for (let startSec = 0; startSec < durationSec; startSec += scanStepSec) {
    const remaining = durationSec - startSec;
    if (remaining <= 0.05) break;
    windows.push({
      startSec: Number(startSec.toFixed(3)),
      durationSec: Number(Math.min(scanWindowSec, remaining).toFixed(3))
    });
  }

  const candidateContacts = [];
  const windowDebug = [];
  const scanStartedAtMs = Date.now();
  emitProgress({
    stage: 'scan',
    percent: 0,
    totalWindows: windows.length,
    processedWindows: 0,
    message: `Scanning ${windows.length} windows...`
  });
  for (let i = 0; i < windows.length; i += 1) {
    const windowStartedAtMs = Date.now();
    const w = windows[i];
    const tempClipPath = path.join(workDir, `window-${String(i + 1).padStart(4, '0')}.mp4`);
    await extractSegment({
      inputPath: inputVideoPath,
      outputPath: tempClipPath,
      startSec: w.startSec,
      durationSec: w.durationSec,
      scaleWidth: 960,
      fps: 30
    });

    let best = null;
    const attempts = [];
    for (const handedness of ['right', 'left']) {
      const result = await processVideoForContact(tempClipPath, {
        strokeType: 'serve',
        handedness,
        courtSide: 'deuce'
      }, {
        debugCaptureCandidates: true
      });
      attempts.push({
        handedness,
        found: Boolean(result?.event?.found),
        frame: Number.isFinite(Number(result?.event?.frame)) ? Math.round(Number(result.event.frame)) : null,
        timestampMs: Number.isFinite(Number(result?.event?.timestampMs)) ? Math.round(Number(result.event.timestampMs)) : null,
        confidence: Number.isFinite(Number(result?.event?.confidence)) ? Number(result.event.confidence) : null,
        reason: result?.event?.reason || null,
        noDetectionTag: result?.event?.noDetectionTag || null,
        mode: result?.event?.diagnostics?.mode || null,
        trackingSource: result?.trackingSource || null,
        trackerVersion: String(result?.trackMeta?.version || '').trim() || null,
        trackerWristHand: String(result?.trackMeta?.wristHand || '').trim() || null,
        decisionDebug: result?.event?.diagnostics?.debug || null
      });
      const scored = scoreWindowResult(result, handedness);
      if (!scored) continue;
      if (!best || scored.confidence > best.confidence) best = scored;
    }

    const windowDecision = {
      accepted: Boolean(best && best.confidence >= confidenceThreshold),
      reason: best ? (
        best.confidence >= confidenceThreshold
          ? 'confidence_above_threshold'
          : 'confidence_below_threshold'
      ) : 'no_contact_found',
      selectedHandedness: best?.handedness || null,
      selectedConfidence: Number.isFinite(Number(best?.confidence)) ? Number(best.confidence) : null,
      selectedFrame: Number.isFinite(Number(best?.frame)) ? Number(best.frame) : null
    };

    const failureCounts = {};
    for (const a of attempts) {
      const key = String(a?.reason || (a?.found ? 'found' : 'no_reason')).trim() || 'unknown';
      failureCounts[key] = Number(failureCounts[key] || 0) + 1;
    }

    if (best && best.confidence >= confidenceThreshold) {
      const contactSec = w.startSec + (best.timestampMs / 1000);
      candidateContacts.push({
        windowStartSec: w.startSec,
        windowDurationSec: w.durationSec,
        contactSec: Number(contactSec.toFixed(3)),
        contactFrame: best.frame,
        confidence: Number(best.confidence.toFixed(4)),
        handedness: best.handedness,
        mode: best.mode
      });
    }

    windowDebug.push({
      windowIndex: i + 1,
      startSec: w.startSec,
      durationSec: w.durationSec,
      processingMs: Date.now() - windowStartedAtMs,
      attempts,
      decision: windowDecision,
      failureCategoryCounts: failureCounts
    });
    emitProgress({
      stage: 'scan',
      totalWindows: windows.length,
      processedWindows: i + 1,
      percent: Math.round(((i + 1) / Math.max(1, windows.length)) * 85),
      message: `Scanned window ${i + 1}/${windows.length}`
    });

    await clearDerivedSidecarsFor(tempClipPath);
    await deleteBestEffort(tempClipPath);
  }
  const scanMs = Date.now() - scanStartedAtMs;

  await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});

  const merged = mergeCandidateContacts(candidateContacts, 1.8);
  const clips = [];
  const extractionStartedAtMs = Date.now();
  emitProgress({
    stage: 'extract',
    totalClips: merged.length,
    processedClips: 0,
    percent: 85,
    message: `Extracting ${merged.length} clips...`
  });
  for (let i = 0; i < merged.length; i += 1) {
    const c = merged[i];
    const clipStartSec = clamp(c.contactSec - preContactSec, 0, durationSec);
    const clipEndSec = clamp(c.contactSec + postContactSec, 0, durationSec);
    const clipDurationSec = Math.max(0.05, clipEndSec - clipStartSec);
    const clipFileName = `${path.parse(sourceFileName || 'user-video').name}-serve-${String(i + 1).padStart(2, '0')}-${runId.slice(0, 8)}.mp4`;
    const clipPath = path.join(config.userClipsDir, clipFileName);

    await extractSegment({
      inputPath: inputVideoPath,
      outputPath: clipPath,
      startSec: clipStartSec,
      durationSec: clipDurationSec
    });

    clips.push({
      id: `${runId}-${i + 1}`,
      fileName: clipFileName,
      publicUrl: `/files/user-clips/${clipFileName}`,
      clipStartSec: Number(clipStartSec.toFixed(3)),
      clipEndSec: Number(clipEndSec.toFixed(3)),
      clipDurationSec: Number(clipDurationSec.toFixed(3)),
      detectedContactSec: c.contactSec,
      detectedConfidence: c.confidence,
      detectedHandedness: c.handedness,
      detectionMode: c.mode || null
    });
    emitProgress({
      stage: 'extract',
      totalClips: merged.length,
      processedClips: i + 1,
      percent: 85 + Math.round(((i + 1) / Math.max(1, merged.length)) * 14),
      message: `Extracted clip ${i + 1}/${merged.length}`
    });
  }
  const extractionMs = Date.now() - extractionStartedAtMs;
  const processingMs = Date.now() - processingStartedAtMs;
  const detectionStatus = summarizeDetectionStatus(windowDebug, merged);

  const entry = await appendUserVideoManagementEntry({
    id: runId,
    createdAt: nowIso(),
    detectionStatus: detectionStatus.status,
    detectionReason: detectionStatus.reason,
    sourceFileName: String(sourceFileName || path.basename(inputVideoPath)),
    sourcePublicUrl: `/files/uploads/${path.basename(inputVideoPath)}`,
    sourceDurationSec: Number(durationSec.toFixed(3)),
    sourceFps: Number((metadata?.fps || 0).toFixed(3)),
    sourceProfile,
    scanConfig: {
      scanWindowSec,
      scanStepSec,
        confidenceThreshold,
        preContactSec,
        postContactSec,
        minContactConfidence: Number(config?.detection?.minContactConfidence ?? confidenceThreshold)
      },
    candidateWindowsScanned: windows.length,
    candidateContactsFound: candidateContacts.length,
    extractedClips: clips,
    debug: {
      timingMs: {
        processingTotalMs: processingMs,
        scanMs,
        extractionMs
      },
      clientMetrics: {
        compressionMs: Number.isFinite(Number(clientMetrics?.compressionMs)) ? Math.round(Number(clientMetrics.compressionMs)) : null,
        uploadMs: Number.isFinite(Number(clientMetrics?.uploadMs)) ? Math.round(Number(clientMetrics.uploadMs)) : null,
        compressionEnabled: Boolean(clientMetrics?.compressionEnabled),
        originalBytes: Number.isFinite(Number(clientMetrics?.originalBytes)) ? Number(clientMetrics.originalBytes) : null,
        compressedBytes: Number.isFinite(Number(clientMetrics?.compressedBytes)) ? Number(clientMetrics.compressedBytes) : null
      },
      contactDecision: {
        confidenceThreshold,
        preContactSec,
        postContactSec,
        minGapSec: 1.8
      },
      windows: windowDebug,
      windowConfidenceHistogram: confidenceHistogramFromWindows(windowDebug),
      failureCategoryTotals: (() => {
        const out = {};
        for (const w of windowDebug) {
          const m = w?.failureCategoryCounts || {};
          for (const [k, v] of Object.entries(m)) {
            out[k] = Number(out[k] || 0) + Number(v || 0);
          }
        }
        return out;
      })(),
      runConfig: {
        scanWindowSec,
        scanStepSec,
        confidenceThreshold,
        preContactSec,
        postContactSec,
        scanClipProfile: {
          width: 960,
          fps: 30
        },
        detectorContexts: [
          { strokeType: 'serve', handedness: 'right', courtSide: 'deuce' },
          { strokeType: 'serve', handedness: 'left', courtSide: 'deuce' }
        ],
        detectorOptions: {
          debugCaptureCandidates: true
        }
      },
      versions: {
        contactDetectionHash: logicVersions?.['contactDetection.js'] || null,
        trackerScriptHash: logicVersions?.['auto_track.py'] || null
      },
      mergedContacts: merged.map((c, idx) => ({
        mergedIndex: idx + 1,
        contactSec: c.contactSec,
        confidence: c.confidence,
        handedness: c.handedness,
        sourceWindowStartSec: c.windowStartSec,
        sourceWindowDurationSec: c.windowDurationSec
      }))
    }
  });
  emitProgress({
    stage: 'done',
    percent: 100,
    message: 'Processing complete.',
    runId: entry.id
  });

  return entry;
}
