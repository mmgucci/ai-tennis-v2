import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { config, reloadConfigFromDisk } from './config.js';
import { ensureDir } from './utils/fs.js';
import { initSessionStore, saveSession, listSessions, getSession } from './services/sessionStore.js';
import {
  initProLibrary,
  listProVideos,
  ensureProVideoAvailable,
  inspectProVideoRefreshNeeds
} from './services/proLibrary.js';
import { validateUploadDuration, buildComparisonPayload, persistAnalysis, getVideoMetadata } from './services/videoProcessing.js';
import { CURRENT_GENERATION_VERSION } from './generation.js';
import { computeDiagnosticsDelta, getProDetectionsDiagnostics } from './services/proDiagnostics.js';
import { addProLabelComment, getAllProLabels, removeProLabelComment, upsertProLabel } from './services/proLabels.js';
import { getOrCreateTracks, inspectTrackCache } from './services/trackingService.js';
import { inspectAudioPeaksCache } from './services/audioAnalysis.js';
import { enqueueProVideoProcessing, getProVideoJob, listProVideoJobs } from './services/proVideoJobs.js';
import {
  initUserVideoManagementStore,
  listUserVideoManagementEntries,
  updateUserVideoManagementClientMetrics
} from './services/userVideoManagement.js';
import {
  buildUserClipLabelKey,
  getAllUserClipLabels,
  upsertUserClipLabel
} from './services/userClipLabels.js';
import {
  enqueueUserVideoJob,
  getUserVideoJob,
  listUserVideoJobs
} from './services/userVideoJobs.js';
import {
  createDetectionRun,
  getDetectionRun,
  getLatestDetectionRun,
  getStableDetectionRun,
  initDetectionRunsStore,
  listDetectionRuns,
  maybeCreateAutoDetectionRun,
  setStableDetectionRun
} from './services/detectionRuns.js';

const app = express();
app.use(cors());
app.use(express.json());

await ensureDir(config.uploadsDir);
await ensureDir(config.userClipsDir);
await ensureDir(config.processedDir);
await ensureDir(config.debugFramesDir);
await initDetectionRunsStore();
await initSessionStore();
await initProLibrary();
await initUserVideoManagementStore();

app.use('/files/uploads', express.static(config.uploadsDir));
app.use('/files/user-clips', express.static(config.userClipsDir));
app.use('/files/pros', express.static(config.prosDir));
app.use('/files/debug', express.static(config.debugFramesDir));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, config.uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '.mp4') || '.mp4';
    cb(null, `${uuidv4()}${ext.toLowerCase()}`);
  }
});

function fileFilter(req, file, cb) {
  const mime = String(file?.mimetype || '').toLowerCase();
  const ext = String(path.extname(file?.originalname || '') || '').toLowerCase();
  const allowedMime = new Set([
    'video/mp4',
    'video/quicktime',
    'video/webm',
    'video/x-matroska',
    'video/mp2t',
    'video/avi',
    'video/x-msvideo',
    'video/mpeg',
    'video/3gpp',
    'video/3gpp2',
    'video/x-ms-wmv',
    'video/x-flv',
    'video/hevc',
    'video/h265'
  ]);
  const allowedExt = new Set([
    '.mp4',
    '.mov',
    '.webm',
    '.m4v',
    '.mkv',
    '.avi',
    '.mpeg',
    '.mpg',
    '.3gp',
    '.3g2',
    '.mts',
    '.m2ts',
    '.ts',
    '.wmv',
    '.flv',
    '.hevc',
    '.h265'
  ]);

  const mimeLooksVideo = mime.startsWith('video/');
  const extAllowed = allowedExt.has(ext);
  const mimeAllowed = allowedMime.has(mime);
  const mimeUnknownButSafe = (mime === '' || mime === 'application/octet-stream') && extAllowed;
  const extensionOnlyFallback = extAllowed;

  if (!(mimeAllowed || (mimeLooksVideo && extAllowed) || mimeUnknownButSafe || extensionOnlyFallback)) {
    cb(new Error('unsupported_file_type'));
    return;
  }
  cb(null, true);
}

const upload = multer({ storage, fileFilter });

async function clearFilesInDir(dirPath, shouldDelete) {
  let removed = 0;
  const entries = await fs.readdir(dirPath, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!shouldDelete(entry.name)) continue;
    await fs.unlink(path.join(dirPath, entry.name)).catch(() => {});
    removed += 1;
  }
  return removed;
}

async function listVideoFilesInDir(dirPath, publicBase) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true }).catch(() => []);
  const items = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const name = entry.name;
    if (name.endsWith('.tracks.json')) continue;
    if (name.endsWith('.normalized.v1')) continue;
    const fullPath = path.join(dirPath, name);
    const stat = await fs.stat(fullPath).catch(() => null);
    if (!stat) continue;
    items.push({
      fileName: name,
      sizeBytes: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      publicUrl: `${publicBase}/${name}`
    });
  }
  items.sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));
  return items;
}

function buildGenerationInfo() {
  return {
    version: CURRENT_GENERATION_VERSION,
    generatedAt: new Date().toISOString()
  };
}

function withGenerationFlags(session) {
  const sessionVersion = session?.generation?.version || 'unknown';
  return {
    ...session,
    currentGenerationVersion: CURRENT_GENERATION_VERSION,
    isOutdatedGeneration: sessionVersion !== CURRENT_GENERATION_VERSION
  };
}

function buildSessionPayload({ id, proVideo, amateurVideo, analysisPath, comparison }) {
  return {
    id,
    createdAt: new Date().toISOString(),
    strokeType: 'serve',
    proVideo,
    amateurVideo,
    analysisPath,
    comparison,
    generation: buildGenerationInfo(),
    todos: [
      'TODO: support left-handed and mixed handedness matching.',
      'TODO: add user-friendly UI for event-not-found state.',
      'TODO: add jump navigation by event markers.',
      'TODO: add normalization toggle once multiple events are available.',
      'TODO: add tracks debug endpoint and future UI toggle for tracking overlay/diagnostics.',
      'TODO: allow manual correction of detected event markers.',
      'TODO: move from local filesystem storage to scalable object storage + DB.'
    ]
  };
}

function localUploadPathFromPublicUrl(publicUrl) {
  if (!publicUrl || !publicUrl.startsWith('/files/uploads/')) {
    throw new Error(`invalid_upload_public_url: ${publicUrl}`);
  }
  return path.join(config.uploadsDir, path.basename(publicUrl));
}

function localUserClipPathFromPublicUrl(publicUrl) {
  if (!publicUrl || !publicUrl.startsWith('/files/user-clips/')) {
    throw new Error(`invalid_user_clip_public_url: ${publicUrl}`);
  }
  return path.join(config.userClipsDir, path.basename(publicUrl));
}

