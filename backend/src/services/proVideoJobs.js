import fs from 'node:fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';
import { ensureProVideoAvailable } from './proLibrary.js';
import { getOrCreateTracks } from './trackingService.js';
import { processVideoForContact } from './videoProcessing.js';

const jobs = new Map();
const queue = [];
let workerRunning = false;

function nowIso() {
  return new Date().toISOString();
}

function toPublicJob(job) {
  return {
    jobId: job.jobId,
    proId: job.proId,
    status: job.status,
    createdAt: job.createdAt,
    startedAt: job.startedAt || null,
    finishedAt: job.finishedAt || null,
    error: job.error || null,
    result: job.result || null
  };
}

async function runJob(job) {
  const pro = config.proVideos.find((x) => x.id === job.proId);
  if (!pro) {
    throw new Error(`pro_not_found: ${job.proId}`);
  }

  const ensured = await ensureProVideoAvailable(job.proId);
  const tracks = await getOrCreateTracks(ensured.localPath, { handedness: ensured.handedness });
  const analysis = await processVideoForContact(ensured.localPath, {
    strokeType: ensured.strokeType,
    handedness: ensured.handedness,
    courtSide: ensured.courtSide
  });

  // Force diagnostics list to rebuild on next query so latest background output appears.
  await fs.unlink(config.proDiagnosticsPath).catch(() => {});

  return {
    clipReady: true,
    trackingSource: tracks?.source || null,
    trackingError: tracks?.error || null,
    eventFound: Boolean(analysis?.event?.found),
    detectedFrame: Number.isFinite(Number(analysis?.event?.frame)) ? Number(analysis.event.frame) : null,
    confidence: Number.isFinite(Number(analysis?.event?.confidence)) ? Number(analysis.event.confidence) : null
  };
}

async function runWorker() {
  if (workerRunning) return;
  workerRunning = true;
  try {
    while (queue.length > 0) {
      const nextId = queue.shift();
      const job = jobs.get(nextId);
      if (!job) continue;
      job.status = 'running';
      job.startedAt = nowIso();
      try {
        job.result = await runJob(job);
        job.status = 'done';
      } catch (err) {
        job.error = String(err?.message || err);
        job.status = 'failed';
      } finally {
        job.finishedAt = nowIso();
      }
    }
  } finally {
    workerRunning = false;
  }
}

export function enqueueProVideoProcessing(proId) {
  const jobId = uuidv4();
  const job = {
    jobId,
    proId,
    status: 'queued',
    createdAt: nowIso(),
    startedAt: null,
    finishedAt: null,
    error: null,
    result: null
  };
  jobs.set(jobId, job);
  queue.push(jobId);
  void runWorker();
  return toPublicJob(job);
}

export function listProVideoJobs() {
  const all = Array.from(jobs.values()).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return all.map(toPublicJob);
}

export function getProVideoJob(jobId) {
  const job = jobs.get(jobId);
  return job ? toPublicJob(job) : null;
}
