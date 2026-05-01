import { v4 as uuidv4 } from 'uuid';
import { scanAndExtractServeClips } from './userVideoManagement.js';

const jobs = new Map();
const queue = [];
let workerRunning = false;

function nowIso() {
  return new Date().toISOString();
}

function toPublicJob(job) {
  return {
    jobId: job.jobId,
    status: job.status,
    createdAt: job.createdAt,
    startedAt: job.startedAt || null,
    finishedAt: job.finishedAt || null,
    error: job.error || null,
    upload: job.upload || null,
    progress: job.progress || null,
    result: job.result || null
  };
}

async function runJob(job) {
  const entry = await scanAndExtractServeClips({
    inputVideoPath: job.inputVideoPath,
    sourceFileName: job.sourceFileName,
    clientMetrics: job.clientMetrics || null,
    onProgress: (progress) => {
      job.progress = {
        ...(job.progress || {}),
        ...progress,
        updatedAt: nowIso()
      };
    }
  });
  return {
    entryId: entry.id,
    extractedClipCount: Array.isArray(entry?.extractedClips) ? entry.extractedClips.length : 0
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
      if (!job.progress) job.progress = { stage: 'queued', percent: 0, updatedAt: nowIso() };
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

export function enqueueUserVideoJob({
  inputVideoPath,
  sourceFileName,
  sourcePublicUrl,
  sourceSizeBytes,
  clientMetrics = null
}) {
  const jobId = uuidv4();
  const job = {
    jobId,
    inputVideoPath,
    sourceFileName,
    clientMetrics,
    status: 'queued',
    createdAt: nowIso(),
    startedAt: null,
    finishedAt: null,
    error: null,
    progress: {
      stage: 'queued',
      percent: 0,
      message: 'Queued for processing',
      updatedAt: nowIso()
    },
    upload: {
      fileName: sourceFileName,
      publicUrl: sourcePublicUrl,
      sizeBytes: Number(sourceSizeBytes || 0)
    },
    result: null
  };
  jobs.set(jobId, job);
  queue.push(jobId);
  void runWorker();
  return toPublicJob(job);
}

export function listUserVideoJobs() {
  const all = Array.from(jobs.values()).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return all.map(toPublicJob);
}

export function getUserVideoJob(jobId) {
  const job = jobs.get(jobId);
  return job ? toPublicJob(job) : null;
}