function toClipRelativeDetectedSec(clip) {
  const detected = Number(clip?.detectedContactSec);
  const start = Number(clip?.clipStartSec || 0);
  if (!Number.isFinite(detected)) return null;
  const rel = detected - start;
  return Number.isFinite(rel) ? Math.max(0, rel) : null;
}

function toClipRelativeDetectedFrame(clip, fps = 30) {
  const relSec = toClipRelativeDetectedSec(clip);
  if (!Number.isFinite(relSec)) return null;
  return Math.max(0, Math.round(relSec * Math.max(1, Number(fps) || 30)));
}

function normalizeHasContactFromLabel(label) {
  const direct = String(label?.hasContact || '').trim().toLowerCase();
  if (direct === 'none' || direct === 'single' || direct === 'multiple') return direct;
  if (typeof label?.isServe === 'boolean') {
    return label.isServe ? 'single' : 'none';
  }
  return null;
}

function toSlug(raw) {
  const base = String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  return base || 'video';
}

function nextProVideoIdFromTitle(title, existingIds) {
  const base = toSlug(title);
  if (!existingIds.has(base)) return base;
  let counter = 2;
  while (existingIds.has(`${base}-${counter}`)) counter += 1;
  return `${base}-${counter}`;
}

const proVideosConfigPath = path.join(config.rootDir, 'config', 'pro_videos.json');
const proPlayersConfigPath = path.join(config.rootDir, 'config', 'pro_players.json');

