import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';

export const AUDIO_CACHE_VERSION = 'audio-peaks-v5';

function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const idx = Math.floor((sorted.length - 1) * q);
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

async function readJsonSafe(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeJsonSafe(filePath, payload) {
  try {
    await fs.writeFile(filePath, `${JSON.stringify(payload)}\n`, 'utf-8');
  } catch {
    // Best-effort cache write.
  }
}

export async function inspectAudioPeaksCache(videoPath) {
  const sidecarPath = `${videoPath}.audio_peaks.json`;
  const payload = await readJsonSafe(sidecarPath);
  if (!payload) return { ok: false, reason: 'missing_or_invalid_audio_sidecar' };
  if (String(payload?.version || '') !== AUDIO_CACHE_VERSION) {
    return { ok: false, reason: 'audio_cache_version_mismatch' };
  }
  if (!Array.isArray(payload?.waveformBins)) {
    return { ok: false, reason: 'invalid_audio_schema' };
  }
  return { ok: true, reason: null };
}

function runFfmpegPcm(videoPath, sampleRate = 16000) {
  return new Promise((resolve, reject) => {
    // Bias extraction toward short, bright impact transients and suppress low-frequency crowd rumble.
    const filterChain = 'highpass=f=1400,lowpass=f=6500';
    const args = [
      '-v',
      'error',
      '-i',
      videoPath,
      '-map',
      '0:a:0?',
      '-vn',
      '-ac',
      '1',
      '-ar',
      String(sampleRate),
      '-af',
      filterChain,
      '-f',
      's16le',
      '-acodec',
      'pcm_s16le',
      'pipe:1'
    ];
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdoutChunks = [];
    let stderr = '';
    let settled = false;
    child.stdout.on('data', (chunk) => {
      stdoutChunks.push(chunk);
    });
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
        reject(new Error(`ffmpeg_audio_extract_failed (${code}): ${stderr.trim()}`));
        return;
      }
      resolve(Buffer.concat(stdoutChunks));
    });
  });
}

function buildWaveformBins(samples, binCount = 180) {
  if (!Array.isArray(samples) || samples.length < 2) return [];
  const count = Math.max(16, Math.floor(binCount));
  const bins = Array(count).fill(0);
  const step = samples.length / count;
  for (let i = 0; i < count; i += 1) {
    const start = Math.floor(i * step);
    const end = Math.min(samples.length, Math.max(start + 1, Math.floor((i + 1) * step)));
    let maxV = 0;
    for (let j = start; j < end; j += 1) {
      const v = Number(samples[j]) || 0;
      if (v > maxV) maxV = v;
    }
    bins[i] = maxV;
  }
  const sorted = [...bins].sort((a, b) => a - b);
  const norm = Math.max(1e-6, quantile(sorted, 0.95));
  return bins.map((v) => Math.max(0, Math.min(1, v / norm)));
}

