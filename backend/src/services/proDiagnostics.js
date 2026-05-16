import path from 'node:path';
import { config } from '../config.js';
import { ensureProVideoAvailable } from './proLibrary.js';
import { processVideoForContact } from './videoProcessing.js';
import { getAllProLabels } from './proLabels.js';
import { readJson, writeJson } from '../utils/fs.js';
import { CURRENT_GENERATION_VERSION } from '../generation.js';

function proVideosSignature() {
  const rows = (config.proVideos || []).map((p) => ({
    id: p.id,
    title: String(p.title || ''),
    startTime: Number(p.startTime),
    endTime: Number(p.endTime),
    youtubeUrl: String(p.youtubeUrl || ''),
    playerName: String(p.playerName || ''),
    strokeType: String(p.strokeType || ''),
    handedness: String(p.handedness || ''),
    evaluationSet: String(p.evaluationSet || ''),
    cameraAngle: String(p.cameraAngle || ''),
    courtSide: String(p.courtSide || ''),
    dateAdded: String(p.dateAdded || '')
  }));
  rows.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return JSON.stringify(rows);
}

function createSummaryAccumulator() {
  return {
    errorCount: 0,
    sumAbsErrorFrames: 0,
    maxAbsErrorFrames: 0,
    sumAbsErrorMs: 0,
    maxAbsErrorMs: 0
  };
}

function finalizeSummary(acc) {
  return {
    evaluatedWithGroundTruth: acc.errorCount,
    meanAbsErrorFrames: acc.errorCount > 0 ? acc.sumAbsErrorFrames / acc.errorCount : null,
    maxAbsErrorFrames: acc.errorCount > 0 ? acc.maxAbsErrorFrames : null,
    meanAbsErrorMs: acc.errorCount > 0 ? acc.sumAbsErrorMs / acc.errorCount : null,
    maxAbsErrorMs: acc.errorCount > 0 ? acc.maxAbsErrorMs : null
  };
}