async function appendProVideoToConfig(entry) {
  const raw = await fs.readFile(proVideosConfigPath, 'utf-8');
  const parsed = JSON.parse(raw);
  const list = Array.isArray(parsed?.proVideos) ? parsed.proVideos : [];
  const existingIds = new Set(list.map((x) => String(x?.id || '')));
  const id = nextProVideoIdFromTitle(entry.title, existingIds);
  const nextEntry = { id, ...entry };
  const next = {
    ...parsed,
    proVideos: [...list, nextEntry]
  };
  await fs.writeFile(proVideosConfigPath, `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
  reloadConfigFromDisk();
  return withResolvedPlayer(nextEntry);
}

function normalizePlayerName(raw) {
  const name = String(raw || '').trim().replace(/\s+/g, ' ');
  return name.slice(0, 120);
}

function normalizeHandedness(raw) {
  const value = String(raw || '').trim().toLowerCase();
  return value === 'left' || value === 'right' ? value : null;
}

function normalizePlayerForStorage(player) {
  const id = String(player?.id || '').trim();
  const name = normalizePlayerName(player?.name);
  const handedness = normalizeHandedness(player?.handedness);
  if (!id || !name) return null;
  return {
    id,
    name,
    ...(handedness ? { handedness } : {})
  };
}

function toPlayerSlug(raw) {
  const base = String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  return base || 'player';
}

function nextPlayerIdFromName(name, existingIds) {
  const base = toPlayerSlug(name);
  if (!existingIds.has(base)) return base;
  let counter = 2;
  while (existingIds.has(`${base}-${counter}`)) counter += 1;
  return `${base}-${counter}`;
}

async function readProPlayersConfig() {
  const raw = await fs.readFile(proPlayersConfigPath, 'utf-8').catch(() => '');
  if (!raw) return { proPlayers: [] };
  const parsed = JSON.parse(raw);
  return {
    ...parsed,
    proPlayers: Array.isArray(parsed?.proPlayers)
      ? parsed.proPlayers.map(normalizePlayerForStorage).filter(Boolean)
      : []
  };
}

async function writeProPlayersConfig(players) {
  const next = {
    proPlayers: (players || []).map(normalizePlayerForStorage).filter(Boolean)
  };
  await fs.writeFile(proPlayersConfigPath, `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
  return next;
}

async function ensurePlayerReference(playerName, handedness = null) {
  const normalizedName = normalizePlayerName(playerName);
  if (!normalizedName) return null;
  const playersConfig = await readProPlayersConfig();
  const list = Array.isArray(playersConfig?.proPlayers) ? playersConfig.proPlayers : [];
  const byLowerName = new Map(list.map((p) => [String(p?.name || '').toLowerCase(), p]));
  const existing = byLowerName.get(normalizedName.toLowerCase()) || null;
  const normalizedHandedness = normalizeHandedness(handedness);
  if (existing) {
    if (normalizedHandedness && existing.handedness !== normalizedHandedness) {
      const nextList = list.map((p) => (
        p.id === existing.id
          ? { ...p, handedness: normalizedHandedness }
          : p
      ));
      await writeProPlayersConfig(nextList);
      reloadConfigFromDisk();
      return { id: existing.id, handedness: normalizedHandedness };
    }
    reloadConfigFromDisk();
    return { id: existing.id, handedness: normalizeHandedness(existing.handedness) || normalizedHandedness || null };
  }

  const existingIds = new Set(list.map((p) => String(p?.id || '')));
  const id = nextPlayerIdFromName(normalizedName, existingIds);
  const newPlayer = {
    id,
    name: normalizedName,
    ...(normalizedHandedness ? { handedness: normalizedHandedness } : {})
  };
  await writeProPlayersConfig([...list, newPlayer]);
  reloadConfigFromDisk();
  return { id, handedness: normalizedHandedness || null };
}

function getPlayerById(playerId) {
  const id = String(playerId || '').trim();
  if (!id) return null;
  return (config.proPlayers || []).find((p) => String(p?.id || '') === id) || null;
}

const CAMERA_ANGLE_ALIASES = new Map([
  ['side_front', 'side_frontside'],
  ['side_back', 'side_backside'],
  ['front_side_front', 'front_side_frontside'],
  ['front_side_back', 'front_side_backside'],
  ['behind_side_front', 'behind_side_frontside'],
  ['behind_side_back', 'behind_side_backside']
]);

const ALLOWED_STROKE_TYPES = new Set(['serve']);
const ALLOWED_HANDEDNESS = new Set(['right', 'left']);
const ALLOWED_EVALUATION_SETS = new Set(['core', 'edge']);
const ALLOWED_CAMERA_ANGLES = new Set([
  'behind_server',
  'behind_elevated',
  'behind_broadcast',
  'front_side_frontside',
  'front_side_backside',
  'side_frontside',
  'side_backside',
  'behind_side_frontside',
  'behind_side_backside'
]);
const ALLOWED_COURT_SIDES = new Set(['deuce', 'ad']);

function normalizeCameraAngle(raw) {
  const value = String(raw || '').trim().toLowerCase();
  return CAMERA_ANGLE_ALIASES.get(value) || value;
}

function collectKnownPlayers() {
  return [...(config.proPlayers || [])]
    .map((p) => ({
      name: normalizePlayerName(p?.name),
      handedness: normalizeHandedness(p?.handedness)
    }))
    .filter((p) => Boolean(p.name))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function collectKnownPlayerNames() {
  return collectKnownPlayers().map((p) => p.name);
}

function withResolvedPlayer(video) {
  const player = getPlayerById(video?.playerId);
  return {
    ...video,
    playerName: player ? String(player.name || '') : (normalizePlayerName(video?.playerName) || null)
  };
}

async function migrateLegacyPlayersToReferences() {
  const raw = await fs.readFile(proVideosConfigPath, 'utf-8');
  const parsed = JSON.parse(raw);
  const list = Array.isArray(parsed?.proVideos) ? parsed.proVideos : [];
  let changed = false;
  const migrated = [];
  for (const item of list) {
    const nextItem = { ...item };
    const legacyName = normalizePlayerName(nextItem.playerName);
    if (!nextItem.playerId && legacyName) {
      // eslint-disable-next-line no-await-in-loop
      const ref = await ensurePlayerReference(legacyName, nextItem.handedness);
      if (ref?.id) {
        nextItem.playerId = ref.id;
        if (ref.handedness) nextItem.handedness = ref.handedness;
        delete nextItem.playerName;
        changed = true;
      }
    }
    migrated.push(nextItem);
  }
  if (changed) {
    const next = { ...parsed, proVideos: migrated };
    await fs.writeFile(proVideosConfigPath, `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
  }
  reloadConfigFromDisk();
}

await migrateLegacyPlayersToReferences();

async function updateProVideoInConfig(proVideoId, updates) {
  const raw = await fs.readFile(proVideosConfigPath, 'utf-8');
  const parsed = JSON.parse(raw);
  const list = Array.isArray(parsed?.proVideos) ? parsed.proVideos : [];
  const idx = list.findIndex((x) => String(x?.id || '') === String(proVideoId || ''));
  if (idx < 0) {
    throw new Error('pro_video_not_found');
  }
  const current = list[idx] || {};
  const nextItem = {
    ...current,
    ...updates
  };
  if (Object.prototype.hasOwnProperty.call(updates, 'playerId') && !nextItem.playerId) {
    delete nextItem.playerId;
  }
  delete nextItem.playerName;
  const nextList = [...list];
  nextList[idx] = nextItem;
  const next = {
    ...parsed,
    proVideos: nextList
  };
  await fs.writeFile(proVideosConfigPath, `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
  reloadConfigFromDisk();
  return {
    item: withResolvedPlayer(nextItem),
    knownPlayerNames: collectKnownPlayerNames(),
    knownPlayers: collectKnownPlayers()
  };
}

async function buildRefreshStatus() {
  const items = [];
  for (const pro of config.proVideos || []) {
    const clip = await inspectProVideoRefreshNeeds(pro.id);
    let tracksNeedsRefresh = false;
    let tracksReason = null;
    let audioNeedsRefresh = false;
    let audioReason = null;
    if (!clip.clipNeedsRefresh) {
      const trackStatus = await inspectTrackCache(clip.localPath, { handedness: pro.handedness });
      tracksNeedsRefresh = !trackStatus.ok;
      tracksReason = trackStatus.reason;
      const audioStatus = await inspectAudioPeaksCache(clip.localPath);
      audioNeedsRefresh = !audioStatus.ok;
      audioReason = audioStatus.reason;
    } else {
      tracksNeedsRefresh = true;
      tracksReason = 'blocked_by_clip_refresh';
      audioNeedsRefresh = true;
      audioReason = 'blocked_by_clip_refresh';
    }
    items.push({
      id: pro.id,
      clipNeedsRefresh: clip.clipNeedsRefresh,
      clipReason: clip.clipReason,
      tracksNeedsRefresh,
      tracksReason,
      audioNeedsRefresh,
      audioReason,
      needsRefresh: clip.clipNeedsRefresh || tracksNeedsRefresh || audioNeedsRefresh
    });
  }

  const summary = {
    total: items.length,
    needsRefreshCount: items.filter((x) => x.needsRefresh).length,
    clipNeedsRefreshCount: items.filter((x) => x.clipNeedsRefresh).length,
    tracksNeedsRefreshCount: items.filter((x) => x.tracksNeedsRefresh).length,
    audioNeedsRefreshCount: items.filter((x) => x.audioNeedsRefresh).length
  };
  return { checkedAt: new Date().toISOString(), summary, items };
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, currentGenerationVersion: CURRENT_GENERATION_VERSION });
});

app.get('/api/pro-videos', async (req, res) => {
  const pros = await listProVideos();
  res.json({ items: pros.map(withResolvedPlayer) });
});

app.get('/api/sessions', async (req, res) => {
  const sessions = await listSessions();
  res.json({
    currentGenerationVersion: CURRENT_GENERATION_VERSION,
    items: sessions.map(withGenerationFlags)
  });
});

app.get('/api/uploads', async (req, res) => {
  const items = await listVideoFilesInDir(config.uploadsDir, '/files/uploads');
  res.json({ items });
});

app.get('/api/user-videos', async (req, res) => {
  const items = await listUserVideoManagementEntries();
  res.json({ items });
});

app.get('/api/debug/user-detection-clips', async (req, res) => {
  try {
    const entries = await listUserVideoManagementEntries();
    const labels = await getAllUserClipLabels();
    const items = [];
    for (const entry of entries) {
      const sourceFps = Number(entry?.sourceFps || 30);
      for (const clip of (entry?.extractedClips || [])) {
        const key = buildUserClipLabelKey(entry?.id, clip?.id);
        const label = (labels?.[key] && typeof labels[key] === 'object') ? labels[key] : {};
        const hasContact = normalizeHasContactFromLabel(label);
        const detectedContactSec = toClipRelativeDetectedSec(clip);
        const detectedFrame = toClipRelativeDetectedFrame(clip, sourceFps);
        const groundTruthFrame = Number(label?.groundTruthFrame);
        const hasGt = Number.isFinite(groundTruthFrame) && groundTruthFrame >= 0;
        const errorFrames = hasGt && Number.isFinite(detectedFrame)
          ? Math.round(detectedFrame) - Math.round(groundTruthFrame)
          : null;
        items.push({
          id: key,
          entryId: String(entry?.id || ''),
          clipId: String(clip?.id || ''),
          dateAdded: String(entry?.createdAt || ''),
          evaluationSet: 'core',
          sourceFileName: String(entry?.sourceFileName || ''),
          clipFileName: String(clip?.fileName || ''),
          videoPublicUrl: String(clip?.publicUrl || ''),
          clipStartSec: Number(clip?.clipStartSec || 0),
          clipEndSec: Number(clip?.clipEndSec || 0),
          clipDurationSec: Number(clip?.clipDurationSec || 0),
          fps: Number.isFinite(sourceFps) && sourceFps > 0 ? sourceFps : 30,
          detectedConfidence: Number(clip?.detectedConfidence || 0),
          detectedHandedness: String(clip?.detectedHandedness || '') || null,
          detectedContactSec,
          detectedFrame,
          groundTruthFrame: hasGt ? Math.round(groundTruthFrame) : null,
          hasContact,
          labelUpdatedAt: label?.updatedAt || null,
          errorFrames
        });
      }
    }
    res.json({ ok: true, items });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'user_detection_clips_failed', message: err.message });
  }
});

