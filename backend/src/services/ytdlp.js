import { spawn } from 'node:child_process';

function secondsToTimestamp(value) {
  const sec = Math.max(0, Number(value) || 0);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
}

export function downloadYoutubeClip({ youtubeUrl, outPath, startTime, endTime }) {
  const start = Number(startTime);
  const end = Number(endTime);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return Promise.reject(
      new Error(
        `invalid_time_range: startTime (${startTime}) and endTime (${endTime}) must be numbers with endTime > startTime`
      )
    );
  }

  return new Promise((resolve, reject) => {
    const section = `*${secondsToTimestamp(start)}-${secondsToTimestamp(end)}`;
    const args = [
      '--download-sections',
      section,
      '-f',
      'mp4',
      '-o',
      outPath,
      youtubeUrl
    ];

    const child = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let stderr = '';
    let settled = false;
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      if (err.code === 'ENOENT') {
        reject(new Error(`missing_dependency: 'yt-dlp' not found in PATH`));
        return;
      }
      reject(err);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      if (code !== 0) {
        reject(new Error(`yt-dlp failed (${code}): ${stderr}`));
        return;
      }
      resolve();
    });
  });
}

export function downloadYoutubeSource({ youtubeUrl, outPath }) {
  return new Promise((resolve, reject) => {
    const args = [
      // Prefer broadly compatible AVC+M4A source to avoid occasional malformed AV1 MP4 merges.
      '-f',
      'bestvideo[vcodec^=avc1][ext=mp4]+bestaudio[ext=m4a]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
      '--merge-output-format',
      'mp4',
      '-o',
      outPath,
      youtubeUrl
    ];

    const child = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let stderr = '';
    let settled = false;
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      if (err.code === 'ENOENT') {
        reject(new Error(`missing_dependency: 'yt-dlp' not found in PATH`));
        return;
      }
      reject(err);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      if (code !== 0) {
        reject(new Error(`yt-dlp source download failed (${code}): ${stderr}`));
        return;
      }
      resolve();
    });
  });
}