function detectTransientPeaksFromPcm(pcm, { sampleRate = 16000 } = {}) {
  if (!pcm || pcm.length < 4) {
    return { ok: false, reason: 'empty_audio' };
  }
  const sampleCount = Math.floor(pcm.length / 2);
  if (sampleCount < 128) {
    return { ok: false, reason: 'audio_too_short' };
  }

  const hop = Math.max(80, Math.round(sampleRate * 0.01)); // 10ms
  const win = Math.max(hop * 2, Math.round(sampleRate * 0.02)); // 20ms
  const energies = [];
  const rmsLinear = [];
  const hfRatioLinear = [];
  const timesMs = [];

  for (let start = 0; start + win < sampleCount; start += hop) {
    let sumSq = 0;
    let sumDiffSq = 0;
    let prev = null;
    for (let i = start; i < start + win; i += 1) {
      const s = pcm.readInt16LE(i * 2) / 32768;
      sumSq += s * s;
      if (prev !== null) {
        const d = s - prev;
        sumDiffSq += d * d;
      }
      prev = s;
    }
    const rms = Math.sqrt(sumSq / win);
    const hfRms = Math.sqrt(sumDiffSq / Math.max(1, win - 1));
    const hfRatio = hfRms / Math.max(1e-9, rms);
    rmsLinear.push(rms);
    hfRatioLinear.push(hfRatio);
    energies.push(Math.log10(1e-9 + rms));
    const center = start + Math.floor(win / 2);
    timesMs.push((center / sampleRate) * 1000);
  }

  if (energies.length < 16) {
    return { ok: false, reason: 'insufficient_audio_windows' };
  }

  const radius = 5; // ~50ms smoothing
  const smooth = Array(energies.length).fill(0);
  for (let i = 0; i < energies.length; i += 1) {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - radius); j <= Math.min(energies.length - 1, i + radius); j += 1) {
      sum += energies[j];
      count += 1;
    }
    smooth[i] = count > 0 ? sum / count : energies[i];
  }

  const transient = energies.map((e, i) => Math.max(0, e - smooth[i]));
  const hfSorted = [...hfRatioLinear].sort((a, b) => a - b);
  const hfQ50 = quantile(hfSorted, 0.5);
  const hfQ95 = quantile(hfSorted, 0.95);
  const hfDenom = Math.max(1e-6, hfQ95 - hfQ50);
  const hfNorm = hfRatioLinear.map((v) => clamp01((v - hfQ50) / hfDenom));
  const flux = Array(hfNorm.length).fill(0);
  for (let i = 1; i < hfNorm.length; i += 1) {
    flux[i] = Math.max(0, hfNorm[i] - hfNorm[i - 1]);
  }
  const fluxSorted = [...flux].sort((a, b) => a - b);
  const fluxQ90 = quantile(fluxSorted, 0.9);
  const fluxQ99 = quantile(fluxSorted, 0.99);
  const fluxDenom = Math.max(1e-6, fluxQ99 - fluxQ90);
  const fluxNorm = flux.map((v) => clamp01((v - fluxQ90) / fluxDenom));
  const sorted = [...transient].sort((a, b) => a - b);
  const q90 = quantile(sorted, 0.9);
  const q95 = quantile(sorted, 0.95);
  const q97 = quantile(sorted, 0.97);
  const q99 = quantile(sorted, 0.99);
  const threshold = Math.max(0.010, q97);
  const denom = Math.max(1e-6, q99 - q90);
  const minGap = 6; // ~60ms

  const peaks = [];
  let lastIdx = -9999;
  for (let i = 1; i < transient.length - 1; i += 1) {
    const v = transient[i];
    if (v < threshold) continue;
    if (!(v >= transient[i - 1] && v >= transient[i + 1])) continue;
    if (i - lastIdx < minGap) continue;
    const prevMax = Math.max(
      transient[Math.max(0, i - 1)] ?? 0,
      transient[Math.max(0, i - 2)] ?? 0,
      transient[Math.max(0, i - 3)] ?? 0
    );
    const nextMax = Math.max(
      transient[Math.min(transient.length - 1, i + 1)] ?? 0,
      transient[Math.min(transient.length - 1, i + 2)] ?? 0,
      transient[Math.min(transient.length - 1, i + 3)] ?? 0
    );
    const sharpRise = Math.max(0, v - prevMax);
    const sharpFall = Math.max(0, v - nextMax);
    const sharpness = Math.min(sharpRise, sharpFall);
    const sharpnessThreshold = Math.max(0.0025, 0.22 * Math.max(1e-6, q95 - q90));
    if (sharpness < sharpnessThreshold) continue;
    const transientStrength = clamp01((v - q90) / denom);
    const hfScore = hfNorm[i];
    const fluxScore = fluxNorm[i];
    const strength = clamp01(0.58 * transientStrength + 0.27 * hfScore + 0.15 * fluxScore);
    if (strength < 0.32) continue;
    peaks.push({
      timeMs: Math.round(timesMs[i]),
      strength,
      transientStrength,
      hfScore,
      fluxScore
    });
    lastIdx = i;
  }

  const waveformBins = buildWaveformBins(rmsLinear, 180);

  return {
    ok: true,
    peaks,
    waveformBins,
    stats: {
      q90,
      q95,
      q97,
      q99,
      hfQ50,
      hfQ95,
      fluxQ90,
      fluxQ99,
      threshold,
      windowCount: transient.length
    }
  };
}

function clamp01(x) {
  return Math.max(0, Math.min(1, Number(x) || 0));
}

export async function getOrCreateAudioPeaks(videoPath, options = {}) {
  const sampleRate = Number(options.sampleRate || 16000);
  const cachePath = `${videoPath}.audio_peaks.json`;
  const cached = await readJsonSafe(cachePath);
  if (cached?.version === AUDIO_CACHE_VERSION) {
    return { ...cached, source: 'cache' };
  }

  try {
    const pcm = await runFfmpegPcm(videoPath, sampleRate);
    const detected = detectTransientPeaksFromPcm(pcm, { sampleRate });
    if (!detected.ok) {
      const payload = {
        version: AUDIO_CACHE_VERSION,
        ok: false,
        reason: detected.reason,
        sampleRate,
        peaks: [],
        waveformBins: [],
        stats: null
      };
      await writeJsonSafe(cachePath, payload);
      return { ...payload, source: 'generated' };
    }
    const payload = {
      version: AUDIO_CACHE_VERSION,
      ok: true,
      reason: null,
      sampleRate,
      peaks: detected.peaks,
      waveformBins: detected.waveformBins || [],
      stats: detected.stats
    };
    await writeJsonSafe(cachePath, payload);
    return { ...payload, source: 'generated' };
  } catch (err) {
    return {
      version: AUDIO_CACHE_VERSION,
      ok: false,
      reason: err.message,
      sampleRate,
      peaks: [],
      waveformBins: [],
      stats: null,
      source: 'error'
    };
  }
}
