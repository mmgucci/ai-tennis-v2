import { config } from '../config.js';
import { readJson, writeJson } from '../utils/fs.js';

function emptyStore() {
  return {
    schemaVersion: 'user-clip-labels-v1',
    labels: {}
  };
}

function normalizeHasContact(value, fallback = null) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'none' || v === 'single' || v === 'multiple') return v;
  if (typeof value === 'boolean') return value ? 'single' : 'none';
  return fallback;
}

function normalizeGroundTruthFrame(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

function normalizeLabel(raw) {
  const input = (raw && typeof raw === 'object') ? raw : {};
  const hasContact = normalizeHasContact(input.hasContact, normalizeHasContact(input.isServe, null));
  const groundTruthFrame = normalizeGroundTruthFrame(input.groundTruthFrame);
  const out = {
    ...input
  };
  delete out.isServe;

  if (hasContact) {
    out.hasContact = hasContact;
  } else {
    delete out.hasContact;
  }

  if ((hasContact === 'single' || hasContact === 'multiple') && Number.isFinite(groundTruthFrame)) {
    out.groundTruthFrame = groundTruthFrame;
  } else {
    delete out.groundTruthFrame;
  }

  return out;
}

export function buildUserClipLabelKey(entryId, clipId) {
  return `${String(entryId || '').trim()}:${String(clipId || '').trim()}`;
}

export async function getUserClipLabelsStore() {
  const store = await readJson(config.userClipLabelsPath, null);
  if (!store || typeof store !== 'object') return emptyStore();
  if (!store.labels || typeof store.labels !== 'object') {
    return { ...store, labels: {} };
  }
  let changed = false;
  const nextLabels = {};
  for (const [key, value] of Object.entries(store.labels || {})) {
    const normalized = normalizeLabel(value);
    nextLabels[key] = normalized;
    if (JSON.stringify(normalized) !== JSON.stringify(value || {})) {
      changed = true;
    }
  }
  const nextStore = {
    ...store,
    labels: nextLabels
  };
  if (changed) {
    await writeJson(config.userClipLabelsPath, nextStore);
  }
  return nextStore;
}

export async function getAllUserClipLabels() {
  const store = await getUserClipLabelsStore();
  return store.labels;
}

export async function upsertUserClipLabel(entryId, clipId, payload) {
  const key = buildUserClipLabelKey(entryId, clipId);
  if (!key || key === ':') {
    throw new Error('invalid_user_clip_key');
  }
  const store = await getUserClipLabelsStore();
  const prev = (store.labels[key] && typeof store.labels[key] === 'object') ? store.labels[key] : {};
  const merged = normalizeLabel({
    ...prev,
    ...payload,
    updatedAt: new Date().toISOString()
  });
  const next = {
    ...store,
    labels: {
      ...store.labels,
      [key]: merged
    }
  };
  await writeJson(config.userClipLabelsPath, next);
  return merged;
}
