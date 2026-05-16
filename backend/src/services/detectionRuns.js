import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { config } from '../config.js';
import { ensureDir, readJson, writeJson } from '../utils/fs.js';

const INDEX_SCHEMA_VERSION = 'detection-runs-v1';
const AUTO_RUN_KEEP_LIMIT = 120;

const TAG_TYPES = new Set(['iteration', 'feature-branch', 'experiment', 'stable', 'auto']);

function defaultIndex() {
  return {
    schemaVersion: INDEX_SCHEMA_VERSION,
    stableRunId: null,
    runs: []
  };
}

function hashSignature(value) {
  return createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16);
}

function normalizeTagType(value, fallback = 'iteration') {
  const v = String(value || '').trim().toLowerCase();
  if (TAG_TYPES.has(v)) return v;
  return fallback;
}

function normalizeIndex(index) {
  if (!index || typeof index !== 'object') return defaultIndex();
  const runs = (Array.isArray(index.runs) ? index.runs : []).map((run) => ({
    ...run,
    tagType: normalizeTagType(run?.tagType, (run?.runType || 'manual') === 'auto' ? 'auto' : 'iteration'),
    branchName: String(run?.branchName || '').trim() || null,
    parentRunId: String(run?.parentRunId || '').trim() || null,
    proVideosSignatureHash: run?.proVideosSignatureHash
      || (run?.proVideosSignature ? hashSignature(run.proVideosSignature) : null),
    proVideosSignature: null
  }));
  return {
    schemaVersion: INDEX_SCHEMA_VERSION,
    stableRunId: typeof index.stableRunId === 'string' ? index.stableRunId : null,
    runs
  };
}

function runPath(runId) {
  return path.join(config.detectionRunsDir, `${runId}.json`);
}

export async function initDetectionRunsStore() {
  await ensureDir(config.detectionRunsDir);
  const current = await readJson(config.detectionRunsIndexPath, null);
  if (!current || typeof current !== 'object') {
    await writeJson(config.detectionRunsIndexPath, defaultIndex());
    return;
  }
  const normalized = normalizeIndex(current);
  await writeJson(config.detectionRunsIndexPath, normalized);
}

export async function getDetectionRunsIndex() {
  const raw = await readJson(config.detectionRunsIndexPath, null);
  return normalizeIndex(raw);
}

async function saveDetectionRunsIndex(next) {
  await writeJson(config.detectionRunsIndexPath, normalizeIndex(next));
}

export async function listDetectionRuns() {
  const index = await getDetectionRunsIndex();
  const hydrated = [];
  for (const run of index.runs) {
    if (run?.summaryBySet && typeof run.summaryBySet === 'object') {
      hydrated.push(run);
      continue;
    }
    // Older index rows did not include per-set summaries; hydrate from the run snapshot.
    // eslint-disable-next-line no-await-in-loop
    const full = await getDetectionRun(run.runId);
    hydrated.push({
      ...run,
      summaryBySet: full?.summaryBySet || {}
    });
  }
  const sorted = hydrated.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return {
    stableRunId: index.stableRunId,
    latestRunId: sorted[0]?.runId || null,
    runs: sorted
  };
}

export async function getDetectionRun(runId) {
  if (!runId) return null;
  return readJson(runPath(runId), null);
}

export async function getStableDetectionRun() {
  const index = await getDetectionRunsIndex();
  if (!index.stableRunId) return null;
  const stable = await getDetectionRun(index.stableRunId);
  if (!stable) return null;
  return stable;
}

export async function getLatestDetectionRun() {
  const index = await getDetectionRunsIndex();
  const latest = [...index.runs].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null;
  if (!latest?.runId) return null;
  return getDetectionRun(latest.runId);
}

export async function setStableDetectionRun(runId) {
  const index = await getDetectionRunsIndex();
  const meta = index.runs.find((r) => r.runId === runId);
  if (!meta) {
    throw new Error(`run_not_found: ${runId}`);
  }
  const next = { ...index, stableRunId: runId };
  await saveDetectionRunsIndex(next);
  return { stableRunId: runId };
}

export async function computeDetectionLogicFingerprint() {
  const files = [
    path.join(config.rootDir, 'src', 'services', 'contactDetection.js'),
    path.join(config.rootDir, 'src', 'scripts', 'auto_track.py'),
    path.join(config.rootDir, 'src', 'services', 'trackingService.js'),
    path.join(config.rootDir, 'config', 'pro_videos.json')
  ];

  const hash = createHash('sha256');
  for (const filePath of files) {
    // eslint-disable-next-line no-await-in-loop
    const raw = await fs.readFile(filePath);
    hash.update(filePath);
    hash.update(raw);
  }
  return hash.digest('hex').slice(0, 16);
}