app.get('/api/debug/user-tracks/:entryId/:clipId', async (req, res) => {
  try {
    const entryId = String(req.params?.entryId || '').trim();
    const clipId = String(req.params?.clipId || '').trim();
    if (!entryId || !clipId) {
      res.status(400).json({ ok: false, error: 'missing_user_clip_id' });
      return;
    }
    const entries = await listUserVideoManagementEntries();
    const entry = entries.find((x) => String(x?.id || '') === entryId);
    if (!entry) {
      res.status(404).json({ ok: false, error: 'user_video_entry_not_found' });
      return;
    }
    const clip = (entry.extractedClips || []).find((x) => String(x?.id || '') === clipId);
    if (!clip) {
      res.status(404).json({ ok: false, error: 'user_video_clip_not_found' });
      return;
    }
    const localPath = localUserClipPathFromPublicUrl(clip.publicUrl);
    const tracksResult = await getOrCreateTracks(localPath, {
      handedness: clip.detectedHandedness || 'right'
    });
    const metadata = await getVideoMetadata(localPath).catch(() => null);
    res.json({
      ok: true,
      entryId,
      clipId,
      source: tracksResult.source,
      tracks: tracksResult.tracks,
      trackingError: tracksResult.error ?? null,
      metadata
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: 'user_tracks_failed', message: err.message });
  }
});

app.post('/api/debug/user-clip-labels/:entryId/:clipId', async (req, res) => {
  try {
    const entryId = String(req.params?.entryId || '').trim();
    const clipId = String(req.params?.clipId || '').trim();
    if (!entryId || !clipId) {
      res.status(400).json({ ok: false, error: 'missing_user_clip_id' });
      return;
    }
    const payload = {};
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'groundTruthFrame')) {
      const v = Number(req.body?.groundTruthFrame);
      if (!Number.isFinite(v) || v < 0) {
        res.status(400).json({ ok: false, error: 'invalid_ground_truth_frame' });
        return;
      }
      payload.groundTruthFrame = Math.round(v);
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'hasContact')) {
      const value = String(req.body?.hasContact || '').trim().toLowerCase();
      if (!['none', 'single', 'multiple'].includes(value)) {
        res.status(400).json({ ok: false, error: 'invalid_has_contact' });
        return;
      }
      payload.hasContact = value;
    }
    // Backward compatibility for older clients.
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'isServe')) {
      if (typeof req.body?.isServe !== 'boolean') {
        res.status(400).json({ ok: false, error: 'invalid_is_serve' });
        return;
      }
      payload.hasContact = req.body.isServe ? 'single' : 'none';
    }
    if (!Object.keys(payload).length) {
      res.status(400).json({ ok: false, error: 'empty_label_payload' });
      return;
    }
    const label = await upsertUserClipLabel(entryId, clipId, payload);
    res.json({ ok: true, entryId, clipId, label });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'save_user_clip_label_failed', message: err.message });
  }
});

app.get('/api/user-videos/jobs', async (req, res) => {
  res.json({ items: listUserVideoJobs() });
});

app.get('/api/user-videos/jobs/:jobId', async (req, res) => {
  const job = getUserVideoJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ ok: false, error: 'user_video_job_not_found' });
    return;
  }
  res.json({ ok: true, job });
});

app.post('/api/user-videos/:id/client-metrics', async (req, res) => {
  try {
    const entryId = String(req.params?.id || '').trim();
    if (!entryId) {
      res.status(400).json({ ok: false, error: 'missing_entry_id' });
      return;
    }
    const metrics = req.body && typeof req.body === 'object' ? req.body : {};
    const patch = {
      uploadMs: Number.isFinite(Number(metrics?.uploadMs)) ? Math.round(Number(metrics.uploadMs)) : null,
      requestRoundTripMs: Number.isFinite(Number(metrics?.requestRoundTripMs)) ? Math.round(Number(metrics.requestRoundTripMs)) : null
    };
    const updated = await updateUserVideoManagementClientMetrics(entryId, patch);
    res.json({ ok: true, item: updated });
  } catch (err) {
    if (String(err?.message || '') === 'user_video_entry_not_found') {
      res.status(404).json({ ok: false, error: 'user_video_entry_not_found' });
      return;
    }
    res.status(500).json({ ok: false, error: 'update_user_video_metrics_failed', message: err.message });
  }
});

app.get('/api/sessions/:id', async (req, res) => {
  const session = await getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  res.json(withGenerationFlags(session));
});

app.get('/api/debug/pro-detections', async (req, res) => {
  reloadConfigFromDisk();
  const refresh = String(req.query?.refresh || '') === '1';
  const diagnostics = await getProDetectionsDiagnostics({ refresh });
  const compareToRunId = String(req.query?.compareToRunId || '').trim() || null;
  const compareTo = String(req.query?.compareTo || 'stable').trim().toLowerCase();
  const baselineRun = compareToRunId
    ? await getDetectionRun(compareToRunId)
    : (compareTo === 'latest' ? await getLatestDetectionRun() : await getStableDetectionRun());
  let autoRun = null;
  if (diagnostics.source === 'generated') {
    autoRun = await maybeCreateAutoDetectionRun({
      diagnostics,
      reason: refresh ? 'manual_refresh' : 'cache_miss_regen'
    });
  }
  const baselineSummary = baselineRun
    ? {
        runId: baselineRun.runId,
        logicVersion: baselineRun.logicVersion || null,
        createdAt: baselineRun.createdAt
      }
    : null;
  const delta = baselineRun ? computeDiagnosticsDelta(diagnostics, baselineRun) : null;
  res.json({
    currentGenerationVersion: CURRENT_GENERATION_VERSION,
    ...diagnostics,
    autoRun,
    baseline: baselineSummary,
    delta
  });
});

