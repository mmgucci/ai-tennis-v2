import path from 'node:path';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { config } from '../config.js';
import { detectContactEvent } from './contactDetection.js';
import { writeJson } from '../utils/fs.js';
import { getOrCreateTracks } from './trackingService.js';
import { getOrCreateAudioPeaks } from './audioAnalysis.js';

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
        reject(new Error(`${cmd} failed (${code}): ${stderr}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function estimateDurationFromTailPackets(videoPath) {
  const probe = async (streamSelector) => {
    const args = [
      '-v',
      'error',
      '-sseof',
      '-12',
      ...(streamSelector ? ['-select_streams', streamSelector] : []),
      '-show_entries',
      'packet=pts_time,duration_time',
      '-of',
      'json',
      videoPath
    ];
    const { stdout } = await runCmd('ffprobe', args);
    const parsed = JSON.parse(stdout || '{}');
    const packets = Array.isArray(parsed?.packets) ? parsed.packets : [];
    let maxEnd = 0;
    for (const p of packets) {
      const pts = Number(p?.pts_time);
      const dur = Number(p?.duration_time);
      if (!Number.isFinite(pts)) continue;
      const end = pts + (Number.isFinite(dur) ? Math.max(0, dur) : 0);
      if (end > maxEnd) maxEnd = end;
    }
    return Number.isFinite(maxEnd) && maxEnd > 0 ? maxEnd : null;
  };

  try {
    const v = await probe('v:0');
    if (Number.isFinite(v) && v > 0) return v;
  } catch {
    // try audio/all fallback
  }
  try {
    const a = await probe('a:0');
    if (Number.isFinite(a) && a > 0) return a;
  } catch {
    // fall through
  }
  try {
    const any = await probe(null);
    if (Number.isFinite(any) && any > 0) return any;
  } catch {
    // ignore
  }
  return 0;
}

async function estimateDurationByDecode(videoPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-hide_banner',
      '-i',
      videoPath,
      '-map',
      '0:v:0',
      '-an',
      '-f',
      'null',
      '-'
    ];
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let settled = false;
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      if (err.code === 'ENOENT') {
        reject(new Error("missing_dependency: 'ffmpeg' not found in PATH"));
        return;
      }
      reject(err);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      if (code !== 0) {
        reject(new Error(`ffmpeg_duration_probe_failed (${code})`));
        return;
      }
      const matches = [...stderr.matchAll(/time=([0-9:.]+)/g)];
      if (!matches.length) {
        resolve(0);
        return;
      }
      const last = String(matches[matches.length - 1][1] || '').trim();
      const parts = last.split(':').map(Number);
      if (parts.length !== 3 || parts.some((p) => !Number.isFinite(p))) {
        resolve(0);
        return;
      }
      const sec = (parts[0] * 3600) + (parts[1] * 60) + parts[2];
      resolve(Number.isFinite(sec) && sec > 0 ? sec : 0);
    });
  });
}

export async function getVideoMetadata(videoPath) {
  const args = [
    '-v',
    'error',
    '-show_entries',
    'stream=index,codec_type,r_frame_rate,avg_frame_rate,width,height,duration:format=duration',
    '-of',
    'json',
    videoPath
  ];
  const { stdout } = await runCmd('ffprobe', args);
  const parsed = JSON.parse(stdout);
  const streams = Array.isArray(parsed?.streams) ? parsed.streams : [];
  const stream = streams.find((s) => String(s?.codec_type || '').toLowerCase() === 'video') || streams[0] || {};
  const formatDuration = Number(parsed?.format?.duration || 0);

  let fps = 60;
  const rates = [stream.r_frame_rate, stream.avg_frame_rate];
  for (const r of rates) {
    if (typeof r === 'string' && r.includes('/')) {
      const [n, d] = r.split('/').map(Number);
      if (d && Number.isFinite(n / d) && (n / d) > 0) {
        fps = n / d;
        break;
      }
    } else if (Number.isFinite(Number(r)) && Number(r) > 0) {
      fps = Number(r);
      break;
    }
  }

  const streamDuration = Number(stream.duration || 0);
  let duration = Number.isFinite(streamDuration) && streamDuration > 0
    ? streamDuration
    : (Number.isFinite(formatDuration) && formatDuration > 0 ? formatDuration : 0);
  if (!Number.isFinite(duration) || duration <= 0) {
    duration = await estimateDurationFromTailPackets(videoPath);
  }
  if (!Number.isFinite(duration) || duration <= 0) {
    duration = await estimateDurationByDecode(videoPath);
  }

  return {
    fps,
    width: Number(stream.width || 0),
    height: Number(stream.height || 0),
    duration
  };
}

export async function processVideoForContact(videoPath, detectionContext = {}, processingOptions = {}) {
  const metadata = await getVideoMetadata(videoPath);
  const tracking = await getOrCreateTracks(videoPath, {
    handedness: detectionContext?.handedness
  });
  const audioAssistEnabled = Boolean(config?.detection?.audioAssistEnabled);
  const audio = audioAssistEnabled
    ? await getOrCreateAudioPeaks(videoPath, { sampleRate: config?.detection?.audioSampleRate })
    : { ok: false, reason: 'audio_assist_disabled', peaks: [], source: 'disabled', stats: null };
  const tracks = tracking.tracks;
  const ballTrack = tracks?.ballTrack ?? [];
  const racketTrack = tracks?.racketTrack ?? [];
  const poseTrack = tracks?.poseTrack ?? [];

  const event = detectContactEvent({
    ballTrack,
    racketTrack,
    poseTrack,
    fps: metadata.fps,
    width: metadata.width,
    height: metadata.height,
    context: detectionContext,
    audioPeaks: audio?.ok ? audio.peaks : [],
    detectionOptions: {
      useBallForContact: Boolean(config?.detection?.useBallForContact),
      audioAssistEnabled,
      audioAssistWeight: Number(config?.detection?.audioAssistWeight ?? 0.14),
      audioAssistWindowMs: Number(config?.detection?.audioAssistWindowMs ?? 45),
      debugCaptureCandidates: Boolean(processingOptions?.debugCaptureCandidates)
    }
  });

  return {
    metadata,
    event,
    tracksAvailable: Boolean(tracks),
    trackingSource: tracking.source,
    trackingError: tracking.error ?? null,
    trackMeta: tracks?.trackerMeta || null,
    audioAssist: {
      enabled: audioAssistEnabled,
      available: Boolean(audio?.ok),
      source: audio?.source ?? null,
      reason: audio?.reason ?? null,
      peakCount: Array.isArray(audio?.peaks) ? audio.peaks.length : 0,
      waveformBins: Array.isArray(audio?.waveformBins) ? audio.waveformBins : [],
      peaks: Array.isArray(audio?.peaks)
        ? audio.peaks.map((p) => ({
          timeMs: Math.round(Number(p?.timeMs) || 0),
          strength: Math.max(0, Math.min(1, Number(p?.strength) || 0))
        }))
        : []
    }
  };
}

export async function validateUploadDuration(videoPath) {
  const meta = await getVideoMetadata(videoPath);
  if (meta.duration > config.maxUploadSeconds) {
    throw new Error(`Upload too long: ${meta.duration.toFixed(2)}s (max ${config.maxUploadSeconds}s)`);
  }
  return meta;
}

export async function buildComparisonPayload({
  amateurVideoPath,
  proVideoPath,
  amateurDetectionContext = {},
  proDetectionContext = {}
}) {
  const amateur = await processVideoForContact(amateurVideoPath, amateurDetectionContext);
  const pro = await processVideoForContact(proVideoPath, proDetectionContext);

  const amateurTs = amateur.event.found ? amateur.event.timestampMs : null;
  const proTs = pro.event.found ? pro.event.timestampMs : null;

  const alignmentOffsetMs = amateurTs !== null && proTs !== null ? proTs - amateurTs : null;

  return {
    amateur,
    pro,
    alignment: {
      mode: 'offset',
      anchorEvent: 'ball_contact',
      alignmentOffsetMs,
      // TODO: add normalization mode toggle once multiple events exist.
      // Normalization should equalize duration between first and last event.
      normalizationReady: false
    }
  };
}

export async function persistAnalysis(sessionId, payload) {
  const outPath = path.join(config.processedDir, `${sessionId}.analysis.json`);
  await fs.mkdir(config.processedDir, { recursive: true });
  await writeJson(outPath, payload);
  return outPath;
}