function buildRunMeta(record) {
  return {
    runId: record.runId,
    createdAt: record.createdAt,
    runType: record.runType || 'manual',
    autoReason: record.autoReason || null,
    tagType: normalizeTagType(record.tagType, (record.runType || 'manual') === 'auto' ? 'auto' : 'iteration'),
    branchName: String(record.branchName || '').trim() || null,
    parentRunId: String(record.parentRunId || '').trim() || null,
    logicVersion: record.logicVersion || null,
    notes: record.notes || null,
    logicFingerprint: record.logicFingerprint,
    diagnosticsFingerprint: record.diagnosticsFingerprint || null,
    proVideosSignatureHash: record.proVideosSignatureHash || null,
    generationVersion: record.generationVersion || null,
    summary: record.summary || {},
    summaryBySet: record.summaryBySet || {}
  };
}

function computeDiagnosticsFingerprint(diagnostics) {
  const hash = createHash('sha256');
  const normalized = {
    generationVersion: diagnostics?.generationVersion || null,
    proVideosSignature: diagnostics?.proVideosSignature || null,
    summary: diagnostics?.summary || {},
    summaryBySet: diagnostics?.summaryBySet || {},
    items: (diagnostics?.items || []).map((item) => ({
      id: item?.id || null,
      detectedFrame: item?.detectedFrame ?? null,
      absErrorFrames: item?.absErrorFrames ?? null,
      confidence: Number(item?.analysis?.event?.confidence ?? NaN),
      mode: item?.analysis?.event?.diagnostics?.mode || null
    }))
  };
  hash.update(JSON.stringify(normalized));
  return hash.digest('hex').slice(0, 16);
}

async function applyAutoRunRetention(index) {
  const autoRuns = [...index.runs]
    .filter((r) => (r.runType || 'manual') === 'auto')
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  if (autoRuns.length <= AUTO_RUN_KEEP_LIMIT) return index;

  const keepSet = new Set(autoRuns.slice(0, AUTO_RUN_KEEP_LIMIT).map((r) => r.runId));
  if (index.stableRunId) keepSet.add(index.stableRunId);
  const toDelete = autoRuns.filter((r) => !keepSet.has(r.runId));
  if (!toDelete.length) return index;

  for (const run of toDelete) {
    // eslint-disable-next-line no-await-in-loop
    await fs.unlink(runPath(run.runId)).catch(() => {});
  }
  return {
    ...index,
    runs: index.runs.filter((r) => !toDelete.some((d) => d.runId === r.runId))
  };
}

export async function createDetectionRun({
  diagnostics,
  runType = 'manual',
  autoReason = null,
  tagType = null,
  branchName = null,
  parentRunId = null,
  logicVersion = null,
  notes = null,
  markStable = false,
  baselineRunId = null
}) {
  const runId = `run-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const createdAt = new Date().toISOString();
  const logicFingerprint = await computeDetectionLogicFingerprint();
  const diagnosticsFingerprint = computeDiagnosticsFingerprint(diagnostics);
  const record = {
    runId,
    createdAt,
    runType,
    autoReason,
    tagType: normalizeTagType(tagType, runType === 'auto' ? 'auto' : 'iteration'),
    branchName: String(branchName || '').trim() || null,
    parentRunId: String(parentRunId || '').trim() || null,
    logicVersion,
    notes,
    logicFingerprint,
    diagnosticsFingerprint,
    proVideosSignatureHash: hashSignature(diagnostics?.proVideosSignature || ''),
    generationVersion: diagnostics?.generationVersion || null,
    baselineRunId: baselineRunId || null,
    summary: diagnostics?.summary || {},
    summaryBySet: diagnostics?.summaryBySet || {},
    items: diagnostics?.items || []
  };

  await writeJson(runPath(runId), record);
  const index = await getDetectionRunsIndex();
  let next = {
    ...index,
    runs: [...index.runs, buildRunMeta(record)],
    stableRunId: markStable ? runId : index.stableRunId
  };
  next = await applyAutoRunRetention(next);
  await saveDetectionRunsIndex(next);
  return record;
}

export async function maybeCreateAutoDetectionRun({ diagnostics, reason = 'auto_refresh' }) {
  const logicFingerprint = await computeDetectionLogicFingerprint();
  const diagnosticsFingerprint = computeDiagnosticsFingerprint(diagnostics);
  const index = await getDetectionRunsIndex();
  const latest = [...index.runs].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null;

  if (
    latest
    && (latest.runType || 'manual') === 'auto'
    && latest.logicFingerprint === logicFingerprint
    && (latest.generationVersion || null) === (diagnostics?.generationVersion || null)
    && (latest.proVideosSignatureHash || null) === hashSignature(diagnostics?.proVideosSignature || '')
    && (latest.diagnosticsFingerprint || null) === diagnosticsFingerprint
  ) {
    return { created: false, reason: 'duplicate_latest_auto_run', runId: latest.runId };
  }

  const run = await createDetectionRun({
    diagnostics,
    runType: 'auto',
    autoReason: reason,
    tagType: 'auto',
    branchName: null,
    parentRunId: null,
    logicVersion: null,
    notes: null,
    markStable: false,
    baselineRunId: index.stableRunId || null
  });
  return { created: true, runId: run.runId, createdAt: run.createdAt };
}