app.post('/api/debug/pro-detections/runs', async (req, res) => {
  try {
    const refresh = req.body?.refresh !== false;
    const logicVersion = String(req.body?.logicVersion || '').trim() || null;
    const notes = String(req.body?.notes || '').trim() || null;
    const requestedMarkStable = Boolean(req.body?.markStable);
    const tagType = String(req.body?.tagType || 'iteration').trim().toLowerCase() || 'iteration';
    const branchName = String(req.body?.branchName || '').trim() || null;
    const parentRunId = String(req.body?.parentRunId || '').trim() || null;
    const markStable = (tagType === 'feature-branch') ? false : requestedMarkStable;
    const compareToRunId = String(req.body?.compareToRunId || '').trim() || null;
    const compareTo = String(req.body?.compareTo || 'stable').trim().toLowerCase();

    const diagnostics = await getProDetectionsDiagnostics({ refresh });
    const baselineRun = compareToRunId
      ? await getDetectionRun(compareToRunId)
      : (compareTo === 'latest' ? await getLatestDetectionRun() : await getStableDetectionRun());
    const run = await createDetectionRun({
      diagnostics,
      tagType,
      branchName,
      parentRunId,
      logicVersion,
      notes,
      markStable,
      baselineRunId: baselineRun?.runId || null
    });
    const delta = baselineRun ? computeDiagnosticsDelta(run, baselineRun) : null;
    res.json({
      ok: true,
      run: {
        runId: run.runId,
        createdAt: run.createdAt,
        runType: run.runType,
        autoReason: run.autoReason,
        tagType: run.tagType,
        branchName: run.branchName,
        parentRunId: run.parentRunId,
        logicVersion: run.logicVersion,
        notes: run.notes,
        logicFingerprint: run.logicFingerprint,
        baselineRunId: run.baselineRunId,
        markStableApplied: markStable,
        markStableRequested: requestedMarkStable
      },
      summary: run.summary,
      summaryBySet: run.summaryBySet,
      items: run.items,
      baseline: baselineRun
        ? {
            runId: baselineRun.runId,
            logicVersion: baselineRun.logicVersion || null,
            createdAt: baselineRun.createdAt
          }
        : null,
      delta
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: 'create_detection_run_failed', message: err.message });
  }
});

app.get('/api/debug/pro-detection-runs', async (req, res) => {
  const list = await listDetectionRuns();
  res.json({ ok: true, ...list });
});

app.get('/api/debug/pro-detection-runs/:runId', async (req, res) => {
  const run = await getDetectionRun(req.params.runId);
  if (!run) {
    res.status(404).json({ ok: false, error: 'run_not_found' });
    return;
  }
  res.json({ ok: true, run });
});

app.post('/api/debug/pro-detection-runs/:runId/stable', async (req, res) => {
  try {
    const result = await setStableDetectionRun(req.params.runId);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ ok: false, error: 'set_stable_run_failed', message: err.message });
  }
});

app.get('/api/debug/pro-tracks/:id', async (req, res) => {
  try {
    const pro = await ensureProVideoAvailable(req.params.id);
    const tracksResult = await getOrCreateTracks(pro.localPath, {
      handedness: pro.handedness
    });
    const metadata = await getVideoMetadata(pro.localPath).catch(() => null);
    res.json({
      ok: true,
      id: pro.id,
      source: tracksResult.source,
      tracks: tracksResult.tracks,
      trackingError: tracksResult.error ?? null,
      metadata
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: 'pro_tracks_failed', message: err.message });
  }
});

app.get('/api/debug/pro-labels', async (req, res) => {
  const labels = await getAllProLabels();
  res.json({ labels });
});

app.post('/api/debug/pro-labels/:id', async (req, res) => {
  try {
    const proId = req.params.id;
    const frameValue = Number(req.body?.contactFrame);
    const msValue = Number(req.body?.contactTimeMs);
    const hasLowFpsAmbiguous = Object.prototype.hasOwnProperty.call(req.body || {}, 'lowFpsAmbiguous');
    const lowFpsAmbiguousRaw = req.body?.lowFpsAmbiguous;
    if (!Number.isFinite(frameValue) && !Number.isFinite(msValue) && !hasLowFpsAmbiguous) {
      res.status(400).json({ error: 'invalid_contact_label', message: 'contactFrame/contactTimeMs/lowFpsAmbiguous required' });
      return;
    }
    const payload = {};
    if (Number.isFinite(frameValue) && frameValue >= 0) payload.contactFrame = Math.round(frameValue);
    if (Number.isFinite(msValue) && msValue >= 0) payload.contactTimeMs = Math.round(msValue);
    if (hasLowFpsAmbiguous) {
      if (typeof lowFpsAmbiguousRaw !== 'boolean') {
        res.status(400).json({ error: 'invalid_low_fps_ambiguous' });
        return;
      }
      payload.lowFpsAmbiguous = lowFpsAmbiguousRaw;
    }
    if (!Object.keys(payload).length) {
      res.status(400).json({ error: 'invalid_contact_label_range' });
      return;
    }
    const label = await upsertProLabel(proId, payload);
    await fs.unlink(config.proDiagnosticsPath).catch(() => {});
    res.json({ ok: true, proId, label });
  } catch (err) {
    res.status(500).json({ error: 'save_label_failed', message: err.message });
  }
});

app.get('/api/debug/pro-comments/:id', async (req, res) => {
  try {
    const proId = String(req.params.id || '').trim();
    if (!proId) {
      res.status(400).json({ ok: false, error: 'missing_pro_video_id' });
      return;
    }
    const labels = await getAllProLabels();
    const label = (labels?.[proId] && typeof labels[proId] === 'object') ? labels[proId] : {};
    const comments = Array.isArray(label.comments) ? label.comments : [];
    res.json({ ok: true, proId, comments });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'list_comments_failed', message: err.message });
  }
});

app.post('/api/debug/pro-comments/:id', async (req, res) => {
  try {
    const proId = String(req.params.id || '').trim();
    const text = String(req.body?.text || '').trim();
    if (!proId) {
      res.status(400).json({ ok: false, error: 'missing_pro_video_id' });
      return;
    }
    if (!text) {
      res.status(400).json({ ok: false, error: 'invalid_comment' });
      return;
    }
    const label = await addProLabelComment(proId, text);
    await fs.unlink(config.proDiagnosticsPath).catch(() => {});
    res.json({
      ok: true,
      proId,
      comments: Array.isArray(label.comments) ? label.comments : []
    });
  } catch (err) {
    const code = String(err?.message || '');
    if (code === 'invalid_comment') {
      res.status(400).json({ ok: false, error: code });
      return;
    }
    res.status(500).json({ ok: false, error: 'add_comment_failed', message: err.message });
  }
});

