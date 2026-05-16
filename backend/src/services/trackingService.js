import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { readJson } from '../utils/fs.js';
import { config } from '../config.js';

export const TRACKER_CACHE_VERSION = 'wrist-hand-v4-subject-gated-fallback';

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
  if (!hasPoseTrack || !hasPoseRuntimeFlag) {
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

export async function getOrCreateTracks(videoPath, options = {}) {
  const sidecarPath = `${videoPath}.tracks.json`;
  const wristHand = normalizeWristHand(options?.handedness);
  if (await fileExists(sidecarPath)) {
    const existing = await readJson(sidecarPath, null);
    const hasPoseTrack = Array.isArray(existing?.poseTrack);
    const hasPoseRuntimeFlag = typeof existing?.poseRuntimeAvailable === 'boolean';
    const meta = existing?.trackerMeta || {};
    const cacheWristHand = normalizeWristHand(meta?.wristHand);
    const cacheVersion = String(meta?.version || '');
    const matchesTrackerConfig = cacheWristHand === wristHand && cacheVersion === TRACKER_CACHE_VERSION;
    if (hasPoseTrack && hasPoseRuntimeFlag && matchesTrackerConfig) {
      return { tracks: existing, source: 'cache' };
    }
    try {
      await runPythonTracker(videoPath, sidecarPath, { handedness: wristHand });
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
    await runPythonTracker(videoPath, sidecarPath, { handedness: wristHand });
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
