import path from 'node:path';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { ensureDir, readJson, writeJson } from '../utils/fs.js';
import { downloadYoutubeSource } from './ytdlp.js';

export const CLIP_META_VERSION = 'clip-meta-v4';

function proClipPath(proVideoId) {
  return path.join(config.prosDir, `${proVideoId}.mp4`);
}

function sourcePathForUrl(youtubeUrl) {
  const hash = crypto.createHash('sha1').update(String(youtubeUrl)).digest('hex').slice(0, 12);
  return path.join(config.prosSourcesDir, `src-${hash}.mp4`);
}

function clipMetaPath(localPath) {
  return `${localPath}.meta.json`;
}

function normalizedMarkerPath(localPath) {
  return `${localPath}.normalized.v2`;
}

function runCmd(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let settled = false;
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
      resolve();
    });
  });
}

async function probeMediaStats(localPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-v',
      'error',
      '-show_entries',
      'format=duration:stream=index,codec_type,avg_frame_rate,r_frame_rate,duration',
      '-of',
      'json',
      localPath
    ];
    const child = spawn('ffprobe', args, { stdio: ['ignore', 'pipe', 'pipe'] });
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
      reject(err);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      if (code !== 0) {
        reject(new Error(`ffprobe media stats failed (${code}): ${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout || '{}'));
      } catch (err) {
        reject(new Error(`invalid_ffprobe_json: ${err.message}`));
      }
    });
  });
}

function parseFpsFraction(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  if (!value.includes('/')) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  const [a, b] = value.split('/');
  const n = Number(a);
  const d = Number(b);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
  const fps = n / d;
  return Number.isFinite(fps) && fps > 0 ? fps : null;
}

function pickOutputFps({ targetFps, sourceFps }) {
  const target = Number(targetFps);
  const source = Number(sourceFps);
  if (!Number.isFinite(target) || target <= 0) return 60;
  if (!Number.isFinite(source) || source <= 0) return target;
  return Math.max(1, Math.min(target, source));
}

function collectQcIssues({ targetFps, expectedDuration, stats, sourceFps = null, requestedTargetFps = null }) {
  const formatDuration = Number(stats?.format?.duration);
  const streams = Array.isArray(stats?.streams) ? stats.streams : [];
  const video = streams.find((s) => s?.codec_type === 'video') || null;
  const audio = streams.find((s) => s?.codec_type === 'audio') || null;
  const videoDuration = Number(video?.duration);
  const audioDuration = Number(audio?.duration);
  const videoFps = parseFpsFraction(video?.avg_frame_rate) || parseFpsFraction(video?.r_frame_rate);

  const fpsTolerance = 0.2;
  const durationToleranceSec = 0.030;
  const expectedToleranceSec = 0.120;

  const issues = [];
  if (Number.isFinite(videoFps) && Math.abs(videoFps - targetFps) > fpsTolerance) {
    issues.push({
      code: 'clip_fps_mismatch',
      expectedFps: Number(targetFps),
      actualFps: Number(videoFps)
    });
  }

  if (Number.isFinite(videoDuration) && Number.isFinite(audioDuration)) {
    const drift = Math.abs(videoDuration - audioDuration);
    if (drift > durationToleranceSec) {
      issues.push({
        code: 'av_duration_drift',
        driftSec: Number(drift),
        videoDurationSec: Number(videoDuration),
        audioDurationSec: Number(audioDuration)
      });
    }
  }

  if (Number.isFinite(formatDuration) && Number.isFinite(expectedDuration)) {
    const delta = Math.abs(formatDuration - expectedDuration);
    if (delta > expectedToleranceSec) {
      issues.push({
        code: 'clip_duration_delta',
        expectedDurationSec: Number(expectedDuration),
        actualDurationSec: Number(formatDuration),
        deltaSec: Number(delta)
      });
    }
  }

  return {
    targetFps: Number(targetFps),
    requestedTargetFps: Number.isFinite(Number(requestedTargetFps)) ? Number(requestedTargetFps) : null,
    sourceFps: Number.isFinite(Number(sourceFps)) ? Number(sourceFps) : null,
    videoFps: Number.isFinite(videoFps) ? Number(videoFps) : null,
    expectedDurationSec: Number.isFinite(expectedDuration) ? Number(expectedDuration) : null,
    formatDurationSec: Number.isFinite(formatDuration) ? Number(formatDuration) : null,
    videoDurationSec: Number.isFinite(videoDuration) ? Number(videoDuration) : null,
    audioDurationSec: Number.isFinite(audioDuration) ? Number(audioDuration) : null,
    issues
  };
}

function warnIfQcIssue({ outPath, qc }) {
  const issues = Array.isArray(qc?.issues) ? qc.issues : [];
  for (const issue of issues) {
    if (issue.code === 'clip_fps_mismatch') {
      console.warn(
        `[qc_warn] clip_fps_mismatch file=${path.basename(outPath)} expected=${Number(issue.expectedFps).toFixed(3)} actual=${Number(issue.actualFps).toFixed(3)}`
      );
    } else if (issue.code === 'av_duration_drift') {
      console.warn(
        `[qc_warn] av_duration_drift file=${path.basename(outPath)} driftSec=${Number(issue.driftSec).toFixed(4)} videoSec=${Number(issue.videoDurationSec).toFixed(4)} audioSec=${Number(issue.audioDurationSec).toFixed(4)}`
      );
    } else if (issue.code === 'clip_duration_delta') {
      console.warn(
        `[qc_warn] clip_duration_delta file=${path.basename(outPath)} expectedSec=${Number(issue.expectedDurationSec).toFixed(4)} actualSec=${Number(issue.actualDurationSec).toFixed(4)} deltaSec=${Number(issue.deltaSec).toFixed(4)}`
      );
    }
  }
}

async function probeDurationSeconds(localPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=nw=1:nk=1',
      localPath
    ];
    const child = spawn('ffprobe', args, { stdio: ['ignore', 'pipe', 'pipe'] });
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
      reject(err);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      if (code !== 0) {
        reject(new Error(`ffprobe duration failed (${code}): ${stderr}`));
        return;
      }
      const value = Number(stdout.trim());
      if (!Number.isFinite(value) || value <= 0) {
        reject(new Error(`invalid_duration_from_ffprobe: ${stdout.trim()}`));
        return;
      }
      resolve(value);
    });
  });
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function validateVideoClip(localPath) {
  try {
    const stat = await fs.stat(localPath);
    if (stat.size < 100 * 1024) {
      return false;
    }
  } catch {
    return false;
  }

  try {
    await runCmd('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=codec_type',
      '-of',
      'csv=p=0',
      localPath
    ]);
    return true;
  } catch {
    return false;
  }
}

async function extractAndNormalizeClipFromSource({ sourcePath, outPath, startTime, endTime }) {
  const start = Number(startTime);
  const end = Number(endTime);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new Error(
      `invalid_time_range: startTime (${startTime}) and endTime (${endTime}) must be numbers with endTime > startTime`
    );
  }

  const [outW, outH] = String(config.output.resolution || '1280x720').split('x');
  const requestedTargetFps = Number(config.output.fps || 60);
  const sourceStats = await probeMediaStats(sourcePath).catch(() => null);
  const sourceStreams = Array.isArray(sourceStats?.streams) ? sourceStats.streams : [];
  const sourceVideo = sourceStreams.find((s) => s?.codec_type === 'video') || null;
  const sourceFps = parseFpsFraction(sourceVideo?.avg_frame_rate) || parseFpsFraction(sourceVideo?.r_frame_rate);
  const sourceVideoDuration = Number(sourceVideo?.duration);
  if (Number.isFinite(sourceVideoDuration) && sourceVideoDuration > 0) {
    const epsilonSec = 0.01;
    if (start >= (sourceVideoDuration - epsilonSec)) {
      throw new Error(
        `clip_time_out_of_video_range: start=${start.toFixed(3)}s videoDuration=${sourceVideoDuration.toFixed(3)}s`
      );
    }
    if (end > (sourceVideoDuration + epsilonSec)) {
      throw new Error(
        `clip_time_out_of_video_range: end=${end.toFixed(3)}s videoDuration=${sourceVideoDuration.toFixed(3)}s`
      );
    }
  }
  const targetFps = pickOutputFps({ targetFps: requestedTargetFps, sourceFps });
  const tmpOut = `${outPath}.tmp.mp4`;

  // TODO: Keep analysis clips normalized to fixed CFR for stable modeling,
  // while optionally producing a separate highest-FPS playback asset for UI detail review.
  await runCmd('ffmpeg', [
    '-y',
    '-ss',
    String(start),
    '-to',
    String(end),
    '-i',
    sourcePath,
    '-map',
    '0:v:0',
    '-map',
    '0:a:0?',
    '-vf',
    `scale=${outW}:${outH},fps=${targetFps}`,
    '-fps_mode',
    'cfr',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '20',
    '-pix_fmt',
    'yuv420p',
    '-g',
    '1',
    '-keyint_min',
    '1',
    '-sc_threshold',
    '0',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-ar',
    '48000',
    '-ac',
    '1',
    // End muxing at the shortest stream to avoid tiny A/V tail drift in generated clips.
    '-shortest',
    '-movflags',
    '+faststart',
    tmpOut
  ]);

  const outputDuration = await probeDurationSeconds(tmpOut);
  const expectedDuration = end - start;
  if (outputDuration < expectedDuration * 0.70) {
    await fs.unlink(tmpOut).catch(() => {});
    throw new Error(
      `clip_duration_too_short: expected=${expectedDuration.toFixed(3)}s output=${outputDuration.toFixed(3)}s`
    );
  }

  const stats = await probeMediaStats(tmpOut);
  const qc = collectQcIssues({
    targetFps,
    sourceFps,
    requestedTargetFps,
    expectedDuration,
    stats
  });
  warnIfQcIssue({ outPath: tmpOut, qc });

  await fs.rename(tmpOut, outPath);
  await fs.writeFile(normalizedMarkerPath(outPath), 'ok', 'utf-8');
  return { qc, outputFps: targetFps };
}

async function ensureSourceVideoAvailable(youtubeUrl) {
  const sourcePath = sourcePathForUrl(youtubeUrl);
  const valid = await validateVideoClip(sourcePath);
  let sane = false;
  if (valid) {
    const stats = await probeMediaStats(sourcePath).catch(() => null);
    const streams = Array.isArray(stats?.streams) ? stats.streams : [];
    const video = streams.find((s) => s?.codec_type === 'video') || null;
    const formatDuration = Number(stats?.format?.duration);
    const videoDuration = Number(video?.duration);
    // Some merged sources can be malformed where container/audio duration is much longer than video.
    sane = Number.isFinite(videoDuration) && videoDuration > 0;
    if (sane && Number.isFinite(formatDuration) && formatDuration > 0) {
      sane = videoDuration >= (formatDuration * 0.90);
    }
  }
  if (valid && sane) return sourcePath;

  await fs.unlink(sourcePath).catch(() => {});
  await downloadYoutubeSource({
    youtubeUrl,
    outPath: sourcePath
  });

  const ok = await validateVideoClip(sourcePath);
  const stats = ok ? await probeMediaStats(sourcePath).catch(() => null) : null;
  const streams = Array.isArray(stats?.streams) ? stats.streams : [];
  const video = streams.find((s) => s?.codec_type === 'video') || null;
  const formatDuration = Number(stats?.format?.duration);
  const videoDuration = Number(video?.duration);
  let saneAfterDownload = Number.isFinite(videoDuration) && videoDuration > 0;
  if (saneAfterDownload && Number.isFinite(formatDuration) && formatDuration > 0) {
    saneAfterDownload = videoDuration >= (formatDuration * 0.90);
  }
  if (!ok || !saneAfterDownload) {
    throw new Error(`invalid_source_clip_after_download: ${youtubeUrl}`);
  }
  return sourcePath;
}

async function deleteClipAndDerived(localPath) {
  await fs.unlink(localPath).catch(() => {});
  await fs.unlink(`${localPath}.tracks.json`).catch(() => {});
  await fs.unlink(`${localPath}.audio_peaks.json`).catch(() => {});
  await fs.unlink(normalizedMarkerPath(localPath)).catch(() => {});
  await fs.unlink(clipMetaPath(localPath)).catch(() => {});
}

function expectedClipMeta(entry) {
  return {
    schemaVersion: CLIP_META_VERSION,
    youtubeUrl: entry.youtubeUrl,
    startTime: Number(entry.startTime),
    endTime: Number(entry.endTime),
    output: {
      resolution: String(config.output.resolution || '1280x720'),
      targetFps: Number(config.output.fps || 60),
      fpsPolicy: 'cap_to_source'
    },
    includeAudio: true
  };
}

function clipMetaMatches(meta, expected) {
  if (!meta) return false;
  return (
    meta.schemaVersion === expected.schemaVersion
    && meta.youtubeUrl === expected.youtubeUrl
    && Number(meta.startTime) === Number(expected.startTime)
    && Number(meta.endTime) === Number(expected.endTime)
    && String(meta.output?.resolution) === String(expected.output.resolution)
    && Number(meta.output?.targetFps) === Number(expected.output.targetFps)
    && String(meta.output?.fpsPolicy || '') === String(expected.output.fpsPolicy || '')
    && Boolean(meta.includeAudio) === Boolean(expected.includeAudio)
  );
}

async function ensureFreshProClip(entry, localPath) {
  await deleteClipAndDerived(localPath);
  const sourcePath = await ensureSourceVideoAvailable(entry.youtubeUrl);

  const extraction = await extractAndNormalizeClipFromSource({
    sourcePath,
    outPath: localPath,
    startTime: entry.startTime,
    endTime: entry.endTime
  });

  const ok = await validateVideoClip(localPath);
  if (!ok) {
    throw new Error(`invalid_pro_clip_after_generation: ${entry.id}`);
  }

  const meta = {
    ...expectedClipMeta(entry),
    output: {
      ...expectedClipMeta(entry).output,
      outputFps: extraction.outputFps
    },
    qc: {
      checkedAt: new Date().toISOString(),
      ...extraction.qc
    }
  };
  await writeJson(clipMetaPath(localPath), meta);
  return meta;
}

export async function initProLibrary() {
  await ensureDir(config.prosDir);
  await ensureDir(config.prosSourcesDir);
}

export async function listProVideos() {
  const withAvailability = [];
  for (const item of config.proVideos) {
    const clipPath = proClipPath(item.id);
    const available = await validateVideoClip(clipPath);

    withAvailability.push({
      ...item,
      available,
      localPath: available ? clipPath : null
    });
  }
  return withAvailability;
}

export async function ensureProVideoAvailable(proVideoId) {
  const entry = config.proVideos.find((p) => p.id === proVideoId);
  if (!entry) {
    throw new Error(`Unknown pro video id: ${proVideoId}`);
  }

  // TODO: handedness support. v1 assumes right-handed pro + amateur.
  const localPath = proClipPath(entry.id);
  const expectedMeta = expectedClipMeta(entry);

  const existsAndValid = await validateVideoClip(localPath);
  const meta = await readJson(clipMetaPath(localPath), null);
  const normalized = await fileExists(normalizedMarkerPath(localPath));

  if (existsAndValid && normalized && clipMetaMatches(meta, expectedMeta)) {
    let effectiveMeta = meta;
    if (!effectiveMeta?.qc) {
      const stats = await probeMediaStats(localPath).catch(() => null);
      if (stats) {
        const qc = collectQcIssues({
          targetFps: Number(expectedMeta.output?.fps || config.output.fps || 60),
          expectedDuration: Number(entry.endTime) - Number(entry.startTime),
          stats
        });
        effectiveMeta = {
          ...expectedMeta,
          ...(effectiveMeta || {}),
          qc: {
            checkedAt: new Date().toISOString(),
            ...qc
          }
        };
        await writeJson(clipMetaPath(localPath), effectiveMeta);
      }
    }
    return { ...entry, localPath, clipMeta: effectiveMeta };
  }

  const freshMeta = await ensureFreshProClip(entry, localPath);
  return { ...entry, localPath, clipMeta: freshMeta };
}

export async function inspectProVideoRefreshNeeds(proVideoId) {
  const entry = config.proVideos.find((p) => p.id === proVideoId);
  if (!entry) {
    return {
      id: proVideoId,
      localPath: proClipPath(proVideoId),
      clipNeedsRefresh: true,
      clipReason: 'missing_config_entry'
    };
  }
  const localPath = proClipPath(entry.id);
  const existsAndValid = await validateVideoClip(localPath);
  if (!existsAndValid) {
    return {
      id: entry.id,
      localPath,
      clipNeedsRefresh: true,
      clipReason: 'missing_or_invalid_clip'
    };
  }
  const normalized = await fileExists(normalizedMarkerPath(localPath));
  if (!normalized) {
    return {
      id: entry.id,
      localPath,
      clipNeedsRefresh: true,
      clipReason: 'missing_normalized_marker'
    };
  }
  const meta = await readJson(clipMetaPath(localPath), null);
  const expectedMeta = expectedClipMeta(entry);
  if (!clipMetaMatches(meta, expectedMeta)) {
    return {
      id: entry.id,
      localPath,
      clipNeedsRefresh: true,
      clipReason: 'clip_meta_mismatch'
    };
  }
  return {
    id: entry.id,
    localPath,
    clipNeedsRefresh: false,
    clipReason: null
  };
}