app.delete('/api/debug/pro-comments/:id/:commentIndex', async (req, res) => {
  try {
    const proId = String(req.params.id || '').trim();
    const commentIndex = Number(req.params.commentIndex);
    if (!proId) {
      res.status(400).json({ ok: false, error: 'missing_pro_video_id' });
      return;
    }
    const label = await removeProLabelComment(proId, commentIndex);
    await fs.unlink(config.proDiagnosticsPath).catch(() => {});
    res.json({
      ok: true,
      proId,
      comments: Array.isArray(label.comments) ? label.comments : []
    });
  } catch (err) {
    const code = String(err?.message || '');
    if (code === 'invalid_comment_index') {
      res.status(400).json({ ok: false, error: code });
      return;
    }
    if (code === 'comment_not_found') {
      res.status(404).json({ ok: false, error: code });
      return;
    }
    res.status(500).json({ ok: false, error: 'delete_comment_failed', message: err.message });
  }
});

app.post('/api/debug/pro-videos', async (req, res) => {
  try {
    const youtubeUrl = String(req.body?.youtubeUrl || '').trim();
    const title = String(req.body?.title || '').trim();
    const strokeType = String(req.body?.strokeType || 'serve').trim().toLowerCase();
    const handedness = String(req.body?.handedness || 'right').trim().toLowerCase();
    const evaluationSet = String(req.body?.evaluationSet || 'core').trim().toLowerCase();
    const playerName = normalizePlayerName(req.body?.playerName);
    const cameraAngleRaw = String(req.body?.cameraAngle || 'behind_server').trim().toLowerCase();
    const courtSide = String(req.body?.courtSide || 'deuce').trim().toLowerCase();
    const startTime = Number(req.body?.startTime);
    const endTime = Number(req.body?.endTime);

    if (!youtubeUrl || !youtubeUrl.includes('youtube.com')) {
      res.status(400).json({ ok: false, error: 'invalid_youtube_url' });
      return;
    }
    if (!title) {
      res.status(400).json({ ok: false, error: 'missing_title' });
      return;
    }
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) {
      res.status(400).json({ ok: false, error: 'invalid_time_range' });
      return;
    }

    const cameraAngle = normalizeCameraAngle(cameraAngleRaw);

    if (!ALLOWED_STROKE_TYPES.has(strokeType)) {
      res.status(400).json({ ok: false, error: 'invalid_stroke_type' });
      return;
    }
    if (!ALLOWED_HANDEDNESS.has(handedness)) {
      res.status(400).json({ ok: false, error: 'invalid_handedness' });
      return;
    }
    if (!ALLOWED_EVALUATION_SETS.has(evaluationSet)) {
      res.status(400).json({ ok: false, error: 'invalid_evaluation_set' });
      return;
    }
    if (!ALLOWED_CAMERA_ANGLES.has(cameraAngle)) {
      res.status(400).json({ ok: false, error: 'invalid_camera_angle' });
      return;
    }
    if (!ALLOWED_COURT_SIDES.has(courtSide)) {
      res.status(400).json({ ok: false, error: 'invalid_court_side' });
      return;
    }

    const playerRef = playerName ? await ensurePlayerReference(playerName, handedness) : null;
    const effectiveHandedness = normalizeHandedness(playerRef?.handedness) || handedness;
    const created = await appendProVideoToConfig({
      title,
      youtubeUrl,
      startTime: Number(startTime.toFixed(3)),
      endTime: Number(endTime.toFixed(3)),
      dateAdded: new Date().toISOString(),
      strokeType,
      handedness: effectiveHandedness,
      playerId: playerRef?.id || null,
      evaluationSet,
      cameraAngle,
      courtSide
    });
    const processingJob = enqueueProVideoProcessing(created.id);
    const knownPlayers = collectKnownPlayers();
    res.json({
      ok: true,
      item: created,
      processingJob,
      knownPlayers,
      knownPlayerNames: knownPlayers.map((p) => p.name)
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'save_pro_video_failed', message: err.message });
  }
});

app.get('/api/debug/pro-videos/jobs', async (req, res) => {
  res.json({ ok: true, items: listProVideoJobs() });
});

app.get('/api/debug/pro-videos/jobs/:jobId', async (req, res) => {
  const job = getProVideoJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ ok: false, error: 'job_not_found' });
    return;
  }
  res.json({ ok: true, item: job });
});

app.get('/api/debug/refresh-status', async (req, res) => {
  try {
    reloadConfigFromDisk();
    const status = await buildRefreshStatus();
    res.json({ ok: true, ...status });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'refresh_status_failed', message: err.message });
  }
});

app.post('/api/debug/refresh-all', async (req, res) => {
  try {
    reloadConfigFromDisk();
    const before = await buildRefreshStatus();
    const diagnostics = await getProDetectionsDiagnostics({ refresh: true });
    const after = await buildRefreshStatus();
    res.json({
      ok: true,
      before,
      after,
      diagnosticsSummary: diagnostics.summary || null
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'refresh_all_failed', message: err.message });
  }
});

app.post('/api/debug/pro-videos/:id/player', async (req, res) => {
  try {
    const proVideoId = String(req.params.id || '').trim();
    const playerName = normalizePlayerName(req.body?.playerName);
    const handedness = normalizeHandedness(req.body?.handedness);
    if (!proVideoId) {
      res.status(400).json({ ok: false, error: 'missing_pro_video_id' });
      return;
    }
    if (req.body?.handedness != null && !handedness) {
      res.status(400).json({ ok: false, error: 'invalid_handedness' });
      return;
    }
    const playerRef = playerName ? await ensurePlayerReference(playerName, handedness) : null;
    const result = await updateProVideoInConfig(proVideoId, {
      playerId: playerRef?.id || null,
      ...(normalizeHandedness(playerRef?.handedness) ? { handedness: normalizeHandedness(playerRef?.handedness) } : {})
    });
    res.json({
      ok: true,
      item: result.item,
      knownPlayerNames: result.knownPlayerNames,
      knownPlayers: result.knownPlayers
    });
  } catch (err) {
    const code = String(err?.message || '');
    if (code === 'pro_video_not_found') {
      res.status(404).json({ ok: false, error: code });
      return;
    }
    res.status(500).json({ ok: false, error: 'update_pro_video_player_failed', message: err.message });
  }
});

