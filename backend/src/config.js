import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const proVideosConfigPath = path.join(rootDir, 'config', 'pro_videos.json');
const proPlayersConfigPath = path.join(rootDir, 'config', 'pro_players.json');

function loadProPlayersFromDisk() {
  if (!fs.existsSync(proPlayersConfigPath)) {
    return { proPlayers: [] };
  }
  const raw = fs.readFileSync(proPlayersConfigPath, 'utf-8');
  const parsed = JSON.parse(raw);
  return {
    proPlayers: Array.isArray(parsed?.proPlayers) ? parsed.proPlayers : []
  };
}

function hydrateProVideosWithPlayers(proVideos, proPlayers) {
  const byId = new Map((proPlayers || []).map((p) => [String(p?.id || ''), p]));
  return (proVideos || []).map((video) => {
    const out = { ...video };
    const playerId = String(out?.playerId || '');
    const player = playerId ? byId.get(playerId) : null;
    if (player) {
      out.playerName = String(player.name || '');
      const handedness = String(player.handedness || '').toLowerCase();
      if (handedness === 'left' || handedness === 'right') {
        out.handedness = handedness;
      }
    }
    return out;
  });
}

function loadConfigFromDisk() {
  const raw = fs.readFileSync(proVideosConfigPath, 'utf-8');
  const parsed = JSON.parse(raw);
  const players = loadProPlayersFromDisk();
  return {
    ...parsed,
    proPlayers: players.proPlayers,
    proVideos: hydrateProVideosWithPlayers(parsed?.proVideos || [], players.proPlayers || [])
  };
}

const parsed = loadConfigFromDisk();

export const config = {
  rootDir,
  dataDir: path.join(rootDir, 'data'),
  sessionsDir: path.join(rootDir, 'data', 'sessions'),
  uploadsDir: path.join(rootDir, 'data', 'uploads'),
  userClipsDir: path.join(rootDir, 'data', 'user_clips'),
  prosDir: path.join(rootDir, 'data', 'pros'),
  prosSourcesDir: path.join(rootDir, 'data', 'pros_sources'),
  proLabelsPath: path.join(rootDir, 'data', 'pro_labels.json'),
  userClipLabelsPath: path.join(rootDir, 'data', 'user_clip_labels.json'),
  proDiagnosticsPath: path.join(rootDir, 'data', 'processed', 'pro_diagnostics.latest.json'),
  userVideoManagementPath: path.join(rootDir, 'data', 'processed', 'user_video_management.json'),
  detectionRunsDir: path.join(rootDir, 'data', 'processed', 'detection_runs'),
  detectionRunsIndexPath: path.join(rootDir, 'data', 'processed', 'detection_runs', 'index.json'),
  processedDir: path.join(rootDir, 'data', 'processed'),
  debugFramesDir: path.join(rootDir, 'data', 'debug_frames'),
  proPlayersConfigPath,
  proVideosConfigPath,
  maxUploadSeconds: parsed.maxUploadSeconds ?? 10,
  detection: {
    useBallForContact: parsed?.detection?.useBallForContact ?? false,
    audioAssistEnabled: parsed?.detection?.audioAssistEnabled ?? true,
    audioAssistWeight: parsed?.detection?.audioAssistWeight ?? 0.05,
    audioAssistWindowMs: parsed?.detection?.audioAssistWindowMs ?? 45,
    audioSampleRate: parsed?.detection?.audioSampleRate ?? 16000
  },
  tracking: {
    objectDetectorEnabled: parsed?.tracking?.objectDetectorEnabled ?? true,
    objectDetectorModel: parsed?.tracking?.objectDetectorModel ?? 'Davidsv/CourtSide-Computer-Vision-v1',
    objectDetectorConfidence: parsed?.tracking?.objectDetectorConfidence ?? 0.15,
    objectDetectorImageSize: parsed?.tracking?.objectDetectorImageSize ?? 960,
    objectDetectorRetryUnavailable: parsed?.tracking?.objectDetectorRetryUnavailable ?? true
  },
  output: parsed.defaultOutput ?? { aspectRatio: '16:9', resolution: '1280x720', fps: 60 },
  proPlayers: parsed.proPlayers ?? [],
  proVideos: parsed.proVideos ?? []
};

export function reloadConfigFromDisk() {
  const next = loadConfigFromDisk();
  config.maxUploadSeconds = next.maxUploadSeconds ?? config.maxUploadSeconds ?? 10;
  config.detection = {
    useBallForContact: next?.detection?.useBallForContact ?? config.detection?.useBallForContact ?? false,
    audioAssistEnabled: next?.detection?.audioAssistEnabled ?? config.detection?.audioAssistEnabled ?? true,
    audioAssistWeight: next?.detection?.audioAssistWeight ?? config.detection?.audioAssistWeight ?? 0.05,
    audioAssistWindowMs: next?.detection?.audioAssistWindowMs ?? config.detection?.audioAssistWindowMs ?? 45,
    audioSampleRate: next?.detection?.audioSampleRate ?? config.detection?.audioSampleRate ?? 16000
  };
  config.tracking = {
    objectDetectorEnabled: next?.tracking?.objectDetectorEnabled ?? config.tracking?.objectDetectorEnabled ?? true,
    objectDetectorModel: next?.tracking?.objectDetectorModel ?? config.tracking?.objectDetectorModel ?? 'Davidsv/CourtSide-Computer-Vision-v1',
    objectDetectorConfidence: next?.tracking?.objectDetectorConfidence ?? config.tracking?.objectDetectorConfidence ?? 0.15,
    objectDetectorImageSize: next?.tracking?.objectDetectorImageSize ?? config.tracking?.objectDetectorImageSize ?? 960,
    objectDetectorRetryUnavailable: next?.tracking?.objectDetectorRetryUnavailable ?? config.tracking?.objectDetectorRetryUnavailable ?? true
  };
  config.output = next.defaultOutput ?? config.output ?? { aspectRatio: '16:9', resolution: '1280x720', fps: 60 };
  config.proPlayers = next.proPlayers ?? [];
  config.proVideos = next.proVideos ?? [];
}