export async function buildProDetectionsDiagnostics() {
  const labels = await getAllProLabels();
  const items = [];
  const overall = createSummaryAccumulator();
  const bySet = {};

  for (const pro of config.proVideos) {
    const evaluationSet = String(pro.evaluationSet || 'core');
    if (!bySet[evaluationSet]) {
      bySet[evaluationSet] = createSummaryAccumulator();
    }

    try {
      const local = await ensureProVideoAvailable(pro.id);
      const baseAnalysis = await processVideoForContact(local.localPath, {
        strokeType: pro.strokeType,
        handedness: pro.handedness,
        courtSide: pro.courtSide
      });
      const analysis = {
        ...baseAnalysis,
        clipQc: local?.clipMeta?.qc || null
      };
      const fps = Number(analysis?.metadata?.fps || 60);
      const label = labels?.[pro.id] || {};
      const labeledFrame = Number(label.contactFrame);
      const labeledMs = Number(label.contactTimeMs);
      const lowFpsAmbiguous = Boolean(label.lowFpsAmbiguous);
      const comments = Array.isArray(label.comments) ? label.comments : [];
      const groundTruthContactFrame = Number.isFinite(labeledFrame)
        ? Math.round(labeledFrame)
        : (Number.isFinite(labeledMs) ? Math.round((labeledMs / 1000) * Math.max(1, fps)) : null);
      const groundTruthContactMs = Number.isFinite(groundTruthContactFrame)
        ? Math.round((groundTruthContactFrame / Math.max(1, fps)) * 1000)
        : null;
      const hasGroundTruth = Number.isFinite(groundTruthContactFrame);
      const detectedFrame = analysis?.event?.found ? Number(analysis.event.frame) : null;
      const detectedMs = Number.isFinite(detectedFrame)
        ? Math.round((detectedFrame / Math.max(1, fps)) * 1000)
        : null;

      let errorMs = null;
      let absErrorMs = null;
      let errorFrames = null;
      let absErrorFrames = null;
      if (hasGroundTruth && Number.isFinite(detectedFrame)) {
        errorFrames = detectedFrame - groundTruthContactFrame;
        absErrorFrames = Math.abs(errorFrames);
        errorMs = detectedMs - groundTruthContactMs;
        absErrorMs = Math.abs(errorMs);
        overall.errorCount += 1;
        overall.sumAbsErrorFrames += absErrorFrames;
        overall.maxAbsErrorFrames = Math.max(overall.maxAbsErrorFrames, absErrorFrames);
        overall.sumAbsErrorMs += absErrorMs;
        overall.maxAbsErrorMs = Math.max(overall.maxAbsErrorMs, absErrorMs);
        bySet[evaluationSet].errorCount += 1;
        bySet[evaluationSet].sumAbsErrorFrames += absErrorFrames;
        bySet[evaluationSet].maxAbsErrorFrames = Math.max(bySet[evaluationSet].maxAbsErrorFrames, absErrorFrames);
        bySet[evaluationSet].sumAbsErrorMs += absErrorMs;
        bySet[evaluationSet].maxAbsErrorMs = Math.max(bySet[evaluationSet].maxAbsErrorMs, absErrorMs);
      }

      items.push({
        id: pro.id,
        title: pro.title,
        playerName: pro.playerName || null,
        evaluationSet,
        strokeType: pro.strokeType || null,
        handedness: pro.handedness || null,
        cameraAngle: pro.cameraAngle || null,
        courtSide: pro.courtSide || null,
        dateAdded: pro.dateAdded || null,
        sourceUrl: pro.youtubeUrl,
        videoPublicUrl: `/files/pros/${path.basename(local.localPath)}`,
        analysis,
        lowFpsAmbiguous,
        comments,
        commentCount: comments.length,
        groundTruthContactFrame: hasGroundTruth ? groundTruthContactFrame : null,
        groundTruthContactMs: hasGroundTruth ? groundTruthContactMs : null,
        detectedFrame: Number.isFinite(detectedFrame) ? detectedFrame : null,
        detectedMs: Number.isFinite(detectedMs) ? detectedMs : null,
        errorMs,
        absErrorMs,
        errorFrames,
        absErrorFrames
      });
    } catch (err) {
      let videoPublicUrl = null;
      let clipQc = null;
      try {
        const local = await ensureProVideoAvailable(pro.id);
        videoPublicUrl = `/files/pros/${path.basename(local.localPath)}`;
        clipQc = local?.clipMeta?.qc || null;
      } catch {
        videoPublicUrl = null;
      }
      items.push({
        id: pro.id,
        title: pro.title,
        playerName: pro.playerName || null,
        evaluationSet,
        strokeType: pro.strokeType || null,
        handedness: pro.handedness || null,
        cameraAngle: pro.cameraAngle || null,
        courtSide: pro.courtSide || null,
        dateAdded: pro.dateAdded || null,
        sourceUrl: pro.youtubeUrl,
        videoPublicUrl,
        clipQc,
        lowFpsAmbiguous: false,
        comments: [],
        commentCount: 0,
        error: err.message
      });
    }
  }

  return {
    items,
    summary: finalizeSummary(overall),
    summaryBySet: Object.fromEntries(
      Object.entries(bySet).map(([key, acc]) => [key, finalizeSummary(acc)])
    )
  };
}

export async function getProDetectionsDiagnostics({ refresh = false } = {}) {
  const currentSignature = proVideosSignature();
  if (!refresh) {
    const cached = await readJson(config.proDiagnosticsPath, null);
    if (
      cached
      && typeof cached === 'object'
      && cached.generationVersion === CURRENT_GENERATION_VERSION
      && cached.proVideosSignature === currentSignature
      && Array.isArray(cached.items)
    ) {
      return { ...cached, source: 'cache' };
    }
  }

  const built = await buildProDetectionsDiagnostics();
  const payload = {
    generationVersion: CURRENT_GENERATION_VERSION,
    proVideosSignature: currentSignature,
    generatedAt: new Date().toISOString(),
    ...built
  };
  await writeJson(config.proDiagnosticsPath, payload);
  return { ...payload, source: 'generated' };
}

function toNum(x) {
  return Number.isFinite(Number(x)) ? Number(x) : null;
}

function metricDelta(currentValue, baselineValue) {
  const after = toNum(currentValue);
  const before = toNum(baselineValue);
  return {
    before,
    after,
    delta: before !== null && after !== null ? after - before : null
  };
}