app.post('/api/debug/pro-videos/:id', async (req, res) => {
  try {
    const proVideoId = String(req.params.id || '').trim();
    if (!proVideoId) {
      res.status(400).json({ ok: false, error: 'missing_pro_video_id' });
      return;
    }

    const body = req.body || {};
    const forbidden = ['youtubeUrl', 'startTime', 'endTime', 'dateAdded'];
    const forbiddenHit = forbidden.find((k) => Object.prototype.hasOwnProperty.call(body, k));
    if (forbiddenHit) {
      res.status(400).json({ ok: false, error: 'non_editable_field', field: forbiddenHit });
      return;
    }

    const updates = {};

    if (Object.prototype.hasOwnProperty.call(body, 'title')) {
      const title = String(body.title || '').trim();
      if (!title) {
        res.status(400).json({ ok: false, error: 'invalid_title' });
        return;
      }
      updates.title = title;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'strokeType')) {
      const strokeType = String(body.strokeType || '').trim().toLowerCase();
      if (!ALLOWED_STROKE_TYPES.has(strokeType)) {
        res.status(400).json({ ok: false, error: 'invalid_stroke_type' });
        return;
      }
      updates.strokeType = strokeType;
    }
    let requestedHandedness = null;
    if (Object.prototype.hasOwnProperty.call(body, 'handedness')) {
      requestedHandedness = normalizeHandedness(body.handedness);
      if (!requestedHandedness) {
        res.status(400).json({ ok: false, error: 'invalid_handedness' });
        return;
      }
    }
    if (Object.prototype.hasOwnProperty.call(body, 'evaluationSet')) {
      const evaluationSet = String(body.evaluationSet || '').trim().toLowerCase();
      if (!ALLOWED_EVALUATION_SETS.has(evaluationSet)) {
        res.status(400).json({ ok: false, error: 'invalid_evaluation_set' });
        return;
      }
      updates.evaluationSet = evaluationSet;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'cameraAngle')) {
      const cameraAngle = normalizeCameraAngle(body.cameraAngle);
      if (!ALLOWED_CAMERA_ANGLES.has(cameraAngle)) {
        res.status(400).json({ ok: false, error: 'invalid_camera_angle' });
        return;
      }
      updates.cameraAngle = cameraAngle;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'courtSide')) {
      const courtSide = String(body.courtSide || '').trim().toLowerCase();
      if (!ALLOWED_COURT_SIDES.has(courtSide)) {
        res.status(400).json({ ok: false, error: 'invalid_court_side' });
        return;
      }
      updates.courtSide = courtSide;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'playerName')) {
      const playerName = normalizePlayerName(body.playerName);
      if (playerName) {
        const playerRef = await ensurePlayerReference(playerName, requestedHandedness);
        updates.playerId = playerRef?.id || null;
        const refHand = normalizeHandedness(playerRef?.handedness);
        if (refHand) updates.handedness = refHand;
      } else {
        updates.playerId = null;
        if (requestedHandedness) updates.handedness = requestedHandedness;
      }
    } else if (requestedHandedness) {
      updates.handedness = requestedHandedness;
    }

    if (!Object.keys(updates).length) {
      res.status(400).json({ ok: false, error: 'no_editable_updates' });
      return;
    }

    const result = await updateProVideoInConfig(proVideoId, updates);
    await fs.unlink(config.proDiagnosticsPath).catch(() => {});
    res.json({
      ok: true,
      item: result.item,
      knownPlayerNames: result.knownPlayerNames,
      knownPlayers: result.knownPlayers
    });
  } catch (err) {
    const code = String(err?.message || '');
    if (code === 'pro_video_not_found') {
      res.status(404).json({ ok: false, error: code });
      return;
    }
    res.status(500).json({ ok: false, error: 'update_pro_video_failed', message: err.message });
  }
});

app.post('/api/upload', upload.single('video'), async (req, res) => {
  try {
    const proVideoId = req.body.proVideoId;
    const file = req.file;

    if (!file) {
      res.status(400).json({ error: 'missing_file' });
      return;
    }

    if (!proVideoId) {
      await fs.unlink(file.path).catch(() => {});
      res.status(400).json({ error: 'missing_pro_video_id' });
      return;
    }

    await validateUploadDuration(file.path);
    const proVideo = await ensureProVideoAvailable(proVideoId);
    const comparison = await buildComparisonPayload({
      amateurVideoPath: file.path,
      proVideoPath: proVideo.localPath,
      proDetectionContext: {
        strokeType: proVideo.strokeType,
        handedness: proVideo.handedness,
        courtSide: proVideo.courtSide
      }
    });

    const sessionId = uuidv4();
    const analysisPath = await persistAnalysis(sessionId, comparison);

    const session = buildSessionPayload({
      id: sessionId,
      proVideo: {
        id: proVideo.id,
        title: proVideo.title,
        publicUrl: `/files/pros/${path.basename(proVideo.localPath)}`
      },
      amateurVideo: {
        source: 'upload',
        fileName: file.originalname,
        publicUrl: `/files/uploads/${path.basename(file.path)}`
      },
      analysisPath,
      comparison
    });

    await saveSession(session);
    res.json(withGenerationFlags(session));
  } catch (err) {
    if (req.file?.path) {
      await fs.unlink(req.file.path).catch(() => {});
    }
    res.status(400).json({ error: 'processing_failed', message: err.message });
  }
});

app.post('/api/user-videos/scan-upload', upload.single('video'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'missing_file' });
      return;
    }

    let clientMetrics = null;
    try {
      const rawMetrics = String(req.body?.clientMetrics || '').trim();
      if (rawMetrics) {
        const parsed = JSON.parse(rawMetrics);
        if (parsed && typeof parsed === 'object') clientMetrics = parsed;
      }
    } catch {
      clientMetrics = null;
    }

    const sourcePublicUrl = `/files/uploads/${path.basename(file.path)}`;
    const job = enqueueUserVideoJob({
      inputVideoPath: file.path,
      sourceFileName: file.originalname,
      sourcePublicUrl,
      sourceSizeBytes: file.size,
      clientMetrics
    });
    res.json({
      ok: true,
      upload: {
        fileName: file.originalname,
        publicUrl: sourcePublicUrl,
        sizeBytes: Number(file.size || 0)
      },
      job
    });
  } catch (err) {
    if (req.file?.path) {
      await fs.unlink(req.file.path).catch(() => {});
    }
    res.status(400).json({ error: 'user_video_scan_failed', message: err.message });
  }
});

