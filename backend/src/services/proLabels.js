import { config } from '../config.js';
import { readJson, writeJson } from '../utils/fs.js';

function emptyStore() {
  return {
    schemaVersion: 'pro-labels-v1',
    labels: {}
  };
}

function normalizeComments(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const text = String(entry.text || '').trim();
      if (!text) return null;
      const createdAt = String(entry.createdAt || '').trim();
      return {
        text: text.slice(0, 5000),
        createdAt: createdAt || new Date().toISOString()
      };
    })
    .filter(Boolean);
}

export async function getProLabelsStore() {
  const store = await readJson(config.proLabelsPath, null);
  if (!store || typeof store !== 'object') return emptyStore();
  if (!store.labels || typeof store.labels !== 'object') {
    return { ...store, labels: {} };
  }
  let changed = false;
  const nextLabels = {};
  for (const [proId, label] of Object.entries(store.labels || {})) {
    const current = (label && typeof label === 'object') ? label : {};
    const normalized = { ...current };
    if (typeof normalized.lowFpsAmbiguous !== 'boolean') {
      normalized.lowFpsAmbiguous = false;
      changed = true;
    }
    const normalizedComments = normalizeComments(normalized.comments);
    if (JSON.stringify(normalizedComments) !== JSON.stringify(normalized.comments || [])) {
      normalized.comments = normalizedComments;
      changed = true;
    }
    nextLabels[proId] = normalized;
  }
  const next = { ...store, labels: nextLabels };
  if (changed) {
    await writeJson(config.proLabelsPath, next);
  }
  return next;
}

export async function getAllProLabels() {
  const store = await getProLabelsStore();
  return store.labels;
}

export async function upsertProLabel(proId, payload) {
  const store = await getProLabelsStore();
  const prev = (store.labels[proId] && typeof store.labels[proId] === 'object') ? store.labels[proId] : {};
  const merged = {
    ...prev,
    ...payload
  };
  if (typeof merged.lowFpsAmbiguous !== 'boolean') {
    merged.lowFpsAmbiguous = false;
  }
  merged.comments = normalizeComments(merged.comments);
  const next = {
    ...store,
    labels: {
      ...store.labels,
      [proId]: {
        ...merged,
        updatedAt: new Date().toISOString()
      }
    }
  };
  await writeJson(config.proLabelsPath, next);
  return next.labels[proId];
}

export async function addProLabelComment(proId, text) {
  const comment = String(text || '').trim();
  if (!comment) {
    throw new Error('invalid_comment');
  }
  const store = await getProLabelsStore();
  const prev = (store.labels[proId] && typeof store.labels[proId] === 'object') ? store.labels[proId] : {};
  const comments = normalizeComments(prev.comments);
  const nextComment = {
    text: comment.slice(0, 5000),
    createdAt: new Date().toISOString()
  };
  const nextLabel = {
    ...prev,
    lowFpsAmbiguous: typeof prev.lowFpsAmbiguous === 'boolean' ? prev.lowFpsAmbiguous : false,
    comments: [...comments, nextComment],
    updatedAt: new Date().toISOString()
  };
  const next = {
    ...store,
    labels: {
      ...store.labels,
      [proId]: nextLabel
    }
  };
  await writeJson(config.proLabelsPath, next);
  return nextLabel;
}

export async function removeProLabelComment(proId, commentIndex) {
  const idx = Number(commentIndex);
  if (!Number.isInteger(idx) || idx < 0) {
    throw new Error('invalid_comment_index');
  }
  const store = await getProLabelsStore();
  const prev = (store.labels[proId] && typeof store.labels[proId] === 'object') ? store.labels[proId] : {};
  const comments = normalizeComments(prev.comments);
  if (idx >= comments.length) {
    throw new Error('comment_not_found');
  }
  const nextComments = comments.filter((_, i) => i !== idx);
  const nextLabel = {
    ...prev,
    lowFpsAmbiguous: typeof prev.lowFpsAmbiguous === 'boolean' ? prev.lowFpsAmbiguous : false,
    comments: nextComments,
    updatedAt: new Date().toISOString()
  };
  const next = {
    ...store,
    labels: {
      ...store.labels,
      [proId]: nextLabel
    }
  };
  await writeJson(config.proLabelsPath, next);
  return nextLabel;
}