export function computeDiagnosticsDelta(current, baseline) {
  if (!current || !baseline) return null;

  const curSummary = current.summary || {};
  const baseSummary = baseline.summary || {};
  const summary = {
    evaluatedWithGroundTruth: metricDelta(
      curSummary.evaluatedWithGroundTruth,
      baseSummary.evaluatedWithGroundTruth
    ),
    evaluatedWithGroundTruthDelta:
      toNum(curSummary.evaluatedWithGroundTruth) !== null && toNum(baseSummary.evaluatedWithGroundTruth) !== null
        ? toNum(curSummary.evaluatedWithGroundTruth) - toNum(baseSummary.evaluatedWithGroundTruth)
        : null,
    meanAbsErrorFrames: metricDelta(
      curSummary.meanAbsErrorFrames,
      baseSummary.meanAbsErrorFrames
    ),
    meanAbsErrorFramesDelta:
      toNum(curSummary.meanAbsErrorFrames) !== null && toNum(baseSummary.meanAbsErrorFrames) !== null
        ? toNum(curSummary.meanAbsErrorFrames) - toNum(baseSummary.meanAbsErrorFrames)
        : null,
    maxAbsErrorFrames: metricDelta(
      curSummary.maxAbsErrorFrames,
      baseSummary.maxAbsErrorFrames
    ),
    maxAbsErrorFramesDelta:
      toNum(curSummary.maxAbsErrorFrames) !== null && toNum(baseSummary.maxAbsErrorFrames) !== null
        ? toNum(curSummary.maxAbsErrorFrames) - toNum(baseSummary.maxAbsErrorFrames)
        : null
  };

  const curBySet = current.summaryBySet || {};
  const baseBySet = baseline.summaryBySet || {};
  const setNames = new Set([...Object.keys(curBySet), ...Object.keys(baseBySet)]);
  const summaryBySet = {};
  for (const setName of setNames) {
    const c = curBySet[setName] || {};
    const b = baseBySet[setName] || {};
    summaryBySet[setName] = {
      evaluatedWithGroundTruth: metricDelta(
        c.evaluatedWithGroundTruth,
        b.evaluatedWithGroundTruth
      ),
      evaluatedWithGroundTruthDelta:
        toNum(c.evaluatedWithGroundTruth) !== null && toNum(b.evaluatedWithGroundTruth) !== null
          ? toNum(c.evaluatedWithGroundTruth) - toNum(b.evaluatedWithGroundTruth)
          : null,
      meanAbsErrorFrames: metricDelta(
        c.meanAbsErrorFrames,
        b.meanAbsErrorFrames
      ),
      meanAbsErrorFramesDelta:
        toNum(c.meanAbsErrorFrames) !== null && toNum(b.meanAbsErrorFrames) !== null
          ? toNum(c.meanAbsErrorFrames) - toNum(b.meanAbsErrorFrames)
          : null,
      maxAbsErrorFrames: metricDelta(
        c.maxAbsErrorFrames,
        b.maxAbsErrorFrames
      ),
      maxAbsErrorFramesDelta:
        toNum(c.maxAbsErrorFrames) !== null && toNum(b.maxAbsErrorFrames) !== null
          ? toNum(c.maxAbsErrorFrames) - toNum(b.maxAbsErrorFrames)
          : null
    };
  }

  const curItems = new Map((current.items || []).map((item) => [item.id, item]));
  const baseItems = new Map((baseline.items || []).map((item) => [item.id, item]));
  const itemIds = new Set([...curItems.keys(), ...baseItems.keys()]);
  const items = [];
  for (const id of itemIds) {
    const c = curItems.get(id) || {};
    const b = baseItems.get(id) || {};
    const curErr = toNum(c.absErrorFrames);
    const baseErr = toNum(b.absErrorFrames);
    items.push({
      id,
      title: String(c.title || b.title || ''),
      playerName: (c.playerName || b.playerName || null),
      evaluationSet: String(c.evaluationSet || b.evaluationSet || 'core'),
      groundTruthContactFrame: toNum(c.groundTruthContactFrame ?? b.groundTruthContactFrame),
      prevDetectedFrame: toNum(b.detectedFrame),
      curDetectedFrame: toNum(c.detectedFrame),
      prevAbsErrorFrames: baseErr,
      curAbsErrorFrames: curErr,
      detectedFrame: metricDelta(c.detectedFrame, b.detectedFrame),
      absErrorFrames: metricDelta(c.absErrorFrames, b.absErrorFrames),
      absErrorFramesDelta: (curErr !== null && baseErr !== null) ? (curErr - baseErr) : null
    });
  }

  return { summary, summaryBySet, items };
}