app.post('/api/compare-pros', async (req, res) => {
  try {
    const amateurProVideoId = req.body.amateurProVideoId;
    const proVideoId = req.body.proVideoId;

    if (!amateurProVideoId) {
      res.status(400).json({ error: 'missing_amateur_pro_video_id' });
      return;
    }
    if (!proVideoId) {
      res.status(400).json({ error: 'missing_pro_video_id' });
      return;
    }

    const amateurProVideo = await ensureProVideoAvailable(amateurProVideoId);
    const proVideo = await ensureProVideoAvailable(proVideoId);

    const comparison = await buildComparisonPayload({
      amateurVideoPath: amateurProVideo.localPath,
      proVideoPath: proVideo.localPath,
      amateurDetectionContext: {
        strokeType: amateurProVideo.strokeType,
        handedness: amateurProVideo.handedness,
        courtSide: amateurProVideo.courtSide
      },
      proDetectionContext: {
        strokeType: proVideo.strokeType,
        handedness: proVideo.handedness,
        courtSide: proVideo.courtSide
      }
    });

    const sessionId = uuidv4();
    const analysisPath = await persistAnalysis(sessionId, comparison);

    const session = buildSessionPayload({
      id: sessionId,
      proVideo: {
        id: proVideo.id,
        title: proVideo.title,
        publicUrl: `/files/pros/${path.basename(proVideo.localPath)}`
      },
      amateurVideo: {
        source: 'pro_library',
        id: amateurProVideo.id,
        title: amateurProVideo.title,
        publicUrl: `/files/pros/${path.basename(amateurProVideo.localPath)}`
      },
      analysisPath,
      comparison
    });

    await saveSession(session);
    res.json(withGenerationFlags(session));
  } catch (err) {
    res.status(400).json({ error: 'processing_failed', message: err.message });
  }
});

app.post('/api/compare-upload', async (req, res) => {
  try {
    const uploadFileName = req.body.uploadFileName;
    const proVideoId = req.body.proVideoId;

    if (!uploadFileName) {
      res.status(400).json({ error: 'missing_upload_file_name' });
      return;
    }
    if (!proVideoId) {
      res.status(400).json({ error: 'missing_pro_video_id' });
      return;
    }

    const uploadPath = path.join(config.uploadsDir, path.basename(uploadFileName));
    await fs.access(uploadPath).catch(() => {
      throw new Error(`upload_not_found: ${uploadFileName}`);
    });

    await validateUploadDuration(uploadPath);
    const proVideo = await ensureProVideoAvailable(proVideoId);
    const comparison = await buildComparisonPayload({
      amateurVideoPath: uploadPath,
      proVideoPath: proVideo.localPath,
      proDetectionContext: {
        strokeType: proVideo.strokeType,
        handedness: proVideo.handedness,
        courtSide: proVideo.courtSide
      }
    });

    const sessionId = uuidv4();
    const analysisPath = await persistAnalysis(sessionId, comparison);

    const session = buildSessionPayload({
      id: sessionId,
      proVideo: {
        id: proVideo.id,
        title: proVideo.title,
        publicUrl: `/files/pros/${path.basename(proVideo.localPath)}`
      },
      amateurVideo: {
        source: 'upload_library',
        fileName: uploadFileName,
        publicUrl: `/files/uploads/${path.basename(uploadFileName)}`
      },
      analysisPath,
      comparison
    });

    await saveSession(session);
    res.json(withGenerationFlags(session));
  } catch (err) {
    res.status(400).json({ error: 'processing_failed', message: err.message });
  }
});

app.post('/api/sessions/:id/recalculate', async (req, res) => {
  try {
    const existing = await getSession(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'not_found' });
      return;
    }

    const proVideo = await ensureProVideoAvailable(existing.proVideo.id);
    let amateurVideoPath = null;
    let amateurDetectionContext = {};

    if (existing.amateurVideo?.source === 'pro_library') {
      const amateurPro = await ensureProVideoAvailable(existing.amateurVideo.id);
      amateurVideoPath = amateurPro.localPath;
      amateurDetectionContext = {
        strokeType: amateurPro.strokeType,
        handedness: amateurPro.handedness,
        courtSide: amateurPro.courtSide
      };
    } else {
      amateurVideoPath = localUploadPathFromPublicUrl(existing.amateurVideo.publicUrl);
      await fs.access(amateurVideoPath);
    }

    const comparison = await buildComparisonPayload({
      amateurVideoPath,
      proVideoPath: proVideo.localPath,
      amateurDetectionContext,
      proDetectionContext: {
        strokeType: proVideo.strokeType,
        handedness: proVideo.handedness,
        courtSide: proVideo.courtSide
      }
    });
    const analysisPath = await persistAnalysis(existing.id, comparison);

    const updated = {
      ...existing,
      analysisPath,
      comparison,
      generation: buildGenerationInfo()
    };
    await saveSession(updated);
    res.json(withGenerationFlags(updated));
  } catch (err) {
    res.status(400).json({ error: 'recalculate_failed', message: err.message });
  }
});

app.post('/api/debug/clear-caches', async (req, res) => {
  try {
    const deleted = {
      uploadDerived: await clearFilesInDir(
        config.uploadsDir,
        (name) => name.endsWith('.tracks.json') || name.endsWith('.audio_peaks.json')
      ),
      proCache: await clearFilesInDir(config.prosDir, () => true),
      proSources: await clearFilesInDir(config.prosSourcesDir, () => true),
      processed: await clearFilesInDir(
        config.processedDir,
        (name) => name.endsWith('.analysis.json') || name === 'pro_diagnostics.latest.json'
      ),
      sessions: await clearFilesInDir(config.sessionsDir, (name) => name.endsWith('.json')),
      debugFrames: await clearFilesInDir(config.debugFramesDir, () => true)
    };
    res.json({ ok: true, deleted });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'clear_cache_failed', message: err.message });
  }
});

app.post('/api/debug/clear-derived', async (req, res) => {
  try {
    const deleted = {
      uploadDerived: await clearFilesInDir(
        config.uploadsDir,
        (name) => name.endsWith('.tracks.json') || name.endsWith('.audio_peaks.json')
      ),
      proDerived: await clearFilesInDir(
        config.prosDir,
        (name) => name.endsWith('.tracks.json') || name.endsWith('.audio_peaks.json') || name.includes('.normalized.v')
      ),
      processed: await clearFilesInDir(
        config.processedDir,
        (name) => name.endsWith('.analysis.json') || name === 'pro_diagnostics.latest.json'
      ),
      sessions: await clearFilesInDir(config.sessionsDir, (name) => name.endsWith('.json')),
      debugFrames: await clearFilesInDir(config.debugFramesDir, () => true)
    };
    res.json({ ok: true, deleted });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'clear_derived_failed', message: err.message });
  }
});

app.use((err, req, res, next) => {
  if (!err) {
    next();
    return;
  }
  if (String(err?.message || '') === 'unsupported_file_type') {
    res.status(400).json({
      ok: false,
      error: 'unsupported_file_type',
      message: 'Unsupported video format. Supported: mp4, mov, webm, m4v, mkv, avi, mpg/mpeg, 3gp, mts/m2ts, ts, wmv, flv.'
    });
    return;
  }
  res.status(500).json({
    ok: false,
    error: 'internal_server_error',
    message: String(err?.message || 'Unknown server error')
  });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`backend listening on http://localhost:${port}`);
});
