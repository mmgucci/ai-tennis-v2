import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { readJson, writeJson } from '../utils/fs.js';
import { config } from '../config.js';

export const TRACKER_CACHE_VERSION = 'pose-yolo-courtside-v1';

function runCmd(cmd, args) {
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
        reject(new Error(`${cmd} failed (${code}): ${stderr || stdout}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function normalizeWristHand(handedness) {
  return String(handedness || 'right').toLowerCase() === 'left' ? 'left' : 'right';
}

export async function inspectTrackCache(videoPath, options = {}) {
  const sidecarPath = `${videoPath}.tracks.json`;
  if (!await fileExists(sidecarPath)) {
    return { ok: false, reason: 'missing_tracks_sidecar' };
  }
  const existing = await readJson(sidecarPath, null);
  if (!existing) {
    return { ok: false, reason: 'invalid_tracks_json' };
  }
  const hasPoseTrack = Array.isArray(existing?.poseTrack);
  const hasPoseRuntimeFlag = typeof existing?.poseRuntimeAvailable === 'boolean';
  const hasObjectRuntimeFlag = typeof existing?.objectRuntimeAvailable === 'boolean';
  if (!hasPoseTrack || !hasPoseRuntimeFlag || !hasObjectRuntimeFlag) {
    return { ok: false, reason: 'legacy_tracks_schema' };
  }
  const expectedWristHand = normalizeWristHand(options?.handedness);
  const meta = existing?.trackerMeta || {};
  const cacheWristHand = normalizeWristHand(meta?.wristHand);
  const cacheVersion = String(meta?.version || '');
  if (cacheWristHand !== expectedWristHand) {
    return { ok: false, reason: 'wrist_hand_mismatch' };
  }
  if (cacheVersion !== TRACKER_CACHE_VERSION) {
    return { ok: false, reason: 'tracker_cache_version_mismatch' };
  }
  const objectMeta = existing?.objectDetectorMeta || {};
  const objectModel = String(objectMeta?.model || '');
  const expectedObjectModel = String(config?.tracking?.objectDetectorModel || 'Davidsv/CourtSide-Computer-Vision-v1');
  if (config?.tracking?.objectDetectorEnabled !== false && objectModel !== expectedObjectModel) {
    return { ok: false, reason: 'object_detector_model_mismatch' };
  }
  if (
    config?.tracking?.objectDetectorEnabled !== false
    && config?.tracking?.objectDetectorRetryUnavailable !== false
    && existing?.objectRuntimeAvailable === false
  ) {
    return { ok: false, reason: 'object_detector_unavailable_retry' };
  }
  return { ok: true, reason: null };
}

async function runPythonTracker(videoPath, sidecarPath, options = {}) {
  const scriptPath = `${config.rootDir}/src/scripts/auto_track.py`;
  const wristHand = normalizeWristHand(options?.handedness);
  const args = [scriptPath, '--video', videoPath, '--output', sidecarPath, '--wrist-hand', wristHand];
  const configuredPython = process.env.PYTHON_BIN;
  const repoVenvPython = path.resolve(config.rootDir, '..', '.venv', 'bin', 'python');

  const candidates = [];
  if (configuredPython) candidates.push(configuredPython);
  candidates.push(repoVenvPython, 'python3', 'python');

  let lastError = null;
  for (const candidate of [...new Set(candidates)]) {
    try {
      await runCmd(candidate, args);
      return;
    } catch (err) {
      lastError = err;
      if (String(err.message || '').includes('missing_dependency')) {
        continue;
      }
      throw err;
    }
  }

  throw lastError ?? new Error('no_python_runtime_available');
}

async function runPythonObjectDetector(videoPath, sidecarPath, options = {}) {
  if (config?.tracking?.objectDetectorEnabled === false) {
    return;
  }
  const scriptPath = `${config.rootDir}/src/scripts/object_track.py`;
  const wristHand = normalizeWristHand(options?.handedness);
  const model = String(config?.tracking?.objectDetectorModel || 'Davidsv/CourtSide-Computer-Vision-v1');
  const confidence = String(Number(config?.tracking?.objectDetectorConfidence ?? 0.15));
  const imageSize = String(Number(config?.tracking?.objectDetectorImageSize ?? 960));
  const args = [
    scriptPath,
    '--video',
    videoPath,
    '--tracks',
    sidecarPath,
    '--output',
    sidecarPath,
    '--wrist-hand',
    wristHand,
    '--model',
    model,
    '--conf',
    confidence,
    '--imgsz',
    imageSize
  ];
  const configuredPython = process.env.PYTHON_BIN;
  const repoVenvPython = path.resolve(config.rootDir, '..', '.venv', 'bin', 'python');

  const candidates = [];
  if (configuredPython) candidates.push(configuredPython);
  candidates.push(repoVenvPython, 'python3', 'python');

  let lastError = null;
  for (const candidate of [...new Set(candidates)]) {
    try {
      await runCmd(candidate, args);
      return;
    } catch (err) {
      lastError = err;
      if (String(err.message || '').includes('missing_dependency')) {
        continue;
      }
      throw err;
    }
  }

  throw lastError ?? new Error('no_python_runtime_available');
}

async function generateTracks(videoPath, sidecarPath, options = {}) {
  await runPythonTracker(videoPath, sidecarPath, options);
  try {
    await runPythonObjectDetector(videoPath, sidecarPath, options);
  } catch (err) {
    const existing = await readJson(sidecarPath, null);
    if (!existing || typeof existing !== 'object') {
      throw err;
    }
    existing.objectRuntimeAvailable = false;
    existing.objectRuntimeError = err.message;
    existing.objectDetectorMeta = {
      enabled: config?.tracking?.objectDetectorEnabled !== false,
      model: String(config?.tracking?.objectDetectorModel || 'Davidsv/CourtSide-Computer-Vision-v1'),
      confidence: Number(config?.tracking?.objectDetectorConfidence ?? 0.15),
      imageSize: Number(config?.tracking?.objectDetectorImageSize ?? 960),
      error: err.message
    };
    existing.trackerMeta = {
      ...(existing.trackerMeta || {}),
      wristHand: normalizeWristHand(options?.handedness),
      version: TRACKER_CACHE_VERSION,
      objectDetectorEnabled: config?.tracking?.objectDetectorEnabled !== false
    };
    await writeJson(sidecarPath, existing);
  }
}

export async function getOrCreateTracks(videoPath, options = {}) {
  const sidecarPath = `${videoPath}.tracks.json`;
  const wristHand = normalizeWristHand(options?.handedness);
  if (await fileExists(sidecarPath)) {
    const existing = await readJson(sidecarPath, null);
    const hasPoseTrack = Array.isArray(existing?.poseTrack);
    const hasPoseRuntimeFlag = typeof existing?.poseRuntimeAvailable === 'boolean';
    const hasObjectRuntimeFlag = typeof existing?.objectRuntimeAvailable === 'boolean';
    const meta = existing?.trackerMeta || {};
    const cacheWristHand = normalizeWristHand(meta?.wristHand);
    const cacheVersion = String(meta?.version || '');
    const objectMeta = existing?.objectDetectorMeta || {};
    const expectedObjectModel = String(config?.tracking?.objectDetectorModel || 'Davidsv/CourtSide-Computer-Vision-v1');
    const matchesObjectConfig = config?.tracking?.objectDetectorEnabled === false || String(objectMeta?.model || '') === expectedObjectModel;
    const shouldRetryObject = config?.tracking?.objectDetectorEnabled !== false
      && config?.tracking?.objectDetectorRetryUnavailable !== false
      && existing?.objectRuntimeAvailable === false;
    const matchesTrackerConfig = cacheWristHand === wristHand
      && cacheVersion === TRACKER_CACHE_VERSION
      && matchesObjectConfig
      && !shouldRetryObject;
    if (hasPoseTrack && hasPoseRuntimeFlag && hasObjectRuntimeFlag && matchesTrackerConfig) {
      return { tracks: existing, source: 'cache' };
    }
    try {
      await generateTracks(videoPath, sidecarPath, { handedness: wristHand });
      return {
        tracks: await readJson(sidecarPath, null),
        source: 'regenerated'
      };
    } catch (err) {
      return {
        tracks: existing,
        source: 'cache_legacy',
        error: `auto_tracking_failed: ${err.message}`
      };
    }
  }

  try {
    await generateTracks(videoPath, sidecarPath, { handedness: wristHand });
  } catch (err) {
    return {
      tracks: null,
      source: 'none',
      error: `auto_tracking_failed: ${err.message}`
    };
  }

  return {
    tracks: await readJson(sidecarPath, null),
    source: 'generated'
  };
}
