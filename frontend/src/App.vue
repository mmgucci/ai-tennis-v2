<script setup>
import { onMounted, onUnmounted, ref, computed, watch } from 'vue';

const proVideos = ref([]);
const selectedPro = ref('');
const selectedAmateurPro = ref('');
const selectedExistingUpload = ref('');
const activePage = ref('compare');
const compareMode = ref('upload');
const uploadSelectionMode = ref('new_upload');
const uploadFile = ref(null);
const loading = ref(false);
const debugBusy = ref(false);
const debugMessage = ref('');
const error = ref('');
const recalcBusy = ref(false);
const recalcMessage = ref('');
const currentGenerationVersion = ref('');
const sessions = ref([]);
const uploads = ref([]);
const userVideoEntries = ref([]);
const userVideoJobs = ref([]);
const userVideoFile = ref(null);
const userVideoBusy = ref(false);
const userVideoError = ref('');
const userVideoInfo = ref('');
const userClipVideoEls = ref({});
const userClipTimes = ref({});
const userClipPlaying = ref({});
const userClipMuted = ref({});
const userClipVolume = ref({});
const userClipRafIds = ref({});
const userClipLazyActive = ref({});
const userClipLazyPinned = ref({});
const userDetectionItems = ref([]);
const userDetectionLoading = ref(false);
const userDetectionError = ref('');
const userDetVideoEls = ref({});
const userDetCanvasEls = ref({});
const userDetTimes = ref({});
const userDetPlaying = ref({});
const userDetMuted = ref({});
const userDetVolume = ref({});
const userDetRafIds = ref({});
const userDetTracks = ref({});
const userDetTracksBusy = ref({});
const userDetOverlayPrefs = ref({});
const userDetOverlayStats = ref({});
const userDetGroundTruthInput = ref({});
const userDetHasContactInput = ref({});
const userDetSaveBusy = ref({});
const userDetSeekStates = ref({});
const userDetLazyActive = ref({});
const userDetLazyPinned = ref({});
const userDetSort = ref('date_added_desc');
const userDetFilterHasContact = ref('all');
const userVideoCompressEnabled = ref(true);
const userVideoCompressStatus = ref('');
const userVideoCompressProgress = ref(null);
const userVideoOriginalBytes = ref(0);
const userVideoCompressedBytes = ref(0);
const proDiagnostics = ref([]);
const proDiagnosticsLoading = ref(false);
const proDiagnosticsError = ref('');
const refreshStatus = ref(null);
const refreshStatusLoading = ref(false);
const refreshAllBusy = ref(false);
const labSyncState = ref('idle');
const proDiagTimes = ref({});
const proDiagVideoEls = ref({});
const proDiagCanvasEls = ref({});
const proDiagTracks = ref({});
const proDiagTracksBusy = ref({});
const proDiagOverlayStats = ref({});
const proDiagOverlayPrefs = ref({});
const proDiagAvailability = ref({});
const proDiagDetailsOpen = ref({});
const proDiagCommentsOpen = ref({});
const proDiagPlaying = ref({});
const proDiagMuted = ref({});
const proDiagVolume = ref({});
const proDiagRafIds = ref({});
const proDiagSeekStates = ref({});
const proDiagCinemaMode = ref({});
const proDiagVideoSrc = ref({});
const proGroundTruthFrame = ref({});
const proGroundTruthLowFpsAmbiguous = ref({});
const proSaveLabelBusy = ref({});
const knownPlayers = ref([]);
const proDiagPlayerSelection = ref({});
const proDiagNewPlayerName = ref({});
const proDiagNewPlayerHandedness = ref({});
const proDiagPlayerSaveBusy = ref({});
const proDiagnosticsSummary = ref(null);
const proDiagnosticsSummaryBySet = ref({});
const proDiagSort = ref('set_asc');
const proDiagFilterHandedness = ref('all');
const proDiagFilterPlayer = ref('all');
const proDiagFilterSet = ref('all');
const proDiagFilterCourtSide = ref('all');
const proDiagFilterCameraAngle = ref('all');
const proDiagFilterResult = ref('all');
const proDiagFilterGroundTruth = ref('all');
const copiedDiagVideoId = ref('');
let copiedDiagVideoTimer = null;
let proDiagVisibilityObserver = null;
const proDiagEditMode = ref({});
const proDiagEditDraft = ref({});
const proDiagEditBusy = ref({});
const proDiagNewComment = ref({});
const proDiagCommentBusy = ref({});
const proDiagCommentDeleteBusy = ref({});
const proDiagLazyActive = ref({});
const proDiagLazyPinned = ref({});
const proDiagCardEls = new Map();
const userClipCardEls = new Map();
const userDetCardEls = new Map();
let userClipVisibilityObserver = null;
let userDetVisibilityObserver = null;
let userVideoJobsPollTimer = null;
const activeSession = ref(null);
const currentTime = ref(0);
const timelineMode = ref('synced');

const amateurRef = ref(null);
const proRef = ref(null);

const activeComparison = computed(() => activeSession.value?.comparison ?? null);
const isSyncedTimeline = computed(() => timelineMode.value === 'synced');
const alignmentOffsetSec = computed(() => {
  const ms = activeComparison.value?.alignment?.alignmentOffsetMs;
  return Number.isFinite(ms) ? ms / 1000 : 0;
});
const timelineMinSeconds = computed(() => {
  return isSyncedTimeline.value ? Math.min(0, -alignmentOffsetSec.value) : 0;
});
const timelineMaxSeconds = computed(() => {
  const d1 = activeComparison.value?.amateur?.metadata?.duration ?? 0;
  const d2 = activeComparison.value?.pro?.metadata?.duration ?? 0;
  const offset = alignmentOffsetSec.value;
  if (!isSyncedTimeline.value) return Math.max(d1, d2, 0);
  const proSharedEnd = d2 - offset;
  return Math.max(d1, proSharedEnd, 0);
});
const durationSeconds = computed(() => Math.max(0, timelineMaxSeconds.value - timelineMinSeconds.value));
const timelineProgressRatio = computed(() => {
  if (!durationSeconds.value) return 0;
  return Math.max(0, Math.min(1, currentTime.value / durationSeconds.value));
});
const amateurWavePath = computed(() => {
  const comp = activeComparison.value;
  if (!comp) return '';
  const bins = comp.amateur?.audioAssist?.waveformBins || [];
  const duration = Number(comp.amateur?.metadata?.duration || 0);
  return buildWaveOverlayPath({
    bins,
    sourceDurationSec: duration,
    sharedShiftSec: 0,
    displayMinSec: timelineMinSeconds.value,
    displayDurationSec: durationSeconds.value
  });
});
const proWavePath = computed(() => {
  const comp = activeComparison.value;
  if (!comp) return '';
  const bins = comp.pro?.audioAssist?.waveformBins || [];
  const duration = Number(comp.pro?.metadata?.duration || 0);
  const sharedShift = isSyncedTimeline.value ? -alignmentOffsetSec.value : 0;
  return buildWaveOverlayPath({
    bins,
    sourceDurationSec: duration,
    sharedShiftSec: sharedShift,
    displayMinSec: timelineMinSeconds.value,
    displayDurationSec: durationSeconds.value
  });
});
const amateurAudioPeaks = computed(() => {
  const comp = activeComparison.value;
  if (!comp) return [];
  const peaks = comp.amateur?.audioAssist?.peaks || [];
  const duration = Number(comp.amateur?.metadata?.duration || 0);
  const selectedPeakMs = Number(comp.amateur?.event?.diagnostics?.audioPeakTimeMs);
  return buildAudioPeakMarkers({
    peaks,
    sourceDurationSec: duration,
    sharedShiftSec: 0,
    displayMinSec: timelineMinSeconds.value,
    displayDurationSec: durationSeconds.value,
    selectedPeakMs
  });
});
const proAudioPeaks = computed(() => {
  const comp = activeComparison.value;
  if (!comp) return [];
  const peaks = comp.pro?.audioAssist?.peaks || [];
  const duration = Number(comp.pro?.metadata?.duration || 0);
  const sharedShift = isSyncedTimeline.value ? -alignmentOffsetSec.value : 0;
  const selectedPeakMs = Number(comp.pro?.event?.diagnostics?.audioPeakTimeMs);
  return buildAudioPeakMarkers({
    peaks,
    sourceDurationSec: duration,
    sharedShiftSec: sharedShift,
    displayMinSec: timelineMinSeconds.value,
    displayDurationSec: durationSeconds.value,
    selectedPeakMs
  });
});
const eventMarkers = computed(() => {
  const markers = [];
  const comp = activeComparison.value;
  const total = durationSeconds.value;
  if (!comp || !total) return markers;

  const offsetSec = alignmentOffsetSec.value;
  const amateurTs = comp.amateur?.event?.found ? (comp.amateur.event.timestampMs ?? 0) / 1000 : null;
  const proTs = comp.pro?.event?.found ? (comp.pro.event.timestampMs ?? 0) / 1000 : null;

  if (amateurTs !== null) {
    const displaySec = amateurTs - timelineMinSeconds.value;
    markers.push({
      id: 'amateur-contact',
      label: 'Contact (Amateur)',
      lane: 'amateur',
      timeSec: amateurTs,
      displaySec,
      pct: Math.max(0, Math.min(100, ((amateurTs - timelineMinSeconds.value) / total) * 100))
    });
  }
  if (proTs !== null) {
    const markerTime = isSyncedTimeline.value ? proTs - offsetSec : proTs;
    const displaySec = markerTime - timelineMinSeconds.value;
    markers.push({
      id: 'pro-contact',
      label: 'Contact (Pro)',
      lane: 'pro',
      timeSec: markerTime,
      displaySec,
      pct: Math.max(0, Math.min(100, ((markerTime - timelineMinSeconds.value) / total) * 100))
    });
  }
  return markers;
});
const canContactSync = computed(() => {
  const comp = activeComparison.value;
  return Boolean(comp?.amateur?.event?.found && comp?.pro?.event?.found);
});
const sessionGenerationVersion = computed(() => activeSession.value?.generation?.version || 'unknown');
const isActiveSessionOutdated = computed(() => Boolean(activeSession.value?.isOutdatedGeneration));
const diagnosticsBySet = computed(() => {
  const grouped = {};
  for (const item of proDiagnostics.value) {
    const setName = String(item.evaluationSet || 'core');
    if (!grouped[setName]) grouped[setName] = [];
    grouped[setName].push(item);
  }
  return grouped;
});
const diagnosticSetNames = computed(() => {
  const names = Object.keys(diagnosticsBySet.value);
  const preferred = ['core', 'edge'];
  const orderedPreferred = preferred.filter((name) => names.includes(name));
  const remaining = names.filter((name) => !preferred.includes(name)).sort();
  return [...orderedPreferred, ...remaining];
});
const diagnosticSummarySetNames = computed(() => {
  const keys = Object.keys(proDiagnosticsSummaryBySet.value || {});
  const preferred = ['core', 'edge'];
  const orderedPreferred = preferred.filter((name) => keys.includes(name));
  const remaining = keys.filter((name) => !preferred.includes(name)).sort();
  return [...orderedPreferred, ...remaining];
});
const diagnosticCameraAngleFilterOptions = computed(() => {
  const values = new Set();
  for (const item of proDiagnostics.value || []) {
    const angle = String(item?.cameraAngle || '').trim().toLowerCase();
    if (!angle) continue;
    values.add(angle);
  }
  return ['all', ...Array.from(values).sort()];
});

function hasGroundTruthValue(item) {
  const raw = item?.groundTruthContactFrame;
  return raw !== null && raw !== undefined && Number.isFinite(Number(raw));
}

function hasErrorFramesValue(item) {
  const raw = item?.errorFrames;
  return raw !== null && raw !== undefined && Number.isFinite(Number(raw));
}

function hasAbsErrorFramesValue(item) {
  const raw = item?.absErrorFrames;
  return raw !== null && raw !== undefined && Number.isFinite(Number(raw));
}

const sortedProDiagnostics = computed(() => {
  const resultClass = (item) => {
    if (!hasGroundTruthValue(item)) return 'missing_gt';
    if (!hasAbsErrorFramesValue(item)) return 'na';
    const v = Number(item?.absErrorFrames);
    if (v <= 2) return 'good';
    if (v <= 5) return 'medium';
    return 'bad';
  };
  const items = proDiagnostics.value.filter((item) => {
    const handedness = String(item?.handedness || '').toLowerCase();
    const player = normalizePlayerName(item?.playerName || '').toLowerCase();
    const setName = String(item?.evaluationSet || '').toLowerCase();
    const courtSide = String(item?.courtSide || '').toLowerCase();
    const cameraAngle = String(item?.cameraAngle || '').toLowerCase();
    const okHandedness = proDiagFilterHandedness.value === 'all' || handedness === proDiagFilterHandedness.value;
    const selectedPlayer = String(proDiagFilterPlayer.value || 'all').toLowerCase();
    const okPlayer = selectedPlayer === 'all' || player === selectedPlayer;
    const okSet = proDiagFilterSet.value === 'all' || setName === proDiagFilterSet.value;
    const okCourtSide = proDiagFilterCourtSide.value === 'all' || courtSide === proDiagFilterCourtSide.value;
    const okCameraAngle = proDiagFilterCameraAngle.value === 'all' || cameraAngle === proDiagFilterCameraAngle.value;
    const okResult = proDiagFilterResult.value === 'all' || resultClass(item) === proDiagFilterResult.value;
    const hasGroundTruth = hasGroundTruthValue(item);
    const okGroundTruth = proDiagFilterGroundTruth.value === 'all'
      || (proDiagFilterGroundTruth.value === 'set' && hasGroundTruth)
      || (proDiagFilterGroundTruth.value === 'not_set' && !hasGroundTruth);
    return okHandedness && okPlayer && okSet && okCourtSide && okCameraAngle && okResult && okGroundTruth;
  });
  const setRank = (setName) => {
    const v = String(setName || 'core').toLowerCase();
    if (v === 'core') return 0;
    if (v === 'edge') return 1;
    return 2;
  };
  const absErr = (item) => {
    const v = Number(item?.absErrorFrames);
    return Number.isFinite(v) ? v : Number.POSITIVE_INFINITY;
  };
  const errorSortGroupAsc = (item) => {
    if (!hasAbsErrorFramesValue(item) && hasGroundTruthValue(item)) return 2; // detection n/a -> bottom
    if (!hasAbsErrorFramesValue(item) && !hasGroundTruthValue(item)) return 1;
    return 0;
  };
  const errorSortGroupDesc = (item) => {
    if (!hasAbsErrorFramesValue(item) && hasGroundTruthValue(item)) return 0; // detection n/a -> top
    if (!hasAbsErrorFramesValue(item) && !hasGroundTruthValue(item)) return 2;
    return 1;
  };
  const conf = (item) => {
    const v = Number(item?.analysis?.event?.confidence);
    return Number.isFinite(v) ? v : Number.NEGATIVE_INFINITY;
  };
  const dateAddedTs = (item) => {
    const raw = String(item?.dateAdded || '').trim();
    const t = Date.parse(raw);
    return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
  };

  items.sort((a, b) => {
    switch (proDiagSort.value) {
      case 'set_desc': {
        const d = setRank(b?.evaluationSet) - setRank(a?.evaluationSet);
        if (d !== 0) return d;
        return String(a?.id || '').localeCompare(String(b?.id || ''));
      }
      case 'error_asc': {
        const g = errorSortGroupAsc(a) - errorSortGroupAsc(b);
        if (g !== 0) return g;
        const d = absErr(a) - absErr(b);
        if (d !== 0) return d;
        return String(a?.id || '').localeCompare(String(b?.id || ''));
      }
      case 'error_desc': {
        const g = errorSortGroupDesc(a) - errorSortGroupDesc(b);
        if (g !== 0) return g;
        const d = absErr(b) - absErr(a);
        if (d !== 0) return d;
        return String(a?.id || '').localeCompare(String(b?.id || ''));
      }
      case 'date_added_asc': {
        const d = dateAddedTs(a) - dateAddedTs(b);
        if (d !== 0) return d;
        return String(a?.id || '').localeCompare(String(b?.id || ''));
      }
      case 'date_added_desc': {
        const d = dateAddedTs(b) - dateAddedTs(a);
        if (d !== 0) return d;
        return String(a?.id || '').localeCompare(String(b?.id || ''));
      }
      case 'confidence_asc': {
        const d = conf(a) - conf(b);
        if (d !== 0) return d;
        return String(a?.id || '').localeCompare(String(b?.id || ''));
      }
      case 'confidence_desc': {
        const d = conf(b) - conf(a);
        if (d !== 0) return d;
        return String(a?.id || '').localeCompare(String(b?.id || ''));
      }
      case 'set_asc':
      default: {
        const d = setRank(a?.evaluationSet) - setRank(b?.evaluationSet);
        if (d !== 0) return d;
        return String(a?.id || '').localeCompare(String(b?.id || ''));
      }
    }
  });
  return items;
});
const DIAG_POSE_CONNECTIONS = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28]
];
const DIAG_POSE_DOT_INDICES = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

function normalizeUserDetSort(value) {
  const allowed = new Set([
    'set_asc',
    'set_desc',
    'date_added_asc',
    'date_added_desc',
    'error_asc',
    'error_desc',
    'confidence_asc',
    'confidence_desc'
  ]);
  return allowed.has(String(value || '')) ? String(value) : 'date_added_desc';
}

const sortedUserDetectionItems = computed(() => {
  const filter = String(userDetFilterHasContact.value || 'all');
  const normalizedSort = normalizeUserDetSort(userDetSort.value);
  const items = [...(userDetectionItems.value || [])]
    .filter((item) => {
      if (filter === 'all') return true;
      const has = String(item?.hasContact || '').trim().toLowerCase() || 'unknown';
      if (filter === 'unknown') return has !== 'none' && has !== 'single' && has !== 'multiple';
      return has === filter;
    });

  const setRank = (v) => String(v || '').toLowerCase() === 'core' ? 0 : 1;
  const dateTs = (x) => {
    const t = Date.parse(String(x?.dateAdded || ''));
    return Number.isFinite(t) ? t : 0;
  };
  const conf = (x) => {
    const n = Number(x?.detectedConfidence);
    return Number.isFinite(n) ? n : -1;
  };
  const absErr = (x) => {
    const n = Number(x?.errorFrames);
    return Number.isFinite(n) ? Math.abs(n) : null;
  };

  items.sort((a, b) => {
    switch (normalizedSort) {
      case 'set_asc': {
        const d = setRank(a?.evaluationSet) - setRank(b?.evaluationSet);
        if (d !== 0) return d;
        return String(a?.id || '').localeCompare(String(b?.id || ''));
      }
      case 'set_desc': {
        const d = setRank(b?.evaluationSet) - setRank(a?.evaluationSet);
        if (d !== 0) return d;
        return String(a?.id || '').localeCompare(String(b?.id || ''));
      }
      case 'date_added_asc': {
        const d = dateTs(a) - dateTs(b);
        if (d !== 0) return d;
        return String(a?.id || '').localeCompare(String(b?.id || ''));
      }
      case 'date_added_desc': {
        const d = dateTs(b) - dateTs(a);
        if (d !== 0) return d;
        return String(a?.id || '').localeCompare(String(b?.id || ''));
      }
      case 'error_asc': {
        const ea = absErr(a);
        const eb = absErr(b);
        if (ea === null && eb !== null) return 1;
        if (ea !== null && eb === null) return -1;
        const d = Number(ea || 0) - Number(eb || 0);
        if (d !== 0) return d;
        return String(a?.id || '').localeCompare(String(b?.id || ''));
      }
      case 'error_desc': {
        const ea = absErr(a);
        const eb = absErr(b);
        if (ea === null && eb !== null) return 1;
        if (ea !== null && eb === null) return -1;
        const d = Number(eb || 0) - Number(ea || 0);
        if (d !== 0) return d;
        return String(a?.id || '').localeCompare(String(b?.id || ''));
      }
      case 'confidence_asc': {
        const d = conf(a) - conf(b);
        if (d !== 0) return d;
        return String(a?.id || '').localeCompare(String(b?.id || ''));
      }
      case 'confidence_desc':
      default: {
        const d = conf(b) - conf(a);
        if (d !== 0) return d;
        return String(a?.id || '').localeCompare(String(b?.id || ''));
      }
    }
  });
  return items;
});

function pageFromPath(pathname) {
  const p = String(pathname || '/').toLowerCase();
  if (p === '/lab' || p === '/diagnostics') return 'diagnostics';
  if (p === '/user-videos' || p === '/user-video-management') return 'user_videos';
  if (p === '/user-detection-lab' || p === '/user-detection') return 'user_detection';
  return 'compare';
}

function pathFromPage(page) {
  if (page === 'user_videos') return '/user-videos';
  if (page === 'user_detection') return '/user-detection-lab';
  return page === 'diagnostics' ? '/lab' : '/compare';
}

function normalizeProDiagSort(value) {
  const allowed = new Set([
    'set_asc',
    'set_desc',
    'date_added_asc',
    'date_added_desc',
    'error_asc',
    'error_desc',
    'confidence_asc',
    'confidence_desc'
  ]);
  return allowed.has(String(value)) ? String(value) : 'set_asc';
}

function normalizeFilterValue(value, allowed) {
  const v = String(value || 'all');
  return allowed.has(v) ? v : 'all';
}

function normalizeCameraAngleFilter(value) {
  const v = String(value || 'all').trim().toLowerCase();
  if (!v || v === 'all') return 'all';
  const allowed = new Set([
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
  return allowed.has(v) ? v : 'all';
}

function parseLabStateFromSearch(search) {
  const params = new URLSearchParams(String(search || ''));
  const handednessAllowed = new Set(['all', 'left', 'right']);
  const setAllowed = new Set(['all', 'core', 'edge']);
  const courtAllowed = new Set(['all', 'deuce', 'ad']);
  const resultAllowed = new Set(['all', 'good', 'medium', 'bad', 'na']);
  const gtAllowed = new Set(['all', 'set', 'not_set']);
  const player = normalizePlayerName(params.get('player') || '').toLowerCase() || 'all';
  return {
    sort: normalizeProDiagSort(params.get('sort')),
    handedness: normalizeFilterValue(params.get('handedness'), handednessAllowed),
    player,
    set: normalizeFilterValue(params.get('set'), setAllowed),
    courtSide: normalizeFilterValue(params.get('court'), courtAllowed),
    cameraAngle: normalizeCameraAngleFilter(params.get('angle')),
    result: normalizeFilterValue(params.get('result'), resultAllowed),
    groundTruth: normalizeFilterValue(params.get('gt'), gtAllowed)
  };
}

function buildUrlForState(page, state = {}) {
  const basePath = pathFromPage(page);
  if (page !== 'diagnostics') return basePath;
  const params = new URLSearchParams();
  const normalizedSort = normalizeProDiagSort(state.sort ?? proDiagSort.value);
  params.set('sort', normalizedSort);
  params.set('handedness', String(state.handedness ?? proDiagFilterHandedness.value));
  params.set('player', String(state.player ?? proDiagFilterPlayer.value));
  params.set('set', String(state.set ?? proDiagFilterSet.value));
  params.set('court', String(state.courtSide ?? proDiagFilterCourtSide.value));
  params.set('angle', String(state.cameraAngle ?? proDiagFilterCameraAngle.value));
  params.set('result', String(state.result ?? proDiagFilterResult.value));
  params.set('gt', String(state.groundTruth ?? proDiagFilterGroundTruth.value));
  return `${basePath}?${params.toString()}`;
}

function sharedToProTime(sharedTimeSec) {
  return sharedTimeSec + alignmentOffsetSec.value;
}

function sharedToAmateurTime(sharedTimeSec) {
  return sharedTimeSec;
}

function displayToSharedTime(displayTimeSec) {
  return displayTimeSec + timelineMinSeconds.value;
}

function formatTime(value) {
  const sec = Math.max(0, Number(value) || 0);
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(2).padStart(5, '0');
  return `${m}:${s}`;
}

function getErrorSeverityClass(absErrorMs) {
  const value = Number(absErrorMs);
  if (!Number.isFinite(value)) return 'metric-na';
  if (value <= 60) return 'metric-good';
  if (value <= 150) return 'metric-warn';
  return 'metric-bad';
}

function getFrameErrorSeverityClass(absErrorFrames) {
  if (absErrorFrames === null || absErrorFrames === undefined) return 'metric-na';
  const value = Number(absErrorFrames);
  if (!Number.isFinite(value)) return 'metric-na';
  if (value <= 2) return 'metric-good';
  if (value <= 5) return 'metric-warn';
  return 'metric-bad';
}

function hasDiagIssue(item) {
  if (!item) return true;
  if (item.error) return true;
  const analysis = item.analysis;
  if (!analysis) return true;
  if (analysis.trackingError) return true;
  if (!analysis.event?.found) return true;
  if (analysis.event?.reason) return true;
  return false;
}

function getClipQc(item) {
  return item?.analysis?.clipQc || item?.clipQc || null;
}

function buildDiagVideoSrc(item) {
  const rawBase = String(item?.videoPublicUrl || '').trim();
  if (!rawBase) return '';
  const base = encodeURI(rawBase);
  const token = String(item?.analysis?.clipQc?.checkedAt || item?.clipQc?.checkedAt || item?.dateAdded || '').trim();
  if (!token) return base;
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}v=${encodeURIComponent(token)}`;
}

function getDiagLazyVideoSrc(item) {
  if (!item?.id) return '';
  if (!isDiagLazyItemActive(item.id)) return '';
  return proDiagVideoSrc.value[item.id] || buildDiagVideoSrc(item);
}

function getClipQcStatusText(item) {
  const qc = getClipQc(item);
  if (!qc) return 'not available';
  const issues = Array.isArray(qc?.issues) ? qc.issues : [];
  if (!issues.length) return 'ok';
  const codes = issues.map((x) => String(x?.code || 'unknown')).join(', ');
  return `warnings (${issues.length}): ${codes}`;
}

function normalizePlayerName(raw) {
  return String(raw || '').trim().replace(/\s+/g, ' ');
}

function hasMissingPlayer(item) {
  return !normalizePlayerName(item?.playerName);
}

function hasMissingGroundTruth(item) {
  return !hasGroundTruthValue(item);
}

const editableCameraAngleOptions = [
  'behind_server',
  'behind_elevated',
  'behind_broadcast',
  'front_side_frontside',
  'front_side_backside',
  'side_frontside',
  'side_backside',
  'behind_side_frontside',
  'behind_side_backside'
];

function buildDiagEditDraft(item) {
  return {
    title: String(item?.title || '').trim(),
    strokeType: String(item?.strokeType || 'serve').trim().toLowerCase() || 'serve',
    evaluationSet: String(item?.evaluationSet || 'core').trim().toLowerCase() || 'core',
    cameraAngle: String(item?.cameraAngle || 'behind_server').trim().toLowerCase() || 'behind_server',
    courtSide: String(item?.courtSide || 'deuce').trim().toLowerCase() || 'deuce',
    groundTruthFrame: Number.isFinite(Number(proGroundTruthFrame.value[item?.id]))
      ? Math.round(Number(proGroundTruthFrame.value[item?.id]))
      : (Number.isFinite(Number(item?.groundTruthContactFrame))
          ? Math.round(Number(item.groundTruthContactFrame))
          : ''),
    lowFpsAmbiguous: Boolean(proGroundTruthLowFpsAmbiguous.value[item?.id] ?? item?.lowFpsAmbiguous)
  };
}

function startDiagEditMode(item) {
  if (!item?.id) return;
  proDiagEditDraft.value = {
    ...proDiagEditDraft.value,
    [item.id]: buildDiagEditDraft(item)
  };
  proDiagEditMode.value = {
    ...proDiagEditMode.value,
    [item.id]: true
  };
}

function toggleDiagEditMode(item) {
  if (!item?.id) return;
  activateDiagLazyItem(item.id, { pin: true });
  if (Boolean(proDiagEditMode.value[item.id])) {
    cancelDiagEditMode(item);
    return;
  }
  // Editing uses the standard layout; exit widescreen automatically.
  if (Boolean(proDiagCinemaMode.value[item.id])) {
    proDiagCinemaMode.value = {
      ...proDiagCinemaMode.value,
      [item.id]: false
    };
  }
  startDiagEditMode(item);
}

function cancelDiagEditMode(item) {
  if (!item?.id) return;
  const nextMode = { ...proDiagEditMode.value };
  const nextDraft = { ...proDiagEditDraft.value };
  delete nextMode[item.id];
  delete nextDraft[item.id];
  proDiagEditMode.value = nextMode;
  proDiagEditDraft.value = nextDraft;
}

async function saveDiagVideoEdits(item) {
  if (!item?.id) return;
  const draft = proDiagEditDraft.value[item.id];
  if (!draft) return;
  const title = String(draft.title || '').trim();
  if (!title) {
    proDiagnosticsError.value = `Invalid title for ${item.id}`;
    return;
  }

  const strokeType = String(draft.strokeType || '').trim().toLowerCase();
  const evaluationSet = String(draft.evaluationSet || '').trim().toLowerCase();
  const cameraAngle = String(draft.cameraAngle || '').trim().toLowerCase();
  const courtSide = String(draft.courtSide || '').trim().toLowerCase();
  const selected = String(proDiagPlayerSelection.value[item.id] || '__add_new__');
  const newName = normalizePlayerName(proDiagNewPlayerName.value[item.id]);
  const playerName = selected === '__add_new__' ? newName : normalizePlayerName(selected);
  const chosenNewHand = String(proDiagNewPlayerHandedness.value[item.id] || '').toLowerCase();
  const newHandedness = chosenNewHand === 'left' || chosenNewHand === 'right'
    ? chosenNewHand
    : String(item?.handedness || 'right').toLowerCase();
  const existingHandedness = getKnownPlayerHandedness(playerName) || String(item?.handedness || 'right').toLowerCase();
  const handedness = playerName ? (selected === '__add_new__' ? newHandedness : existingHandedness) : null;

  const gtRaw = String(draft.groundTruthFrame ?? '').trim();
  const hasGroundTruth = gtRaw !== '';
  const gtFrame = hasGroundTruth ? Math.round(Number(gtRaw)) : null;
  if (hasGroundTruth && (!Number.isFinite(gtFrame) || gtFrame < 0)) {
    proDiagnosticsError.value = `Invalid ground truth value for ${item.id}`;
    return;
  }

  proDiagEditBusy.value = { ...proDiagEditBusy.value, [item.id]: true };
  proDiagnosticsError.value = '';
  try {
    const videoRes = await fetch(`/api/debug/pro-videos/${encodeURIComponent(item.id)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        strokeType,
        evaluationSet,
        cameraAngle,
        courtSide,
        playerName: playerName || null,
        ...(handedness ? { handedness } : {})
      })
    });
    const videoData = await videoRes.json();
    if (!videoRes.ok || !videoData?.ok) {
      throw new Error(videoData?.message || videoData?.error || `Failed to save video attributes for ${item.id}`);
    }

    const fps = Number(item.analysis?.metadata?.fps || 60);
    const labelPayload = {
      lowFpsAmbiguous: Boolean(draft.lowFpsAmbiguous)
    };
    if (hasGroundTruth) {
      labelPayload.contactFrame = gtFrame;
      labelPayload.contactTimeMs = Math.round((gtFrame / Math.max(1, fps)) * 1000);
    }
    const gtRes = await fetch(`/api/debug/pro-labels/${encodeURIComponent(item.id)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(labelPayload)
    });
    const gtData = await gtRes.json();
    if (!gtRes.ok) {
      throw new Error(gtData?.message || gtData?.error || `Failed to save ground truth for ${item.id}`);
    }

    await fetchProDiagnostics(true);
    cancelDiagEditMode(item);
  } catch (e) {
    proDiagnosticsError.value = e.message;
  } finally {
    proDiagEditBusy.value = { ...proDiagEditBusy.value, [item.id]: false };
  }
}

async function copyDiagVideoId(item) {
  const id = String(item?.id || '').trim();
  if (!id) return;

  const showCopiedMessage = () => {
    copiedDiagVideoId.value = id;
    if (copiedDiagVideoTimer) clearTimeout(copiedDiagVideoTimer);
    copiedDiagVideoTimer = setTimeout(() => {
      if (copiedDiagVideoId.value === id) copiedDiagVideoId.value = '';
      copiedDiagVideoTimer = null;
    }, 2000);
  };

  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(id);
      showCopiedMessage();
      return;
    }
  } catch {
    // Fall through to legacy copy fallback.
  }

  try {
    const temp = document.createElement('textarea');
    temp.value = id;
    temp.setAttribute('readonly', '');
    temp.style.position = 'absolute';
    temp.style.left = '-9999px';
    document.body.appendChild(temp);
    temp.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(temp);
    if (ok) showCopiedMessage();
  } catch {
    // Clipboard may be blocked by browser permissions.
  }
}

function deriveKnownPlayers(items) {
  const byName = new Map();
  for (const item of items || []) {
    const name = normalizePlayerName(item?.playerName);
    if (!name) continue;
    const handedness = String(item?.handedness || '').trim().toLowerCase();
    if (!byName.has(name)) {
      byName.set(name, { name, leftCount: 0, rightCount: 0, latestHandedness: null });
    }
    const acc = byName.get(name);
    if (handedness === 'left') acc.leftCount += 1;
    if (handedness === 'right') acc.rightCount += 1;
    if (handedness === 'left' || handedness === 'right') acc.latestHandedness = handedness;
  }
  return Array.from(byName.values())
    .map((acc) => {
      let handedness = null;
      if (acc.leftCount > acc.rightCount) handedness = 'left';
      else if (acc.rightCount > acc.leftCount) handedness = 'right';
      else handedness = acc.latestHandedness;
      return { name: acc.name, handedness };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function getKnownPlayerHandedness(name) {
  const n = normalizePlayerName(name);
  if (!n) return null;
  const match = (knownPlayers.value || []).find((p) => normalizePlayerName(p?.name) === n);
  const h = String(match?.handedness || '').trim().toLowerCase();
  return (h === 'left' || h === 'right') ? h : null;
}

async function fetchPros() {
  const res = await fetch('/api/pro-videos');
  const data = await res.json();
  proVideos.value = data.items || [];
  if (!selectedPro.value && proVideos.value.length) {
    selectedPro.value = proVideos.value[0].id;
  }
  if (!selectedAmateurPro.value && proVideos.value.length > 1) {
    selectedAmateurPro.value = proVideos.value[1].id;
  } else if (!selectedAmateurPro.value && proVideos.value.length === 1) {
    selectedAmateurPro.value = proVideos.value[0].id;
  }
}

async function fetchSessions() {
  const res = await fetch('/api/sessions');
  const data = await res.json();
  currentGenerationVersion.value = data.currentGenerationVersion || currentGenerationVersion.value;
  sessions.value = data.items || [];
}

async function fetchUploads() {
  const res = await fetch('/api/uploads');
  const data = await res.json();
  uploads.value = data.items || [];
  if (!selectedExistingUpload.value && uploads.value.length) {
    selectedExistingUpload.value = uploads.value[0].fileName;
  }
}

async function fetchUserVideoEntries() {
  const res = await fetch('/api/user-videos');
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.message || data?.error || 'Failed to load user video entries');
  }
  const items = Array.isArray(data?.items) ? data.items : [];
  userVideoEntries.value = items;

  const validKeys = new Set();
  const nextActive = { ...userClipLazyActive.value };
  const nextPinned = { ...userClipLazyPinned.value };
  let preloadCount = 0;
  for (const entry of items) {
    for (const clip of (entry?.extractedClips || [])) {
      const key = userClipKey(entry?.id, clip?.id);
      validKeys.add(key);
      const shouldPreload = preloadCount < 1;
      if (shouldPreload) preloadCount += 1;
      nextActive[key] = Boolean(nextActive[key]) || shouldPreload;
      if (!(key in nextPinned)) {
        nextPinned[key] = false;
      }
    }
  }
  for (const key of Object.keys(nextActive)) {
    if (!validKeys.has(key)) delete nextActive[key];
  }
  for (const key of Object.keys(nextPinned)) {
    if (!validKeys.has(key)) delete nextPinned[key];
  }
  userClipLazyActive.value = nextActive;
  userClipLazyPinned.value = nextPinned;
}

async function fetchUserVideoJobs() {
  const res = await fetch('/api/user-videos/jobs');
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.message || data?.error || 'Failed to load user video jobs');
  }
  userVideoJobs.value = Array.isArray(data?.items) ? data.items : [];
}

async function fetchUserDetectionItems() {
  userDetectionLoading.value = true;
  userDetectionError.value = '';
  try {
    const res = await fetch('/api/debug/user-detection-clips');
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.message || data?.error || 'Failed to load user detection clips');
    }
    userDetectionItems.value = Array.isArray(data?.items) ? data.items : [];
    const items = userDetectionItems.value;
    const validKeys = new Set();
    const nextActive = { ...userDetLazyActive.value };
    const nextPinned = { ...userDetLazyPinned.value };
    let preloadCount = 0;
    for (const item of items) {
      const key = userDetKey(item);
      validKeys.add(key);
      const shouldPreload = preloadCount < 1;
      if (shouldPreload) preloadCount += 1;
      nextActive[key] = Boolean(nextActive[key]) || shouldPreload;
      if (!(key in nextPinned)) nextPinned[key] = false;
    }
    for (const key of Object.keys(nextActive)) {
      if (!validKeys.has(key)) delete nextActive[key];
    }
    for (const key of Object.keys(nextPinned)) {
      if (!validKeys.has(key)) delete nextPinned[key];
    }
    userDetLazyActive.value = nextActive;
    userDetLazyPinned.value = nextPinned;
    setTimeout(() => bootstrapUserDetLazyObserver(), 0);
  } catch (e) {
    userDetectionError.value = e.message;
  } finally {
    userDetectionLoading.value = false;
  }
}

function hasActiveUserVideoJobs() {
  return (userVideoJobs.value || []).some((j) => {
    const s = String(j?.status || '').toLowerCase();
    return s === 'queued' || s === 'running';
  });
}

function ensureUserVideoJobsPolling() {
  if (userVideoJobsPollTimer) return;
  userVideoJobsPollTimer = setInterval(async () => {
    if (activePage.value !== 'user_videos') return;
    try {
      await fetchUserVideoJobs();
      if (hasActiveUserVideoJobs()) {
        await fetchUserVideoEntries();
      }
    } catch {
      // best effort polling
    }
  }, 2000);
}

function stopUserVideoJobsPolling() {
  if (!userVideoJobsPollTimer) return;
  clearInterval(userVideoJobsPollTimer);
  userVideoJobsPollTimer = null;
}

function postFormWithUploadTiming(url, formData) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const startedAt = performance.now();
    let uploadDoneAt = null;
    xhr.open('POST', url);
    xhr.responseType = 'json';
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0 && e.loaded >= e.total) {
        uploadDoneAt = performance.now();
      }
    };
    xhr.onerror = () => reject(new Error('network_error'));
    xhr.onload = () => {
      const endedAt = performance.now();
      const responseBody = xhr.response && typeof xhr.response === 'object'
        ? xhr.response
        : (() => {
            try {
              return JSON.parse(String(xhr.responseText || '{}'));
            } catch {
              return {};
            }
          })();
      resolve({
        status: Number(xhr.status || 0),
        ok: xhr.status >= 200 && xhr.status < 300,
        body: responseBody,
        uploadMs: uploadDoneAt ? Math.max(0, Math.round(uploadDoneAt - startedAt)) : null,
        requestRoundTripMs: Math.max(0, Math.round(endedAt - startedAt))
      });
    };
    xhr.send(formData);
  });
}

function onUserVideoFileChange(e) {
  userVideoFile.value = e.target.files?.[0] || null;
  userVideoOriginalBytes.value = Number(userVideoFile.value?.size || 0);
  userVideoCompressedBytes.value = 0;
  userVideoCompressStatus.value = '';
  userVideoCompressProgress.value = null;
}

function formatBytes(bytes) {
  const b = Number(bytes || 0);
  if (!Number.isFinite(b) || b <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = b;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[idx]}`;
}

function supportsClientVideoCompression() {
  if (typeof window === 'undefined') return false;
  if (typeof MediaRecorder === 'undefined') return false;
  if (typeof document === 'undefined') return false;
  const c = document.createElement('canvas');
  if (!c || typeof c.captureStream !== 'function') return false;
  const v = document.createElement('video');
  if (!v || typeof v.play !== 'function') return false;
  return true;
}

function userClipKey(entryId, clipId) {
  return `${String(entryId || '')}:${String(clipId || '')}`;
}

function isUserClipLazyActive(key) {
  return Boolean(userClipLazyActive.value[String(key || '')]);
}

function activateUserClipLazyItem(key, options = {}) {
  const k = String(key || '');
  if (!k) return;
  if (options.pin === true && !userClipLazyPinned.value[k]) {
    userClipLazyPinned.value = {
      ...userClipLazyPinned.value,
      [k]: true
    };
  }
  if (userClipLazyActive.value[k]) return;
  userClipLazyActive.value = {
    ...userClipLazyActive.value,
    [k]: true
  };
}

function shouldKeepUserClipActive(key) {
  const k = String(key || '');
  if (!k) return false;
  if (Boolean(userClipLazyPinned.value[k])) return true;
  if (Boolean(userClipPlaying.value[k])) return true;
  return false;
}

function stopUserClipTimelineRafByKey(key) {
  const k = String(key || '');
  if (!k) return;
  const rafId = userClipRafIds.value[k];
  if (rafId) cancelAnimationFrame(rafId);
  userClipRafIds.value = { ...userClipRafIds.value, [k]: null };
}

function deactivateUserClipLazyItem(key) {
  const k = String(key || '');
  if (!k || !userClipLazyActive.value[k] || shouldKeepUserClipActive(k)) return;
  const el = userClipVideoEls.value[k];
  if (el) {
    try {
      el.pause();
      el.removeAttribute('src');
      el.load();
    } catch {
      // no-op
    }
  }
  stopUserClipTimelineRafByKey(k);
  userClipPlaying.value = { ...userClipPlaying.value, [k]: false };
  const nextActive = { ...userClipLazyActive.value };
  delete nextActive[k];
  userClipLazyActive.value = nextActive;
}

function setUserClipCardRef(key, el) {
  const k = String(key || '');
  if (!k) return;
  const prev = userClipCardEls.get(k);
  if (prev && prev !== el && userClipVisibilityObserver) {
    userClipVisibilityObserver.unobserve(prev);
  }
  if (el) {
    userClipCardEls.set(k, el);
    if (userClipVisibilityObserver) {
      userClipVisibilityObserver.observe(el);
    }
  } else {
    userClipCardEls.delete(k);
  }
}

function bootstrapUserClipLazyObserver() {
  if (typeof window === 'undefined' || typeof window.IntersectionObserver !== 'function') {
    return;
  }
  if (userClipVisibilityObserver) {
    userClipVisibilityObserver.disconnect();
  }
  userClipVisibilityObserver = new window.IntersectionObserver((entries) => {
    for (const entry of entries) {
      const key = String(entry.target?.dataset?.userClipKey || '').trim();
      if (!key) continue;
      if (entry.isIntersecting) {
        activateUserClipLazyItem(key);
      } else {
        deactivateUserClipLazyItem(key);
      }
    }
  }, {
    root: null,
    rootMargin: '140px 0px',
    threshold: 0.01
  });
  for (const [key, el] of userClipCardEls.entries()) {
    if (!el || isUserClipLazyActive(key)) continue;
    userClipVisibilityObserver.observe(el);
  }
}

function setUserClipVideoRef(key, el) {
  const next = el || null;
  if (userClipVideoEls.value[key] === next) return;
  if (next) {
    userClipVideoEls.value[key] = next;
  } else {
    delete userClipVideoEls.value[key];
  }
}

function getUserClipFps(entry) {
  const rawFps = Number(entry?.sourceFps || 30);
  if (!Number.isFinite(rawFps) || rawFps <= 0) return 30;
  // Many mobile exports are encoded at 120fps but contain far fewer unique images.
  // Use a practical stepping fps so one key press usually advances visible motion.
  if (rawFps >= 100) return 30;
  if (rawFps > 60) return 60;
  return rawFps;
}

function getUserClipDuration(key) {
  const el = userClipVideoEls.value[key];
  return Number(el?.duration || 0) || 0;
}

function getUserClipDetectedContactSec(clip) {
  const detectedSourceSec = Number(clip?.detectedContactSec);
  if (!Number.isFinite(detectedSourceSec)) return null;
  const clipStartSec = Number(clip?.clipStartSec || 0);
  const clipDurationSec = Number(clip?.clipDurationSec || 0);
  const relativeSec = detectedSourceSec - clipStartSec;
  if (!Number.isFinite(relativeSec)) return null;
  if (Number.isFinite(clipDurationSec) && clipDurationSec > 0) {
    return clamp(relativeSec, 0, clipDurationSec);
  }
  return Math.max(0, relativeSec);
}

function getUserClipDetectedFrame(entry, clip) {
  const fps = getUserClipFps(entry);
  const sec = getUserClipDetectedContactSec(clip);
  if (!Number.isFinite(sec)) return null;
  return Math.max(0, Math.round(sec * Math.max(1, fps)));
}

function getUserClipCurrentFrameDisplay(entry, key) {
  const fps = getUserClipFps(entry);
  const dur = getUserClipDuration(key);
  const maxFrame = Math.max(0, Math.round(dur * Math.max(1, fps)));
  const sec = Number(userClipTimes.value[key] || 0);
  return secondsToFrameIndex(sec, fps, maxFrame);
}

function getUserClipMaxFrameDisplay(entry, key) {
  const fps = getUserClipFps(entry);
  const dur = getUserClipDuration(key);
  const maxFrame = Math.max(0, Math.round(dur * Math.max(1, fps)));
  return maxFrame;
}

function getUserClipProgressRatio(key) {
  const dur = getUserClipDuration(key);
  if (!Number.isFinite(dur) || dur <= 0) return 0;
  return Math.max(0, Math.min(1, Number(userClipTimes.value[key] || 0) / dur));
}

function getUserClipVolumeValue(key) {
  const v = Number(userClipVolume.value[key]);
  if (!Number.isFinite(v)) return 0.8;
  return clamp(v, 0, 1);
}

function getUserClipMuted(key) {
  const m = userClipMuted.value[key];
  return typeof m === 'boolean' ? m : true;
}

function applyUserClipAudioState(key) {
  const el = userClipVideoEls.value[key];
  if (!el) return;
  el.volume = getUserClipVolumeValue(key);
  el.muted = getUserClipMuted(key);
}

function onUserClipLoaded(entry, clip) {
  const key = userClipKey(entry?.id, clip?.id);
  const el = userClipVideoEls.value[key];
  if (!el) return;
  const initSec = getUserClipDetectedContactSec(clip);
  const safeInitSec = Number.isFinite(initSec)
    ? clamp(initSec, 0, Number(el.duration || 0) || initSec)
    : 0;
  userClipTimes.value = {
    ...userClipTimes.value,
    [key]: safeInitSec
  };
  if (typeof userClipMuted.value[key] !== 'boolean') {
    userClipMuted.value = {
      ...userClipMuted.value,
      [key]: true
    };
  }
  if (!Number.isFinite(Number(userClipVolume.value[key]))) {
    userClipVolume.value = {
      ...userClipVolume.value,
      [key]: 0.8
    };
  }
  applyUserClipAudioState(key);
  userClipPlaying.value = {
    ...userClipPlaying.value,
    [key]: false
  };
  el.currentTime = safeInitSec;
}

function onUserClipTimeUpdate(entry, clip) {
  const key = userClipKey(entry?.id, clip?.id);
  const el = userClipVideoEls.value[key];
  if (!el) return;
  userClipTimes.value = {
    ...userClipTimes.value,
    [key]: Number(el.currentTime || 0)
  };
}

function startUserClipTimelineRaf(entry, clip) {
  const key = userClipKey(entry?.id, clip?.id);
  const existing = userClipRafIds.value[key];
  if (existing) cancelAnimationFrame(existing);

  const tick = () => {
    const el = userClipVideoEls.value[key];
    if (!el || el.paused) {
      userClipRafIds.value = { ...userClipRafIds.value, [key]: null };
      return;
    }
    userClipTimes.value = {
      ...userClipTimes.value,
      [key]: Number(el.currentTime || 0)
    };
    const rafId = requestAnimationFrame(tick);
    userClipRafIds.value = { ...userClipRafIds.value, [key]: rafId };
  };

  const rafId = requestAnimationFrame(tick);
  userClipRafIds.value = { ...userClipRafIds.value, [key]: rafId };
}

function stopUserClipTimelineRaf(entry, clip) {
  const key = userClipKey(entry?.id, clip?.id);
  stopUserClipTimelineRafByKey(key);
}

function onUserClipPlay(entry, clip) {
  const key = userClipKey(entry?.id, clip?.id);
  userClipPlaying.value = { ...userClipPlaying.value, [key]: true };
  startUserClipTimelineRaf(entry, clip);
}

function onUserClipPause(entry, clip) {
  const key = userClipKey(entry?.id, clip?.id);
  userClipPlaying.value = { ...userClipPlaying.value, [key]: false };
  stopUserClipTimelineRaf(entry, clip);
}

async function toggleUserClipPlay(entry, clip) {
  const key = userClipKey(entry?.id, clip?.id);
  const el = userClipVideoEls.value[key];
  if (!el) return;
  if (el.paused) {
    try {
      applyUserClipAudioState(key);
      await el.play();
    } catch {
      userClipPlaying.value = { ...userClipPlaying.value, [key]: false };
    }
  } else {
    el.pause();
  }
}

function toggleUserClipMute(entry, clip) {
  const key = userClipKey(entry?.id, clip?.id);
  userClipMuted.value = {
    ...userClipMuted.value,
    [key]: !getUserClipMuted(key)
  };
  applyUserClipAudioState(key);
}

function onUserClipVolumeInput(entry, clip, e) {
  const key = userClipKey(entry?.id, clip?.id);
  const value = clamp(Number(e.target.value || 0), 0, 1);
  userClipVolume.value = {
    ...userClipVolume.value,
    [key]: value
  };
  userClipMuted.value = {
    ...userClipMuted.value,
    [key]: value <= 0.0001
  };
  applyUserClipAudioState(key);
}

function onUserClipScrub(entry, clip, e) {
  const key = userClipKey(entry?.id, clip?.id);
  const el = userClipVideoEls.value[key];
  if (!el) return;
  const value = Number(e.target.value || 0);
  const fps = getUserClipFps(entry);
  const dur = getUserClipDuration(key);
  const maxFrame = Math.max(0, Math.round(dur * Math.max(1, fps)));
  const frame = nearestFrameIndex(value, fps, maxFrame);
  const snappedSec = clamp(frame / Math.max(1, fps), 0, dur);
  userClipTimes.value = {
    ...userClipTimes.value,
    [key]: snappedSec
  };
  el.currentTime = frameToSecondsForSeek(frame, fps);
  el.pause();
}

function stepUserClipFrame(entry, clip, direction) {
  const key = userClipKey(entry?.id, clip?.id);
  const el = userClipVideoEls.value[key];
  if (!el) return;
  const fps = getUserClipFps(entry);
  const dur = getUserClipDuration(key);
  const maxFrame = Math.max(0, Math.round(dur * Math.max(1, fps)));
  const currentFrame = secondsToFrameIndex(Number(el.currentTime || 0), fps, maxFrame);
  const nextFrame = Math.max(0, Math.min(maxFrame, currentFrame + Math.sign(direction)));
  const seekSec = frameToSecondsForSeek(nextFrame, fps);
  userClipTimes.value = {
    ...userClipTimes.value,
    [key]: nextFrame / Math.max(1, fps)
  };
  el.currentTime = seekSec;
  el.pause();
}

function userDetKey(item) {
  return String(item?.id || '');
}

function isUserDetLazyActive(id) {
  return Boolean(userDetLazyActive.value[String(id || '')]);
}

function shouldKeepUserDetActive(id) {
  const key = String(id || '');
  if (!key) return false;
  if (Boolean(userDetLazyPinned.value[key])) return true;
  if (Boolean(userDetPlaying.value[key])) return true;
  return false;
}

function activateUserDetLazyItem(id, options = {}) {
  const key = String(id || '');
  if (!key) return;
  if (options.pin === true && !userDetLazyPinned.value[key]) {
    userDetLazyPinned.value = {
      ...userDetLazyPinned.value,
      [key]: true
    };
  }
  if (userDetLazyActive.value[key]) return;
  userDetLazyActive.value = {
    ...userDetLazyActive.value,
    [key]: true
  };
}

function deactivateUserDetLazyItem(id) {
  const key = String(id || '');
  if (!key || !userDetLazyActive.value[key] || shouldKeepUserDetActive(key)) return;
  const el = userDetVideoEls.value[key];
  if (el) {
    try {
      el.pause();
      el.removeAttribute('src');
      el.load();
    } catch {
      // no-op
    }
  }
  const rafId = userDetRafIds.value[key];
  if (rafId) cancelAnimationFrame(rafId);
  userDetRafIds.value[key] = null;
  userDetPlaying.value[key] = false;
  if (userDetTracks.value[key]) {
    const nextTracks = { ...userDetTracks.value };
    delete nextTracks[key];
    userDetTracks.value = nextTracks;
  }
  if (userDetOverlayStats.value[key]) {
    const nextStats = { ...userDetOverlayStats.value };
    delete nextStats[key];
    userDetOverlayStats.value = nextStats;
  }
  const nextActive = { ...userDetLazyActive.value };
  delete nextActive[key];
  userDetLazyActive.value = nextActive;
}

function setUserDetCardRef(id, el) {
  const key = String(id || '');
  if (!key) return;
  const prev = userDetCardEls.get(key);
  if (prev && prev !== el && userDetVisibilityObserver) {
    userDetVisibilityObserver.unobserve(prev);
  }
  if (el) {
    userDetCardEls.set(key, el);
    if (userDetVisibilityObserver) {
      userDetVisibilityObserver.observe(el);
    }
  } else {
    userDetCardEls.delete(key);
  }
}

function bootstrapUserDetLazyObserver() {
  if (typeof window === 'undefined' || typeof window.IntersectionObserver !== 'function') {
    return;
  }
  if (userDetVisibilityObserver) {
    userDetVisibilityObserver.disconnect();
  }
  userDetVisibilityObserver = new window.IntersectionObserver((entries) => {
    for (const entry of entries) {
      const id = String(entry.target?.dataset?.userDetId || '').trim();
      if (!id) continue;
      if (entry.isIntersecting) {
        activateUserDetLazyItem(id);
      } else {
        deactivateUserDetLazyItem(id);
      }
    }
  }, {
    root: null,
    rootMargin: '140px 0px',
    threshold: 0.01
  });
  for (const [id, el] of userDetCardEls.entries()) {
    if (!el || isUserDetLazyActive(id)) continue;
    userDetVisibilityObserver.observe(el);
  }
}

function getUserDetStepFps(item) {
  const rawFps = Number(item?.fps || 30);
  if (!Number.isFinite(rawFps) || rawFps <= 0) return 30;
  if (rawFps >= 100) return 30;
  if (rawFps > 60) return 60;
  return rawFps;
}

function getUserDetDuration(item) {
  const key = userDetKey(item);
  const el = userDetVideoEls.value[key];
  const fromVideo = Number(el?.duration || 0);
  if (Number.isFinite(fromVideo) && fromVideo > 0) return fromVideo;
  const fromItem = Number(item?.clipDurationSec || 0);
  return Number.isFinite(fromItem) ? Math.max(0, fromItem) : 0;
}

function getUserDetCurrentFrameDisplay(item) {
  const key = userDetKey(item);
  const fps = getUserDetStepFps(item);
  const dur = getUserDetDuration(item);
  const maxFrame = Math.max(0, Math.round(dur * Math.max(1, fps)));
  const sec = Number(userDetTimes.value[key] || 0);
  return secondsToFrameIndex(sec, fps, maxFrame);
}

function getUserDetMaxFrameDisplay(item) {
  const fps = getUserDetStepFps(item);
  const dur = getUserDetDuration(item);
  return Math.max(0, Math.round(dur * Math.max(1, fps)));
}

function getUserDetProgressRatio(item) {
  const key = userDetKey(item);
  const dur = getUserDetDuration(item);
  if (!Number.isFinite(dur) || dur <= 0) return 0;
  return Math.max(0, Math.min(1, Number(userDetTimes.value[key] || 0) / dur));
}

function setUserDetVideoRef(id, el) {
  const key = String(id || '');
  if (!key) return;
  const next = el || null;
  if (userDetVideoEls.value[key] === next) return;
  if (next) userDetVideoEls.value[key] = next;
  else delete userDetVideoEls.value[key];
}

function setUserDetCanvasRef(id, el) {
  const key = String(id || '');
  if (!key) return;
  if (el) userDetCanvasEls.value[key] = el;
  else delete userDetCanvasEls.value[key];
}

function getUserDetVolumeValue(item) {
  const key = userDetKey(item);
  const v = Number(userDetVolume.value[key]);
  if (!Number.isFinite(v)) return 0.8;
  return clamp(v, 0, 1);
}

function getUserDetMuted(item) {
  const key = userDetKey(item);
  const m = userDetMuted.value[key];
  return typeof m === 'boolean' ? m : true;
}

function applyUserDetAudioState(item) {
  const key = userDetKey(item);
  const el = userDetVideoEls.value[key];
  if (!el) return;
  el.volume = getUserDetVolumeValue(item);
  el.muted = getUserDetMuted(item);
}

function getUserDetOverlayPrefs(id) {
  return userDetOverlayPrefs.value[id] || { video: true, ball: false, racket: false, pose: false };
}

function getUserDetDetectedSec(item) {
  const sec = Number(item?.detectedContactSec);
  if (!Number.isFinite(sec)) return null;
  return Math.max(0, sec);
}

function getUserDetDetectedFrame(item) {
  const sec = getUserDetDetectedSec(item);
  if (!Number.isFinite(sec)) return null;
  const fps = getUserDetStepFps(item);
  return Math.max(0, Math.round(sec * Math.max(1, fps)));
}

function hasUserDetGroundTruth(item) {
  const raw = item?.groundTruthFrame;
  if (raw === null || raw === undefined || raw === '') return false;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0;
}

function getUserDetGroundTruthFrame(item) {
  if (!hasUserDetGroundTruth(item)) return null;
  return Math.round(Number(item.groundTruthFrame));
}

async function fetchUserDetTracks(item) {
  const key = userDetKey(item);
  if (!key || userDetTracks.value[key] || userDetTracksBusy.value[key]) return;
  userDetTracksBusy.value[key] = true;
  try {
    const res = await fetch(`/api/debug/user-tracks/${encodeURIComponent(item.entryId)}/${encodeURIComponent(item.clipId)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data?.message || data?.error || `Failed loading tracks for ${key}`);
    userDetTracks.value = { ...userDetTracks.value, [key]: data };
    drawUserDetOverlay(item);
  } catch (e) {
    userDetectionError.value = e.message;
  } finally {
    userDetTracksBusy.value[key] = false;
  }
}

function drawUserDetOverlay(item) {
  const key = userDetKey(item);
  if (!key) return;
  const canvas = userDetCanvasEls.value[key];
  const video = userDetVideoEls.value[key];
  if (!canvas || !video) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const w = Math.max(1, Math.round(video.clientWidth));
  const h = Math.max(1, Math.round(video.clientHeight));
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const canvasParent = canvas.offsetParent || canvas.parentElement;
  if (canvasParent) {
    const parentRect = canvasParent.getBoundingClientRect();
    const videoRect = video.getBoundingClientRect();
    const left = Math.max(0, videoRect.left - parentRect.left);
    const top = Math.max(0, videoRect.top - parentRect.top);
    canvas.style.left = `${left}px`;
    canvas.style.top = `${top}px`;
  } else {
    canvas.style.left = '0px';
    canvas.style.top = '0px';
  }
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const trackPayload = userDetTracks.value[key];
  const tracks = trackPayload?.tracks;
  const prefs = getUserDetOverlayPrefs(key);
  const needsTracks = Boolean(prefs.ball || prefs.racket || prefs.pose);
  if (!needsTracks) {
    return;
  }
  if (!tracks) return;

  const metaW = Number(video.videoWidth || trackPayload?.metadata?.width || 1280);
  const metaH = Number(video.videoHeight || trackPayload?.metadata?.height || 720);
  const displayFps = getUserDetStepFps(item);
  const displayDur = getUserDetDuration(item);
  const displayMaxFrame = Math.max(0, Math.round(displayDur * Math.max(1, displayFps)));
  const displayFrame = secondsToFrameIndex(video.currentTime, displayFps, displayMaxFrame);
  const trackMaxFrame = getFrameUpperBoundFromTracks(tracks);
  let frame = displayFrame;
  if (trackMaxFrame >= 0) {
    if (displayMaxFrame > 0 && trackMaxFrame !== displayMaxFrame) {
      const ratio = clamp(displayFrame / Math.max(1, displayMaxFrame), 0, 1);
      frame = Math.round(ratio * trackMaxFrame);
    } else {
      frame = Math.min(displayFrame, trackMaxFrame);
    }
  }
  const ball = tracks.ballTrack?.[frame] || null;
  const racket = tracks.racketTrack?.[frame] || null;
  const poseFrame = tracks.poseTrack?.[frame] || null;
  const poseLandmarks = Array.isArray(poseFrame?.landmarks) ? poseFrame.landmarks : null;
  userDetOverlayStats.value[key] = { frame, displayFrame };

  const sx = w / Math.max(1, metaW);
  const sy = h / Math.max(1, metaH);
  const bx = ball ? ball.x * sx : null;
  const by = ball ? ball.y * sy : null;
  const rx = racket ? racket.x * sx : null;
  const ry = racket ? racket.y * sy : null;
  if (prefs.pose && poseLandmarks) {
    ctx.strokeStyle = 'rgba(255, 95, 95, 0.82)';
    ctx.lineWidth = 2;
    for (const [a, b] of DIAG_POSE_CONNECTIONS) {
      const la = poseLandmarks[a];
      const lb = poseLandmarks[b];
      if (!la || !lb) continue;
      if (Number(la.v) < 0.35 || Number(lb.v) < 0.35) continue;
      ctx.beginPath();
      ctx.moveTo(la.x * sx, la.y * sy);
      ctx.lineTo(lb.x * sx, lb.y * sy);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255, 95, 95, 0.95)';
    for (const idx of DIAG_POSE_DOT_INDICES) {
      const p = poseLandmarks[idx];
      if (!p || Number(p.v) < 0.55) continue;
      ctx.beginPath();
      ctx.arc(p.x * sx, p.y * sy, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (prefs.ball && prefs.racket && ball && racket) {
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(rx, ry);
    ctx.stroke();
  }

  if (prefs.ball && ball) {
    ctx.fillStyle = '#ffd24a';
    ctx.beginPath();
    ctx.arc(bx, by, 6, 0, Math.PI * 2);
    ctx.fill();
  }

  if (prefs.racket && racket) {
    ctx.fillStyle = '#6ef0a6';
    ctx.beginPath();
    ctx.arc(rx, ry, 6, 0, Math.PI * 2);
    ctx.fill();
  }
}

function onUserDetLoaded(item) {
  const key = userDetKey(item);
  const el = userDetVideoEls.value[key];
  if (!el) return;
  const initSec = getUserDetDetectedSec(item);
  userDetTimes.value[key] = initSec;
  userDetPlaying.value[key] = false;
  if (typeof userDetMuted.value[key] !== 'boolean') {
    userDetMuted.value = { ...userDetMuted.value, [key]: true };
  }
  if (!Number.isFinite(Number(userDetVolume.value[key]))) {
    userDetVolume.value = { ...userDetVolume.value, [key]: 0.8 };
  }
  if (!Object.prototype.hasOwnProperty.call(userDetGroundTruthInput.value, key)) {
    userDetGroundTruthInput.value = {
      ...userDetGroundTruthInput.value,
      [key]: Number.isFinite(Number(item.groundTruthFrame)) ? String(Math.round(Number(item.groundTruthFrame))) : ''
    };
  }
  if (!Object.prototype.hasOwnProperty.call(userDetHasContactInput.value, key)) {
    const hasContact = String(item?.hasContact || '').trim().toLowerCase();
    userDetHasContactInput.value = {
      ...userDetHasContactInput.value,
      [key]: (hasContact === 'none' || hasContact === 'single' || hasContact === 'multiple') ? hasContact : 'unknown'
    };
  }
  applyUserDetAudioState(item);
  requestUserDetSeek(item, initSec, { pauseAfter: true });
}

function onUserDetTimeUpdate(item) {
  const key = userDetKey(item);
  const el = userDetVideoEls.value[key];
  if (!el) return;
  userDetTimes.value[key] = Number(el.currentTime || 0);
  if (!el.paused) return;
  drawUserDetOverlay(item);
}

function getUserDetSeekState(id) {
  const key = String(id || '');
  const existing = userDetSeekStates.value[key];
  if (existing) return existing;
  const created = {
    inFlight: false,
    token: 0,
    timeoutId: null,
    pendingSec: null,
    pendingPause: false
  };
  userDetSeekStates.value[key] = created;
  return created;
}

function finishUserDetSeek(item, token) {
  const key = userDetKey(item);
  if (!key) return;
  const state = getUserDetSeekState(key);
  if (state.token !== token) return;
  if (state.timeoutId) {
    clearTimeout(state.timeoutId);
    state.timeoutId = null;
  }
  state.inFlight = false;
  const pendingSec = state.pendingSec;
  const pendingPause = Boolean(state.pendingPause);
  state.pendingSec = null;
  state.pendingPause = false;
  if (Number.isFinite(pendingSec)) {
    requestUserDetSeek(item, pendingSec, { pauseAfter: pendingPause });
  }
}

function requestUserDetSeek(item, sec, { pauseAfter = true } = {}) {
  const key = userDetKey(item);
  if (!key) return;
  const el = userDetVideoEls.value[key];
  if (!el) return;
  const targetSec = Math.max(0, Number(sec) || 0);
  const state = getUserDetSeekState(key);

  if (state.inFlight) {
    state.pendingSec = targetSec;
    state.pendingPause = Boolean(state.pendingPause || pauseAfter);
    return;
  }

  state.inFlight = true;
  state.token += 1;
  const token = state.token;
  if (state.timeoutId) {
    clearTimeout(state.timeoutId);
    state.timeoutId = null;
  }
  if (pauseAfter) {
    el.pause();
  }

  try {
    if (typeof el.fastSeek === 'function') {
      el.fastSeek(targetSec);
    } else {
      el.currentTime = targetSec;
    }
  } catch {
    try {
      el.currentTime = targetSec;
    } catch {
      finishUserDetSeek(item, token);
      return;
    }
  }

  state.timeoutId = setTimeout(() => {
    finishUserDetSeek(item, token);
  }, 220);
}

function onUserDetSeeked(item) {
  onUserDetTimeUpdate(item);
  const key = userDetKey(item);
  if (!key) return;
  const state = getUserDetSeekState(key);
  if (state.inFlight) {
    finishUserDetSeek(item, state.token);
  }
}

function startUserDetRaf(item) {
  const key = userDetKey(item);
  const existing = userDetRafIds.value[key];
  if (existing) cancelAnimationFrame(existing);
  const tick = () => {
    const el = userDetVideoEls.value[key];
    if (!el || el.paused) {
      userDetRafIds.value[key] = null;
      return;
    }
    userDetTimes.value[key] = Number(el.currentTime || 0);
    drawUserDetOverlay(item);
    const rafId = requestAnimationFrame(tick);
    userDetRafIds.value[key] = rafId;
  };
  const rafId = requestAnimationFrame(tick);
  userDetRafIds.value[key] = rafId;
}

function stopUserDetRaf(item) {
  const key = userDetKey(item);
  const rafId = userDetRafIds.value[key];
  if (rafId) cancelAnimationFrame(rafId);
  userDetRafIds.value[key] = null;
}

function onUserDetPlay(item) {
  const key = userDetKey(item);
  userDetPlaying.value[key] = true;
  startUserDetRaf(item);
}

function onUserDetPause(item) {
  const key = userDetKey(item);
  userDetPlaying.value[key] = false;
  stopUserDetRaf(item);
}

async function toggleUserDetPlay(item) {
  const key = userDetKey(item);
  const el = userDetVideoEls.value[key];
  if (!el) return;
  if (el.paused) {
    try {
      applyUserDetAudioState(item);
      await el.play();
    } catch {
      userDetPlaying.value[key] = false;
    }
  } else {
    el.pause();
  }
}

function toggleUserDetMute(item) {
  const key = userDetKey(item);
  userDetMuted.value = { ...userDetMuted.value, [key]: !getUserDetMuted(item) };
  applyUserDetAudioState(item);
}

function onUserDetVolumeInput(item, e) {
  const key = userDetKey(item);
  const value = clamp(Number(e.target.value || 0), 0, 1);
  userDetVolume.value = { ...userDetVolume.value, [key]: value };
  userDetMuted.value = { ...userDetMuted.value, [key]: value <= 0.0001 };
  applyUserDetAudioState(item);
}

function onUserDetScrub(item, e) {
  const key = userDetKey(item);
  const el = userDetVideoEls.value[key];
  if (!el) return;
  const value = Number(e.target.value || 0);
  const fps = getUserDetStepFps(item);
  const dur = getUserDetDuration(item);
  const maxFrame = Math.max(0, Math.round(dur * Math.max(1, fps)));
  const frame = nearestFrameIndex(value, fps, maxFrame);
  const snappedSec = clamp(frame / Math.max(1, fps), 0, dur);
  userDetTimes.value[key] = snappedSec;
  requestUserDetSeek(item, frameToSecondsForSeek(frame, fps), { pauseAfter: true });
  drawUserDetOverlay(item);
}

function stepUserDetFrame(item, direction) {
  const key = userDetKey(item);
  const el = userDetVideoEls.value[key];
  if (!el) return;
  const fps = getUserDetStepFps(item);
  const dur = getUserDetDuration(item);
  const maxFrame = Math.max(0, Math.round(dur * Math.max(1, fps)));
  const currentFrame = secondsToFrameIndex(Number(el.currentTime || 0), fps, maxFrame);
  const nextFrame = Math.max(0, Math.min(maxFrame, currentFrame + Math.sign(direction)));
  userDetTimes.value[key] = nextFrame / Math.max(1, fps);
  requestUserDetSeek(item, frameToSecondsForSeek(nextFrame, fps), { pauseAfter: true });
  drawUserDetOverlay(item);
}

function toggleUserDetOverlay(item, part) {
  const key = userDetKey(item);
  const curr = getUserDetOverlayPrefs(key);
  const nextValue = !curr[part];
  userDetOverlayPrefs.value = {
    ...userDetOverlayPrefs.value,
    [key]: { ...curr, [part]: nextValue }
  };
  if (part !== 'video' && nextValue) {
    fetchUserDetTracks(item);
  }
  drawUserDetOverlay(item);
}

function setUserDetGroundTruthFromCurrent(item) {
  const key = userDetKey(item);
  const fps = getUserDetStepFps(item);
  const displayedFrame = Number(userDetOverlayStats.value[key]?.frame);
  const el = userDetVideoEls.value[key];
  const fallbackSec = Number(el?.currentTime ?? userDetTimes.value[key] ?? 0);
  const frame = Number.isFinite(displayedFrame)
    ? Math.max(0, Math.round(displayedFrame))
    : secondsToFrameIndex(fallbackSec, fps);
  userDetGroundTruthInput.value = { ...userDetGroundTruthInput.value, [key]: String(frame) };
}

function getUserDetAbsError(item) {
  const gt = getUserDetGroundTruthFrame(item);
  const det = getUserDetDetectedFrame(item);
  if (!Number.isFinite(gt) || !Number.isFinite(det)) return null;
  return Math.abs(det - gt);
}

async function saveUserDetLabel(item) {
  const key = userDetKey(item);
  const gtRaw = String(userDetGroundTruthInput.value[key] || '').trim();
  const payload = {};
  const hasContactSelection = String(userDetHasContactInput.value[key] || 'unknown');
  if (hasContactSelection === 'none' || hasContactSelection === 'single' || hasContactSelection === 'multiple') {
    payload.hasContact = hasContactSelection;
  }
  if (hasContactSelection === 'single' || hasContactSelection === 'multiple') {
    if (gtRaw) {
      const gt = Number(gtRaw);
      if (!Number.isFinite(gt) || gt < 0) {
        userDetectionError.value = 'Ground truth frame must be a non-negative number.';
        return;
      }
      payload.groundTruthFrame = Math.round(gt);
    }
  }
  if (!Object.keys(payload).length) {
    userDetectionError.value = 'Nothing to save.';
    return;
  }
  userDetSaveBusy.value = { ...userDetSaveBusy.value, [key]: true };
  userDetectionError.value = '';
  try {
    const res = await fetch(`/api/debug/user-clip-labels/${encodeURIComponent(item.entryId)}/${encodeURIComponent(item.clipId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.message || data?.error || 'Save failed');
    userDetectionItems.value = (userDetectionItems.value || []).map((x) => {
      if (x.id !== item.id) return x;
      const gt = Number(data?.label?.groundTruthFrame);
      const nextGt = Number.isFinite(gt) ? Math.round(gt) : x.groundTruthFrame;
      const det = Number(x.detectedFrame);
      const errorFrames = Number.isFinite(det) && Number.isFinite(nextGt) ? Math.round(det) - Math.round(nextGt) : null;
      return {
        ...x,
        groundTruthFrame: Number.isFinite(nextGt) ? nextGt : null,
        hasContact: ['none', 'single', 'multiple'].includes(String(data?.label?.hasContact || ''))
          ? String(data.label.hasContact)
          : x.hasContact,
        labelUpdatedAt: data?.label?.updatedAt || x.labelUpdatedAt,
        errorFrames
      };
    });
  } catch (e) {
    userDetectionError.value = e.message;
  } finally {
    userDetSaveBusy.value = { ...userDetSaveBusy.value, [key]: false };
  }
}

function pickMediaRecorderMimeType() {
  const list = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm'
  ];
  for (const mime of list) {
    if (typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }
  return '';
}

function waitForEventOnce(target, eventName) {
  return new Promise((resolve, reject) => {
    const onOk = () => {
      cleanup();
      resolve();
    };
    const onErr = () => {
      cleanup();
      reject(new Error(`video_event_failed:${eventName}`));
    };
    const cleanup = () => {
      target.removeEventListener(eventName, onOk);
      target.removeEventListener('error', onErr);
    };
    target.addEventListener(eventName, onOk, { once: true });
    target.addEventListener('error', onErr, { once: true });
  });
}

async function compressVideoClientSide(file, { maxHeight = 720, targetFps = 30, videoBitsPerSecond = 2200000, onProgress = null } = {}) {
  if (!supportsClientVideoCompression()) throw new Error('client_video_compression_not_supported');
  const mimeType = pickMediaRecorderMimeType();
  if (!mimeType) throw new Error('no_supported_mediarecorder_codec');

  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  const objectUrl = URL.createObjectURL(file);
  video.src = objectUrl;

  try {
    await waitForEventOnce(video, 'loadedmetadata');
    const srcW = Math.max(2, Number(video.videoWidth || 0));
    const srcH = Math.max(2, Number(video.videoHeight || 0));
    const scale = Math.min(1, Math.max(1e-3, maxHeight / srcH));
    const targetW = Math.max(2, Math.round((srcW * scale) / 2) * 2);
    const targetH = Math.max(2, Math.round((srcH * scale) / 2) * 2);

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('canvas_context_unavailable');

    const canvasStream = canvas.captureStream(Math.max(12, Math.min(30, Math.round(targetFps))));
    const sourceStream = typeof video.captureStream === 'function' ? video.captureStream() : null;
    const audioTracks = sourceStream ? sourceStream.getAudioTracks() : [];
    const outTracks = [...canvasStream.getVideoTracks(), ...audioTracks];
    const outStream = new MediaStream(outTracks);
    const chunks = [];

    const recorder = new MediaRecorder(outStream, {
      mimeType,
      videoBitsPerSecond: Math.max(500_000, Math.round(videoBitsPerSecond))
    });

    let rafId = null;
    let stopped = false;
    const duration = Math.max(0.001, Number(video.duration || 0));
    const draw = () => {
      if (stopped) return;
      ctx.drawImage(video, 0, 0, targetW, targetH);
      if (typeof onProgress === 'function') {
        const p = Math.max(0, Math.min(1, Number(video.currentTime || 0) / duration));
        onProgress(p);
      }
      rafId = requestAnimationFrame(draw);
    };

    recorder.ondataavailable = (e) => {
      if (e?.data && e.data.size > 0) chunks.push(e.data);
    };

    const stoppedPromise = new Promise((resolve, reject) => {
      recorder.onstop = () => resolve();
      recorder.onerror = () => reject(new Error('media_recorder_failed'));
    });

    recorder.start(300);
    await video.play();
    draw();
    await waitForEventOnce(video, 'ended');
    stopped = true;
    if (rafId) cancelAnimationFrame(rafId);
    recorder.stop();
    await stoppedPromise;
    if (typeof onProgress === 'function') onProgress(1);

    for (const tr of outStream.getTracks()) tr.stop();
    const blob = new Blob(chunks, { type: mimeType });
    return { blob, mimeType, width: targetW, height: targetH };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function submitUserVideoScan() {
  userVideoError.value = '';
  userVideoInfo.value = '';
  if (!userVideoFile.value) {
    userVideoError.value = 'Please choose a video file.';
    return;
  }
  const compressionRequested = Boolean(userVideoCompressEnabled.value);
  const compressionPossible = supportsClientVideoCompression();
  const timing = {
    compressionMs: null,
    uploadMs: null
  };
  userVideoBusy.value = true;
  userVideoCompressStatus.value = '';
  userVideoCompressProgress.value = null;
  userVideoCompressedBytes.value = 0;
  try {
    let fileToUpload = userVideoFile.value;
    if (compressionRequested && compressionPossible) {
      const t0 = performance.now();
      userVideoCompressStatus.value = 'Compressing locally before upload...';
      userVideoCompressProgress.value = 0;
      const compressed = await compressVideoClientSide(userVideoFile.value, {
        maxHeight: 720,
        targetFps: 30,
        videoBitsPerSecond: 2200000,
        onProgress: (p) => {
          userVideoCompressProgress.value = Math.max(0, Math.min(1, Number(p || 0)));
        }
      });
      const outNameBase = String(userVideoFile.value.name || 'upload').replace(/\.[^.]+$/, '');
      fileToUpload = new File([compressed.blob], `${outNameBase}.webm`, {
        type: compressed.mimeType || 'video/webm',
        lastModified: Date.now()
      });
      timing.compressionMs = Math.round(performance.now() - t0);
      userVideoCompressedBytes.value = Number(fileToUpload.size || 0);
      userVideoCompressStatus.value = `Compression done (${formatBytes(userVideoOriginalBytes.value)} -> ${formatBytes(userVideoCompressedBytes.value)}). Uploading...`;
    } else if (compressionRequested && !compressionPossible) {
      userVideoCompressStatus.value = 'Client compression not supported in this browser. Uploading original file.';
    }

    const form = new FormData();
    form.append('video', fileToUpload);
    form.append('clientMetrics', JSON.stringify({
      compressionMs: timing.compressionMs,
      compressionEnabled: compressionRequested,
      originalBytes: Number(userVideoOriginalBytes.value || 0),
      compressedBytes: Number(fileToUpload.size || 0)
    }));
    const req = await postFormWithUploadTiming('/api/user-videos/scan-upload', form);
    timing.uploadMs = Number.isFinite(req.uploadMs) ? req.uploadMs : null;
    const data = req.body || {};
    if (!req.ok || !data?.ok) {
      throw new Error(data?.message || data?.error || 'User video scan failed');
    }
    const job = data?.job || null;
    if (job?.jobId) {
      userVideoJobs.value = [job, ...(userVideoJobs.value || []).filter((x) => x?.jobId !== job.jobId)];
      userVideoInfo.value = `Upload finished. Processing started in background (job ${job.jobId.slice(0, 8)}).`;
    } else {
      userVideoInfo.value = 'Upload finished. Processing started in background.';
    }
    userVideoFile.value = null;
    userVideoCompressStatus.value = '';
    userVideoCompressProgress.value = null;
    userVideoOriginalBytes.value = 0;
    userVideoCompressedBytes.value = 0;
    await Promise.all([fetchUploads(), fetchUserVideoJobs(), fetchUserVideoEntries()]);
    ensureUserVideoJobsPolling();
  } catch (e) {
    userVideoError.value = e.message;
  } finally {
    userVideoBusy.value = false;
  }
}

async function fetchProDiagnostics(forceRefresh = false) {
  proDiagnosticsLoading.value = true;
  proDiagnosticsError.value = '';
  try {
    const res = await fetch(`/api/debug/pro-detections${forceRefresh ? '?refresh=1' : ''}`);
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || data.error || 'Failed to load pro diagnostics');
    }
    currentGenerationVersion.value = data.currentGenerationVersion || currentGenerationVersion.value;
    proDiagnostics.value = data.items || [];
    proDiagnosticsSummary.value = data.summary || null;
    proDiagnosticsSummaryBySet.value = data.summaryBySet || {};
    const nextTimes = {};
    const nextGroundTruth = {};
    const nextLowFpsAmbiguous = { ...proGroundTruthLowFpsAmbiguous.value };
    const nextOverlayPrefs = { ...proDiagOverlayPrefs.value };
    const nextDetailsOpen = {};
    const nextCommentsOpen = { ...proDiagCommentsOpen.value };
    const nextMuted = { ...proDiagMuted.value };
    const nextVolume = { ...proDiagVolume.value };
    const nextPlaying = { ...proDiagPlaying.value };
    const nextVideoSrc = {};
    const nextPlayerSelection = { ...proDiagPlayerSelection.value };
    const nextNewPlayerName = { ...proDiagNewPlayerName.value };
    const nextNewPlayerHandedness = { ...proDiagNewPlayerHandedness.value };
    const nextLazyActive = {};
    const nextLazyPinned = { ...proDiagLazyPinned.value };
    knownPlayers.value = deriveKnownPlayers(proDiagnostics.value);
    for (let idx = 0; idx < proDiagnostics.value.length; idx += 1) {
      const item = proDiagnostics.value[idx];
      const ts = (item.analysis?.event?.timestampMs ?? 0) / 1000;
      nextTimes[item.id] = Math.max(0, ts);
      const shouldPreload = idx < 2;
      nextLazyActive[item.id] = shouldPreload || Boolean(proDiagLazyActive.value[item.id]);
      if (!(item.id in nextLazyPinned)) nextLazyPinned[item.id] = false;
      const existing = Number(proGroundTruthFrame.value[item.id]);
      if (Number.isFinite(existing) && existing >= 0) {
        nextGroundTruth[item.id] = Math.round(existing);
      } else if (Number.isFinite(Number(item.groundTruthContactFrame))) {
        nextGroundTruth[item.id] = Math.round(Number(item.groundTruthContactFrame));
      }
      if (typeof nextLowFpsAmbiguous[item.id] !== 'boolean') {
        nextLowFpsAmbiguous[item.id] = Boolean(item.lowFpsAmbiguous);
      }
      if (!nextOverlayPrefs[item.id]) {
        nextOverlayPrefs[item.id] = { video: true, ball: false, racket: true, pose: true };
      } else {
        nextOverlayPrefs[item.id] = {
          ...nextOverlayPrefs[item.id],
          video: true
        };
      }
      nextDetailsOpen[item.id] = hasDiagIssue(item);
      if (typeof nextCommentsOpen[item.id] !== 'boolean') nextCommentsOpen[item.id] = false;
      if (typeof nextMuted[item.id] !== 'boolean') nextMuted[item.id] = true;
      if (!Number.isFinite(Number(nextVolume[item.id]))) nextVolume[item.id] = 0.8;
      if (typeof nextPlaying[item.id] !== 'boolean') nextPlaying[item.id] = false;
      nextVideoSrc[item.id] = buildDiagVideoSrc(item);
      const playerName = normalizePlayerName(item.playerName);
      nextPlayerSelection[item.id] = playerName || '__add_new__';
      if (typeof nextNewPlayerName[item.id] !== 'string') nextNewPlayerName[item.id] = '';
      if (typeof nextNewPlayerHandedness[item.id] !== 'string') {
        const fallback = String(item.handedness || '').toLowerCase();
        nextNewPlayerHandedness[item.id] = (fallback === 'left' || fallback === 'right') ? fallback : 'right';
      }
    }
    proDiagTimes.value = nextTimes;
    proGroundTruthFrame.value = nextGroundTruth;
    proGroundTruthLowFpsAmbiguous.value = nextLowFpsAmbiguous;
    proDiagOverlayPrefs.value = nextOverlayPrefs;
    proDiagDetailsOpen.value = nextDetailsOpen;
    proDiagCommentsOpen.value = nextCommentsOpen;
    proDiagMuted.value = nextMuted;
    proDiagVolume.value = nextVolume;
    proDiagPlaying.value = nextPlaying;
    proDiagVideoSrc.value = nextVideoSrc;
    proDiagPlayerSelection.value = nextPlayerSelection;
    proDiagNewPlayerName.value = nextNewPlayerName;
    proDiagNewPlayerHandedness.value = nextNewPlayerHandedness;
    proDiagLazyActive.value = nextLazyActive;
    proDiagLazyPinned.value = nextLazyPinned;
    setTimeout(() => bootstrapDiagLazyObserver(), 0);
    await fetchRefreshStatus();
  } catch (e) {
    proDiagnosticsError.value = e.message;
  } finally {
    proDiagnosticsLoading.value = false;
  }
}

async function fetchRefreshStatus() {
  refreshStatusLoading.value = true;
  try {
    const res = await fetch('/api/debug/refresh-status');
    const data = await res.json();
    if (!res.ok || !data?.ok) {
      throw new Error(data?.message || data?.error || 'Failed to load refresh status');
    }
    refreshStatus.value = data;
  } catch (e) {
    proDiagnosticsError.value = e.message;
  } finally {
    refreshStatusLoading.value = false;
  }
}

async function runRefreshAll() {
  refreshAllBusy.value = true;
  proDiagnosticsError.value = '';
  try {
    const res = await fetch('/api/debug/refresh-all', { method: 'POST' });
    const data = await res.json();
    if (!res.ok || !data?.ok) {
      throw new Error(data?.message || data?.error || 'Failed to refresh all');
    }
    refreshStatus.value = data.after || null;
    await fetchProDiagnostics(true);
  } catch (e) {
    proDiagnosticsError.value = e.message;
  } finally {
    refreshAllBusy.value = false;
  }
}

async function ensureLabFreshData() {
  labSyncState.value = 'checking';
  proDiagnosticsError.value = '';
  try {
    await fetchRefreshStatus();
    const needs = Number(refreshStatus.value?.summary?.needsRefreshCount || 0);
    if (needs > 0) {
      labSyncState.value = 'refreshing';
      await runRefreshAll();
      labSyncState.value = 'ready';
      return;
    }
    labSyncState.value = 'loading';
    await fetchProDiagnostics(false);
    labSyncState.value = 'ready';
  } catch (e) {
    labSyncState.value = 'error';
    proDiagnosticsError.value = e.message;
  }
}

function getDiagDuration(item) {
  return Number(item.analysis?.metadata?.duration || 0);
}

function getDiagDetectedSec(item) {
  const fps = Number(item.analysis?.metadata?.fps || 60);
  const detectedFrame = Number(item.detectedFrame);
  if (Number.isFinite(detectedFrame)) {
    return Math.max(0, detectedFrame / Math.max(1, fps));
  }
  return Math.max(0, Number((item.detectedMs ?? item.analysis?.event?.timestampMs) || 0) / 1000);
}

function getDiagDetectedFrame(item) {
  const frame = Number(item?.detectedFrame ?? item?.analysis?.event?.frame);
  return Number.isFinite(frame) ? Math.max(0, Math.round(frame)) : null;
}

function getDiagMarkerPct(item) {
  const dur = getDiagDuration(item);
  if (!dur) return 0;
  return Math.max(0, Math.min(100, (getDiagDetectedSec(item) / dur) * 100));
}

function getDiagGroundTruthFrame(item) {
  const localFrame = Number(proGroundTruthFrame.value[item?.id]);
  if (Number.isFinite(localFrame) && localFrame >= 0) return Math.round(localFrame);
  const savedFrame = Number(item?.groundTruthContactFrame);
  if (Number.isFinite(savedFrame) && savedFrame >= 0) return Math.round(savedFrame);
  return null;
}

function hasDiagGroundTruth(item) {
  return Number.isFinite(getDiagGroundTruthFrame(item));
}

function getSavedDiagGroundTruthFrame(item) {
  const raw = item?.groundTruthContactFrame;
  if (raw === null || raw === undefined || raw === '') return null;
  const savedFrame = Number(raw);
  if (Number.isFinite(savedFrame) && savedFrame >= 0) return Math.round(savedFrame);
  return null;
}

function hasSavedDiagGroundTruth(item) {
  return Number.isFinite(getSavedDiagGroundTruthFrame(item));
}

function getSavedDiagGroundTruthSec(item) {
  const frame = getSavedDiagGroundTruthFrame(item);
  if (!Number.isFinite(frame)) return null;
  const fps = Number(item.analysis?.metadata?.fps || 60);
  return Math.max(0, frame / Math.max(1, fps));
}

function getSavedDiagGroundTruthPct(item) {
  const dur = getDiagDuration(item);
  const sec = getSavedDiagGroundTruthSec(item);
  if (!dur || !Number.isFinite(sec)) return 0;
  return Math.max(0, Math.min(100, (sec / dur) * 100));
}

function getDiagGroundTruthSec(item) {
  const frame = getDiagGroundTruthFrame(item);
  if (!Number.isFinite(frame)) return null;
  const fps = Number(item.analysis?.metadata?.fps || 60);
  return Math.max(0, frame / Math.max(1, fps));
}

function getDiagGroundTruthPct(item) {
  const dur = getDiagDuration(item);
  const sec = getDiagGroundTruthSec(item);
  if (!dur || !Number.isFinite(sec)) return 0;
  return Math.max(0, Math.min(100, (sec / dur) * 100));
}

function getDiagProgressRatio(item) {
  const dur = getDiagDuration(item);
  if (!dur) return 0;
  const t = Number(proDiagTimes.value[item.id] ?? 0);
  return Math.max(0, Math.min(1, t / dur));
}

function getDiagCurrentFrameDisplay(item) {
  const fps = Number(item?.analysis?.metadata?.fps || 60);
  const dur = getDiagDuration(item);
  const maxFrame = Math.max(0, Math.round(dur * Math.max(1, fps)));
  const t = Number(proDiagTimes.value[item?.id] ?? 0);
  const frame = nearestFrameIndex(t, fps, maxFrame);
  return Math.max(0, frame);
}

function getDiagMaxFrameDisplay(item) {
  const fps = Number(item?.analysis?.metadata?.fps || 60);
  const dur = getDiagDuration(item);
  return Math.max(0, Math.round(dur * Math.max(1, fps)));
}

function timelineLeftFromPercent(pct) {
  const clamped = Math.max(0, Math.min(100, Number(pct) || 0));
  // Keep marker positioning aligned with the 4px timeline thumb even outside .timeline-control scope.
  return `calc((100% - 4px) * ${clamped / 100} + 2px)`;
}

function isDiagLazyItemActive(id) {
  return Boolean(proDiagLazyActive.value[String(id || '')]);
}

function shouldKeepDiagItemActive(id) {
  const key = String(id || '');
  if (!key) return false;
  if (Boolean(proDiagLazyPinned.value[key])) return true;
  if (Boolean(proDiagEditMode.value[key])) return true;
  if (Boolean(proDiagCommentsOpen.value[key])) return true;
  if (Boolean(proDiagDetailsOpen.value[key])) return true;
  return false;
}

function activateDiagLazyItem(id, options = {}) {
  const key = String(id || '');
  if (!key) return;
  if (options.pin === true && !proDiagLazyPinned.value[key]) {
    proDiagLazyPinned.value = {
      ...proDiagLazyPinned.value,
      [key]: true
    };
  }
  if (proDiagLazyActive.value[key]) return;
  proDiagLazyActive.value = {
    ...proDiagLazyActive.value,
    [key]: true
  };
}

function deactivateDiagLazyItem(id) {
  const key = String(id || '');
  if (!key || !proDiagLazyActive.value[key] || shouldKeepDiagItemActive(key)) return;
  const el = proDiagVideoEls.value[key];
  if (el) {
    try {
      el.pause();
      el.removeAttribute('src');
      el.load();
    } catch {
      // no-op
    }
  }
  const nextActive = { ...proDiagLazyActive.value };
  delete nextActive[key];
  proDiagLazyActive.value = nextActive;
}

function setDiagCardRef(id, el) {
  const key = String(id || '');
  if (!key) return;
  const prev = proDiagCardEls.get(key);
  if (prev && prev !== el && proDiagVisibilityObserver) {
    proDiagVisibilityObserver.unobserve(prev);
  }
  if (el) {
    proDiagCardEls.set(key, el);
    if (proDiagVisibilityObserver) {
      proDiagVisibilityObserver.observe(el);
    }
  } else {
    proDiagCardEls.delete(key);
  }
}

function bootstrapDiagLazyObserver() {
  if (typeof window === 'undefined' || typeof window.IntersectionObserver !== 'function') {
    return;
  }
  if (proDiagVisibilityObserver) {
    proDiagVisibilityObserver.disconnect();
  }
  proDiagVisibilityObserver = new window.IntersectionObserver((entries) => {
    for (const entry of entries) {
      const id = String(entry.target?.dataset?.diagId || '').trim();
      if (!id) continue;
      if (entry.isIntersecting) {
        activateDiagLazyItem(id);
      } else {
        deactivateDiagLazyItem(id);
      }
    }
  }, {
    root: null,
    rootMargin: '140px 0px',
    threshold: 0.01
  });
  for (const [id, el] of proDiagCardEls.entries()) {
    if (!el || isDiagLazyItemActive(id)) continue;
    proDiagVisibilityObserver.observe(el);
  }
}

function setDiagVideoRef(id, el) {
  if (el) {
    proDiagVideoEls.value[id] = el;
  } else {
    delete proDiagVideoEls.value[id];
  }
}

function setDiagCanvasRef(id, el) {
  if (el) {
    proDiagCanvasEls.value[id] = el;
  } else {
    delete proDiagCanvasEls.value[id];
  }
}

function getOverlayPrefs(id) {
  return proDiagOverlayPrefs.value[id] || { video: true, ball: false, racket: true, pose: true };
}

function hasAnyPoint(track) {
  return Array.isArray(track) && track.some((p) => Boolean(p));
}

function hasAnyPose(track) {
  if (!Array.isArray(track)) return false;
  return track.some((frame) => {
    const landmarks = frame?.landmarks;
    return Array.isArray(landmarks) && landmarks.some((p) => Number(p?.v || 0) > 0.35);
  });
}

function computeOverlayAvailability(trackPayload) {
  const tracks = trackPayload?.tracks;
  if (!tracks) {
    return {
      known: false,
      video: true,
      ball: false,
      racket: false,
      pose: false
    };
  }
  const poseRuntimeAvailable = tracks.poseRuntimeAvailable !== false;
  return {
    known: true,
    video: true,
    ball: hasAnyPoint(tracks.ballTrack),
    racket: hasAnyPoint(tracks.racketTrack),
    pose: poseRuntimeAvailable && hasAnyPose(tracks.poseTrack)
  };
}

function getOverlayAvailability(item) {
  const id = item?.id;
  if (!id) return { known: false, video: true, ball: false, racket: false, pose: false };
  return proDiagAvailability.value[id] || { known: false, video: true, ball: false, racket: false, pose: false };
}

function toggleOverlayPart(item, key) {
  const id = item?.id;
  if (!id) return;
  const current = getOverlayPrefs(id);
  proDiagOverlayPrefs.value = {
    ...proDiagOverlayPrefs.value,
    [id]: {
      ...current,
      [key]: !current[key]
    }
  };
  drawDiagOverlay(item);
}

function toggleDiagCinema(item) {
  const id = item?.id;
  if (!id) return;
  proDiagCinemaMode.value = {
    ...proDiagCinemaMode.value,
    [id]: !Boolean(proDiagCinemaMode.value[id])
  };
  setTimeout(() => drawDiagOverlay(item), 0);
}

async function fetchDiagTracksForItem(item) {
  if (!item?.id) return;
  if (proDiagTracks.value[item.id] || proDiagTracksBusy.value[item.id]) return;
  proDiagTracksBusy.value = {
    ...proDiagTracksBusy.value,
    [item.id]: true
  };
  try {
    const res = await fetch(`/api/debug/pro-tracks/${encodeURIComponent(item.id)}`);
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || data.error || `Failed loading tracks for ${item.id}`);
    }
    proDiagTracks.value = {
      ...proDiagTracks.value,
      [item.id]: data
    };
    const availability = computeOverlayAvailability(data);
    proDiagAvailability.value = {
      ...proDiagAvailability.value,
      [item.id]: availability
    };
    drawDiagOverlay(item);
  } catch (e) {
    proDiagnosticsError.value = e.message;
  } finally {
    proDiagTracksBusy.value = {
      ...proDiagTracksBusy.value,
      [item.id]: false
    };
  }
}

function drawDiagOverlay(item) {
  const id = item?.id;
  if (!id) return;
  const canvas = proDiagCanvasEls.value[id];
  const video = proDiagVideoEls.value[id];
  if (!canvas || !video) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(video.clientWidth));
  const h = Math.max(1, Math.round(video.clientHeight));
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const canvasParent = canvas.offsetParent || canvas.parentElement;
  if (canvasParent) {
    const parentRect = canvasParent.getBoundingClientRect();
    const videoRect = video.getBoundingClientRect();
    const left = Math.max(0, videoRect.left - parentRect.left);
    const top = Math.max(0, videoRect.top - parentRect.top);
    canvas.style.left = `${left}px`;
    canvas.style.top = `${top}px`;
  } else {
    canvas.style.left = '0px';
    canvas.style.top = '0px';
  }
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const trackPayload = proDiagTracks.value[id];
  const tracks = trackPayload?.tracks;
  if (!tracks) {
    proDiagOverlayStats.value = {
      ...proDiagOverlayStats.value,
      [id]: {
        frame: 0,
        hasBall: false,
        hasRacket: false,
        hasPose: false,
        poseRuntimeAvailable: null,
        source: trackPayload?.source || 'none'
      }
    };
    return;
  }

  const metaW = Number(item.analysis?.metadata?.width || trackPayload?.metadata?.width || 1280);
  const metaH = Number(item.analysis?.metadata?.height || trackPayload?.metadata?.height || 720);
  const fps = Number(item.analysis?.metadata?.fps || trackPayload?.metadata?.fps || 60);
  const maxFrame = getFrameUpperBoundFromTracks(tracks);
  const frame = secondsToFrameIndex(video.currentTime, fps, maxFrame);
  const ball = tracks.ballTrack?.[frame] || null;
  const racket = tracks.racketTrack?.[frame] || null;
  const poseFrame = tracks.poseTrack?.[frame] || null;
  const poseLandmarks = Array.isArray(poseFrame?.landmarks) ? poseFrame.landmarks : null;
  proDiagOverlayStats.value = {
    ...proDiagOverlayStats.value,
    [id]: {
      frame,
      hasBall: Boolean(ball),
      hasRacket: Boolean(racket),
      hasPose: Boolean(poseLandmarks?.length),
      poseRuntimeAvailable: tracks.poseRuntimeAvailable !== false,
      source: trackPayload?.source || 'unknown'
    }
  };

  const sx = w / Math.max(1, metaW);
  const sy = h / Math.max(1, metaH);
  const bx = ball ? ball.x * sx : null;
  const by = ball ? ball.y * sy : null;
  const rx = racket ? racket.x * sx : null;
  const ry = racket ? racket.y * sy : null;
  const prefs = getOverlayPrefs(id);
  const cinema = Boolean(proDiagCinemaMode.value[id]);

  if (prefs.pose && poseLandmarks) {
    ctx.strokeStyle = 'rgba(255, 95, 95, 0.82)';
    ctx.lineWidth = cinema ? 3 : 2;
    for (const [a, b] of DIAG_POSE_CONNECTIONS) {
      const la = poseLandmarks[a];
      const lb = poseLandmarks[b];
      if (!la || !lb) continue;
      if (Number(la.v) < 0.35 || Number(lb.v) < 0.35) continue;
      ctx.beginPath();
      ctx.moveTo(la.x * sx, la.y * sy);
      ctx.lineTo(lb.x * sx, lb.y * sy);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255, 95, 95, 0.95)';
    for (const idx of DIAG_POSE_DOT_INDICES) {
      const p = poseLandmarks[idx];
      if (!p || Number(p.v) < 0.55) continue;
      ctx.beginPath();
      ctx.arc(p.x * sx, p.y * sy, cinema ? 3.2 : 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (prefs.ball && prefs.racket && ball && racket) {
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(rx, ry);
    ctx.stroke();
  }

  if (prefs.ball && ball) {
    ctx.fillStyle = '#ffd24a';
    ctx.beginPath();
    ctx.arc(bx, by, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  if (prefs.racket && racket) {
    ctx.fillStyle = '#6ef0a6';
    ctx.beginPath();
    ctx.arc(rx, ry, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function onDiagVideoTimeUpdate(item) {
  const el = proDiagVideoEls.value[item.id];
  if (el) {
    proDiagTimes.value = {
      ...proDiagTimes.value,
      [item.id]: Number(el.currentTime || 0)
    };
  }
  drawDiagOverlay(item);
}

function getDiagSeekState(id) {
  const existing = proDiagSeekStates.value[id];
  if (existing) return existing;
  const created = {
    inFlight: false,
    token: 0,
    timeoutId: null,
    pendingSec: null,
    pendingPause: false
  };
  proDiagSeekStates.value = {
    ...proDiagSeekStates.value,
    [id]: created
  };
  return created;
}

function setDiagSeekState(id, state) {
  proDiagSeekStates.value = {
    ...proDiagSeekStates.value,
    [id]: state
  };
}

function finishDiagSeek(item, token) {
  const id = item?.id;
  if (!id) return;
  const state = getDiagSeekState(id);
  if (state.token !== token) return;
  if (state.timeoutId) {
    clearTimeout(state.timeoutId);
    state.timeoutId = null;
  }
  state.inFlight = false;
  const pendingSec = state.pendingSec;
  const pendingPause = Boolean(state.pendingPause);
  state.pendingSec = null;
  state.pendingPause = false;
  setDiagSeekState(id, state);

  if (Number.isFinite(pendingSec)) {
    requestDiagSeek(item, pendingSec, { pauseAfter: pendingPause });
  }
}

function requestDiagSeek(item, sec, { pauseAfter = true } = {}) {
  const id = item?.id;
  if (!id) return;
  const el = proDiagVideoEls.value[id];
  if (!el) return;
  const targetSec = Math.max(0, Number(sec) || 0);
  const state = getDiagSeekState(id);

  if (state.inFlight) {
    state.pendingSec = targetSec;
    state.pendingPause = Boolean(state.pendingPause || pauseAfter);
    setDiagSeekState(id, state);
    return;
  }

  state.inFlight = true;
  state.token += 1;
  const token = state.token;
  if (state.timeoutId) {
    clearTimeout(state.timeoutId);
    state.timeoutId = null;
  }
  setDiagSeekState(id, state);

  if (pauseAfter) {
    el.pause();
  }

  try {
    if (typeof el.fastSeek === 'function') {
      el.fastSeek(targetSec);
    } else {
      el.currentTime = targetSec;
    }
  } catch {
    try {
      el.currentTime = targetSec;
    } catch {
      finishDiagSeek(item, token);
      return;
    }
  }

  state.timeoutId = setTimeout(() => {
    finishDiagSeek(item, token);
  }, 220);
  setDiagSeekState(id, state);
}

function onDiagVideoSeeked(item) {
  onDiagVideoTimeUpdate(item);
  const id = item?.id;
  if (!id) return;
  const state = getDiagSeekState(id);
  if (state.inFlight) {
    finishDiagSeek(item, state.token);
  }
}

function onDiagVideoLoaded(item) {
  const id = item.id;
  const el = proDiagVideoEls.value[id];
  if (!el) return;
  seekDiagToFrame(item, getDiagDetectedFrame(item), getDiagDetectedSec(item));
  applyDiagAudioState(item);
  proDiagPlaying.value = { ...proDiagPlaying.value, [id]: false };
  fetchDiagTracksForItem(item);
}

function onDiagVideoError(item) {
  const src = proDiagVideoSrc.value[item?.id] || item?.videoPublicUrl || 'unknown';
  proDiagnosticsError.value = `Video failed to load for ${item?.id || 'unknown'} (${src}).`;
}

function onDiagScrub(item, e) {
  const value = Number(e.target.value || 0);
  const fps = Number(item.analysis?.metadata?.fps || 60);
  const dur = getDiagDuration(item);
  const maxFrame = Math.max(0, Math.round(dur * Math.max(1, fps)));
  const frame = nearestFrameIndex(value, fps, maxFrame);
  const snappedSec = clamp(frame / Math.max(1, fps), 0, dur);
  proDiagTimes.value = {
    ...proDiagTimes.value,
    [item.id]: snappedSec
  };
  const el = proDiagVideoEls.value[item.id];
  if (!el) return;
  requestDiagSeek(item, frameToSecondsForSeek(frame, fps), { pauseAfter: true });
  drawDiagOverlay(item);
}

function onDiagMarkerClick(item) {
  seekDiagToFrame(item, getDiagDetectedFrame(item), getDiagDetectedSec(item));
}

function onDiagGroundTruthMarkerClick(item) {
  const fps = Number(item.analysis?.metadata?.fps || 60);
  const frame = getSavedDiagGroundTruthFrame(item);
  const sec = getSavedDiagGroundTruthSec(item);
  if (!Number.isFinite(sec)) return;
  seekDiagToFrame(item, frame, Math.max(0, sec), fps);
}

function getDiagVolumeValue(item) {
  const v = Number(proDiagVolume.value[item.id]);
  if (!Number.isFinite(v)) return 0.8;
  return clamp(v, 0, 1);
}

function getDiagMuted(item) {
  const m = proDiagMuted.value[item.id];
  return typeof m === 'boolean' ? m : true;
}

function applyDiagAudioState(item) {
  const el = proDiagVideoEls.value[item.id];
  if (!el) return;
  const volume = getDiagVolumeValue(item);
  const muted = getDiagMuted(item);
  el.volume = volume;
  el.muted = muted;
}

function onDiagPlay(item) {
  proDiagPlaying.value = {
    ...proDiagPlaying.value,
    [item.id]: true
  };
  startDiagTimelineRaf(item);
}

function onDiagPause(item) {
  proDiagPlaying.value = {
    ...proDiagPlaying.value,
    [item.id]: false
  };
  stopDiagTimelineRaf(item);
}

function startDiagTimelineRaf(item) {
  const id = item?.id;
  if (!id) return;
  const existing = proDiagRafIds.value[id];
  if (existing) cancelAnimationFrame(existing);

  const tick = () => {
    const el = proDiagVideoEls.value[id];
    if (!el || el.paused) {
      proDiagRafIds.value = { ...proDiagRafIds.value, [id]: null };
      return;
    }
    proDiagTimes.value = {
      ...proDiagTimes.value,
      [id]: Number(el.currentTime || 0)
    };
    drawDiagOverlay(item);
    const rafId = requestAnimationFrame(tick);
    proDiagRafIds.value = { ...proDiagRafIds.value, [id]: rafId };
  };

  const rafId = requestAnimationFrame(tick);
  proDiagRafIds.value = { ...proDiagRafIds.value, [id]: rafId };
}

function stopDiagTimelineRaf(item) {
  const id = item?.id;
  if (!id) return;
  const rafId = proDiagRafIds.value[id];
  if (rafId) cancelAnimationFrame(rafId);
  proDiagRafIds.value = { ...proDiagRafIds.value, [id]: null };
}

async function toggleDiagPlay(item) {
  const el = proDiagVideoEls.value[item.id];
  if (!el) return;
  if (el.paused) {
    try {
      applyDiagAudioState(item);
      await el.play();
    } catch {
      proDiagPlaying.value = {
        ...proDiagPlaying.value,
        [item.id]: false
      };
    }
  } else {
    el.pause();
  }
}

function toggleDiagMute(item) {
  const next = !getDiagMuted(item);
  proDiagMuted.value = {
    ...proDiagMuted.value,
    [item.id]: next
  };
  applyDiagAudioState(item);
}

function onDiagVolumeInput(item, e) {
  const value = clamp(Number(e.target.value || 0), 0, 1);
  proDiagVolume.value = {
    ...proDiagVolume.value,
    [item.id]: value
  };
  const shouldMute = value <= 0.0001;
  proDiagMuted.value = {
    ...proDiagMuted.value,
    [item.id]: shouldMute ? true : false
  };
  applyDiagAudioState(item);
}

function setGroundTruthFromCurrent(item) {
  const fps = Number(item.analysis?.metadata?.fps || 60);
  const displayedFrame = Number(proDiagOverlayStats.value[item.id]?.frame);
  const el = proDiagVideoEls.value[item.id];
  const fallbackSec = Number(el?.currentTime ?? proDiagTimes.value[item.id] ?? 0);
  const frame = Number.isFinite(displayedFrame)
    ? Math.max(0, Math.round(displayedFrame))
    : secondsToFrameIndex(fallbackSec, fps);
  proGroundTruthFrame.value = {
    ...proGroundTruthFrame.value,
    [item.id]: frame
  };
}

function setEditGroundTruthFromCurrent(item) {
  if (!item?.id || !proDiagEditDraft.value[item.id]) return;
  const fps = Number(item.analysis?.metadata?.fps || 60);
  const displayedFrame = Number(proDiagOverlayStats.value[item.id]?.frame);
  const el = proDiagVideoEls.value[item.id];
  const fallbackSec = Number(el?.currentTime ?? proDiagTimes.value[item.id] ?? 0);
  const frame = Number.isFinite(displayedFrame)
    ? Math.max(0, Math.round(displayedFrame))
    : secondsToFrameIndex(fallbackSec, fps);
  proDiagEditDraft.value[item.id].groundTruthFrame = String(frame);
}

function toggleDiagDetails(item) {
  if (!item?.id) return;
  const nextOpen = !Boolean(proDiagDetailsOpen.value[item.id]);
  proDiagDetailsOpen.value = {
    ...proDiagDetailsOpen.value,
    [item.id]: nextOpen
  };
  if (nextOpen) {
    proDiagCommentsOpen.value = {
      ...proDiagCommentsOpen.value,
      [item.id]: false
    };
  }
}

function toggleDiagComments(item) {
  if (!item?.id) return;
  const nextOpen = !Boolean(proDiagCommentsOpen.value[item.id]);
  proDiagCommentsOpen.value = {
    ...proDiagCommentsOpen.value,
    [item.id]: nextOpen
  };
  if (nextOpen) {
    proDiagDetailsOpen.value = {
      ...proDiagDetailsOpen.value,
      [item.id]: false
    };
  }
}

function formatCommentDate(value) {
  const dt = new Date(String(value || '').trim());
  if (!Number.isFinite(dt.getTime())) return 'unknown date';
  return dt.toLocaleString();
}

async function submitDiagComment(item) {
  if (!item?.id) return;
  const text = String(proDiagNewComment.value[item.id] || '').trim();
  if (!text) {
    proDiagnosticsError.value = 'Comment is empty.';
    return;
  }
  proDiagCommentBusy.value = {
    ...proDiagCommentBusy.value,
    [item.id]: true
  };
  proDiagnosticsError.value = '';
  try {
    const res = await fetch(`/api/debug/pro-comments/${encodeURIComponent(item.id)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    const data = await res.json();
    if (!res.ok || !data?.ok) {
      throw new Error(data?.message || data?.error || `Failed to save comment for ${item.id}`);
    }
    const savedComments = Array.isArray(data?.comments) ? data.comments : [];
    proDiagnostics.value = proDiagnostics.value.map((row) => (
      row.id === item.id
        ? {
            ...row,
            comments: savedComments,
            commentCount: savedComments.length
          }
        : row
    ));
    proDiagNewComment.value = {
      ...proDiagNewComment.value,
      [item.id]: ''
    };
    proDiagCommentsOpen.value = {
      ...proDiagCommentsOpen.value,
      [item.id]: true
    };
  } catch (e) {
    proDiagnosticsError.value = e.message;
  } finally {
    proDiagCommentBusy.value = {
      ...proDiagCommentBusy.value,
      [item.id]: false
    };
  }
}

function commentBusyKey(itemId, idx) {
  return `${String(itemId || '')}:${Number(idx)}`;
}

async function deleteDiagComment(item, idx) {
  if (!item?.id) return;
  const key = commentBusyKey(item.id, idx);
  if (proDiagCommentDeleteBusy.value[key]) return;
  proDiagCommentDeleteBusy.value = {
    ...proDiagCommentDeleteBusy.value,
    [key]: true
  };
  proDiagnosticsError.value = '';
  try {
    const res = await fetch(`/api/debug/pro-comments/${encodeURIComponent(item.id)}/${encodeURIComponent(String(idx))}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (!res.ok || !data?.ok) {
      throw new Error(data?.message || data?.error || `Failed to delete comment for ${item.id}`);
    }
    const savedComments = Array.isArray(data?.comments) ? data.comments : [];
    proDiagnostics.value = proDiagnostics.value.map((row) => (
      row.id === item.id
        ? {
            ...row,
            comments: savedComments,
            commentCount: savedComments.length
          }
        : row
    ));
  } catch (e) {
    proDiagnosticsError.value = e.message;
  } finally {
    const next = { ...proDiagCommentDeleteBusy.value };
    delete next[key];
    proDiagCommentDeleteBusy.value = next;
  }
}

function onGroundTruthInput(item, e) {
  const raw = e.target.value;
  if (raw === '') {
    const next = { ...proGroundTruthFrame.value };
    delete next[item.id];
    proGroundTruthFrame.value = next;
    return;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return;
  proGroundTruthFrame.value = {
    ...proGroundTruthFrame.value,
    [item.id]: Math.round(value)
  };
}

async function saveGroundTruth(item) {
  const frame = Number(proGroundTruthFrame.value[item.id]);
  if (!Number.isFinite(frame) || frame < 0) {
    proDiagnosticsError.value = `Invalid ground truth value for ${item.id}`;
    return;
  }
  const lowFpsAmbiguous = Boolean(proGroundTruthLowFpsAmbiguous.value[item.id]);
  const fps = Number(item.analysis?.metadata?.fps || 60);
  const ms = Math.round((Math.round(frame) / Math.max(1, fps)) * 1000);
  proSaveLabelBusy.value = {
    ...proSaveLabelBusy.value,
    [item.id]: true
  };
  proDiagnosticsError.value = '';
  try {
    const res = await fetch(`/api/debug/pro-labels/${encodeURIComponent(item.id)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contactFrame: Math.round(frame),
        contactTimeMs: ms,
        lowFpsAmbiguous
      })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || data.error || `Failed to save label for ${item.id}`);
    }
    await fetchProDiagnostics();
  } catch (e) {
    proDiagnosticsError.value = e.message;
  } finally {
    proSaveLabelBusy.value = {
      ...proSaveLabelBusy.value,
      [item.id]: false
    };
  }
}

async function saveDiagPlayerName(item) {
  if (!item?.id) return;
  const selected = String(proDiagPlayerSelection.value[item.id] || '__add_new__');
  const newName = normalizePlayerName(proDiagNewPlayerName.value[item.id]);
  const playerName = selected === '__add_new__' ? newName : normalizePlayerName(selected);
  const chosenNewHand = String(proDiagNewPlayerHandedness.value[item.id] || '').toLowerCase();
  const newHandedness = chosenNewHand === 'left' || chosenNewHand === 'right'
    ? chosenNewHand
    : String(item?.handedness || 'right').toLowerCase();
  const existingHandedness = getKnownPlayerHandedness(playerName) || String(item?.handedness || 'right').toLowerCase();
  const handedness = playerName ? (selected === '__add_new__' ? newHandedness : existingHandedness) : null;
  if (selected === '__add_new__' && !playerName) {
    proDiagnosticsError.value = 'Please enter a player name.';
    return;
  }
  proDiagPlayerSaveBusy.value = {
    ...proDiagPlayerSaveBusy.value,
    [item.id]: true
  };
  proDiagnosticsError.value = '';
  try {
    const res = await fetch(`/api/debug/pro-videos/${encodeURIComponent(item.id)}/player`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerName: playerName || null, handedness: handedness || undefined })
    });
    const data = await res.json();
    if (!res.ok || !data?.ok) {
      throw new Error(data?.message || data?.error || `Failed to save player for ${item.id}`);
    }
    const savedName = normalizePlayerName(data?.item?.playerName);
    const savedHandedness = String(data?.item?.handedness || '').toLowerCase();
    proDiagPlayerSelection.value = {
      ...proDiagPlayerSelection.value,
      [item.id]: savedName || '__add_new__'
    };
    proDiagNewPlayerName.value = {
      ...proDiagNewPlayerName.value,
      [item.id]: ''
    };
    proDiagNewPlayerHandedness.value = {
      ...proDiagNewPlayerHandedness.value,
      [item.id]: (savedHandedness === 'left' || savedHandedness === 'right') ? savedHandedness : 'right'
    };
    proDiagnostics.value = proDiagnostics.value.map((row) => (
      row.id === item.id
        ? {
            ...row,
            playerName: savedName || null,
            handedness: (savedHandedness === 'left' || savedHandedness === 'right') ? savedHandedness : row.handedness
          }
        : row
    ));
    if (Array.isArray(data?.knownPlayers)) {
      const players = data.knownPlayers
        .map((p) => ({
          name: normalizePlayerName(p?.name),
          handedness: String(p?.handedness || '').toLowerCase()
        }))
        .filter((p) => Boolean(p.name))
        .map((p) => ({
          name: p.name,
          handedness: (p.handedness === 'left' || p.handedness === 'right') ? p.handedness : null
        }));
      knownPlayers.value = players.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      knownPlayers.value = deriveKnownPlayers(proDiagnostics.value);
    }
  } catch (e) {
    proDiagnosticsError.value = e.message;
  } finally {
    proDiagPlayerSaveBusy.value = {
      ...proDiagPlayerSaveBusy.value,
      [item.id]: false
    };
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getFrameUpperBoundFromTracks(tracks) {
  if (!tracks) return null;
  const lengths = [
    Array.isArray(tracks.ballTrack) ? tracks.ballTrack.length : 0,
    Array.isArray(tracks.racketTrack) ? tracks.racketTrack.length : 0,
    Array.isArray(tracks.poseTrack) ? tracks.poseTrack.length : 0
  ].filter((n) => Number.isFinite(n) && n > 0);
  if (!lengths.length) return null;
  return Math.max(0, Math.min(...lengths) - 1);
}

function secondsToFrameIndex(seconds, fps, maxFrame = null) {
  const t = Math.max(0, Number(seconds) || 0);
  const f = Math.max(1, Number(fps) || 60);
  let idx = Math.floor((t * f) + 1e-6);
  if (Number.isFinite(maxFrame) && maxFrame >= 0) {
    idx = Math.min(Math.max(0, idx), Math.round(maxFrame));
  } else {
    idx = Math.max(0, idx);
  }
  return idx;
}

function nearestFrameIndex(seconds, fps, maxFrame = null) {
  const t = Math.max(0, Number(seconds) || 0);
  const f = Math.max(1, Number(fps) || 60);
  let idx = Math.round(t * f);
  if (Number.isFinite(maxFrame) && maxFrame >= 0) {
    idx = Math.min(Math.max(0, idx), Math.round(maxFrame));
  } else {
    idx = Math.max(0, idx);
  }
  return idx;
}

function frameToSecondsForSeek(frame, fps) {
  const f = Math.max(1, Number(fps) || 60);
  const i = Math.max(0, Math.round(Number(frame) || 0));
  // Small positive epsilon keeps us inside the intended frame bucket with floor-based mapping.
  return (i + 1e-3) / f;
}

function seekDiagToFrame(item, targetFrame = null, fallbackSec = 0, fpsOverride = null) {
  const el = proDiagVideoEls.value[item?.id];
  if (!el) return;
  const fps = Number(fpsOverride || item?.analysis?.metadata?.fps || 60);
  const hasFrame = Number.isFinite(targetFrame);
  const seekSec = hasFrame
    ? frameToSecondsForSeek(targetFrame, fps)
    : Math.max(0, Number(fallbackSec) || 0);
  proDiagTimes.value = {
    ...proDiagTimes.value,
    [item.id]: hasFrame ? (Math.round(Number(targetFrame)) / Math.max(1, fps)) : seekSec
  };
  requestDiagSeek(item, seekSec, { pauseAfter: true });
  drawDiagOverlay(item);
}

function buildWaveOverlayPath({
  bins,
  sourceDurationSec,
  sharedShiftSec = 0,
  displayMinSec = 0,
  displayDurationSec = 0
}) {
  if (!Array.isArray(bins) || bins.length === 0) return '';
  if (!Number.isFinite(sourceDurationSec) || sourceDurationSec <= 0) return '';
  if (!Number.isFinite(displayDurationSec) || displayDurationSec <= 0) return '';

  const count = bins.length;
  const dt = sourceDurationSec / count;
  const points = [];

  for (let i = 0; i < count; i += 1) {
    const amp = clamp(Number(bins[i]) || 0, 0, 1);
    const srcT = (i + 0.5) * dt;
    const sharedT = srcT + sharedShiftSec;
    const displayT = sharedT - displayMinSec;
    if (displayT < 0 || displayT > displayDurationSec) continue;
    const x = (displayT / displayDurationSec) * 100;
    const y = 100 - (amp * 92);
    points.push({ x, y });
  }
  if (points.length < 2) return '';

  points.sort((a, b) => a.x - b.x);
  const first = points[0];
  const last = points[points.length - 1];

  let d = `M ${first.x.toFixed(3)} 100 L ${first.x.toFixed(3)} ${first.y.toFixed(3)} `;
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    const mx = (prev.x + curr.x) / 2;
    const my = (prev.y + curr.y) / 2;
    d += `Q ${prev.x.toFixed(3)} ${prev.y.toFixed(3)} ${mx.toFixed(3)} ${my.toFixed(3)} `;
  }
  d += `Q ${last.x.toFixed(3)} ${last.y.toFixed(3)} ${last.x.toFixed(3)} ${last.y.toFixed(3)} `;
  d += `L ${last.x.toFixed(3)} 100 Z`;
  return d;
}

function buildAudioPeakMarkers({
  peaks,
  sourceDurationSec,
  sharedShiftSec = 0,
  displayMinSec = 0,
  displayDurationSec = 0,
  selectedPeakMs = null,
  maxMarkers = 140
}) {
  if (!Array.isArray(peaks) || !peaks.length) return [];
  if (!Number.isFinite(sourceDurationSec) || sourceDurationSec <= 0) return [];
  if (!Number.isFinite(displayDurationSec) || displayDurationSec <= 0) return [];

  const sorted = [...peaks]
    .map((p) => ({
      timeMs: Number(p?.timeMs),
      strength: Math.max(0, Math.min(1, Number(p?.strength) || 0))
    }))
    .filter((p) => Number.isFinite(p.timeMs))
    .sort((a, b) => a.timeMs - b.timeMs);
  if (!sorted.length) return [];

  let working = sorted;
  if (working.length > maxMarkers) {
    // Keep the strongest peaks to avoid rendering too many DOM nodes.
    working = [...working]
      .sort((a, b) => b.strength - a.strength)
      .slice(0, maxMarkers)
      .sort((a, b) => a.timeMs - b.timeMs);
  }

  const selected = Number.isFinite(selectedPeakMs) ? selectedPeakMs : null;
  return working
    .map((p, idx) => {
      const srcSec = p.timeMs / 1000;
      const sharedSec = srcSec + sharedShiftSec;
      const displaySec = sharedSec - displayMinSec;
      if (displaySec < 0 || displaySec > displayDurationSec) return null;
      const pct = (displaySec / displayDurationSec) * 100;
      const isSelected = selected !== null && Math.abs(p.timeMs - selected) <= 20;
      return {
        id: `${idx}-${p.timeMs}`,
        pct: Math.max(0, Math.min(100, pct)),
        strength: p.strength,
        isSelected
      };
    })
    .filter(Boolean);
}

function getDiagWavePath(item) {
  const bins = item?.analysis?.audioAssist?.waveformBins || [];
  const dur = getDiagDuration(item);
  return buildWaveOverlayPath({
    bins,
    sourceDurationSec: dur,
    sharedShiftSec: 0,
    displayMinSec: 0,
    displayDurationSec: dur
  });
}

function getDiagAudioPeaks(item) {
  const peaks = item?.analysis?.audioAssist?.peaks || [];
  const dur = getDiagDuration(item);
  const selectedPeakMs = Number(item?.analysis?.event?.diagnostics?.audioPeakTimeMs);
  return buildAudioPeakMarkers({
    peaks,
    sourceDurationSec: dur,
    sharedShiftSec: 0,
    displayMinSec: 0,
    displayDurationSec: dur,
    selectedPeakMs
  });
}

function stepDiagFrame(item, direction) {
  const fps = Number(item.analysis?.metadata?.fps || 60);
  const dur = getDiagDuration(item);
  const el = proDiagVideoEls.value[item.id];
  const maxFrame = Math.max(0, Math.round(dur * Math.max(1, fps)));
  const displayedFrame = Number(proDiagOverlayStats.value[item.id]?.frame);
  const fallbackSec = Number(el?.currentTime ?? proDiagTimes.value[item.id] ?? 0);
  const currentFrame = Number.isFinite(displayedFrame)
    ? Math.max(0, Math.min(maxFrame, Math.round(displayedFrame)))
    : secondsToFrameIndex(fallbackSec, fps, maxFrame);
  const nextFrame = Math.max(0, Math.min(maxFrame, currentFrame + Math.sign(direction)));
  seekDiagToFrame(item, nextFrame, nextFrame / Math.max(1, fps), fps);
}

async function clearCachesAndTracks() {
  debugMessage.value = '';
  const confirmed = window.confirm('Clear all caches and tracks now? This also clears stored sessions.');
  if (!confirmed) return;

  debugBusy.value = true;
  try {
    const res = await fetch('/api/debug/clear-caches', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || data.error || 'Failed to clear caches');
    }
    debugMessage.value = `Cleared. uploadDerived=${data.deleted.uploadDerived ?? data.deleted.uploadTracks ?? 0}, proCache=${data.deleted.proCache}, processed=${data.deleted.processed}, sessions=${data.deleted.sessions}`;
    activeSession.value = null;
    currentTime.value = 0;
    await Promise.all([fetchPros(), fetchSessions(), fetchUploads()]);
    if (activePage.value === 'diagnostics') {
      await Promise.all([fetchProDiagnostics(true), fetchRefreshStatus()]);
    }
  } catch (e) {
    debugMessage.value = e.message;
  } finally {
    debugBusy.value = false;
  }
}

async function clearDerivedDataOnly() {
  debugMessage.value = '';
  const confirmed = window.confirm('Clear derived data only? Input videos (uploaded + downloaded pro clips) will be kept.');
  if (!confirmed) return;

  debugBusy.value = true;
  try {
    const res = await fetch('/api/debug/clear-derived', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || data.error || 'Failed to clear derived data');
    }
    debugMessage.value = `Derived cleared. uploadDerived=${data.deleted.uploadDerived ?? data.deleted.uploadTracks ?? 0}, proDerived=${data.deleted.proDerived}, processed=${data.deleted.processed}, sessions=${data.deleted.sessions}`;
    activeSession.value = null;
    currentTime.value = 0;
    await Promise.all([fetchPros(), fetchSessions(), fetchUploads()]);
    if (activePage.value === 'diagnostics') {
      await Promise.all([fetchProDiagnostics(true), fetchRefreshStatus()]);
    }
  } catch (e) {
    debugMessage.value = e.message;
  } finally {
    debugBusy.value = false;
  }
}

function onFileChange(e) {
  uploadFile.value = e.target.files?.[0] || null;
}

async function recalculateActiveSession() {
  if (!activeSession.value?.id) return;
  recalcBusy.value = true;
  recalcMessage.value = '';
  error.value = '';
  try {
    const res = await fetch(`/api/sessions/${activeSession.value.id}/recalculate`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || data.error || 'Recalculation failed');
    }
    activeSession.value = data;
    currentTime.value = 0;
    recalcMessage.value = 'Session recalculated with latest logic.';
    await Promise.all([fetchSessions(), fetchUploads()]);
  } catch (e) {
    error.value = e.message;
  } finally {
    recalcBusy.value = false;
  }
}

async function submitComparison() {
  error.value = '';
  if (!selectedPro.value) {
    error.value = 'Please choose a pro reference video.';
    return;
  }
  if (compareMode.value === 'upload' && uploadSelectionMode.value === 'new_upload' && !uploadFile.value) {
    error.value = 'Please choose a video file.';
    return;
  }
  if (compareMode.value === 'upload' && uploadSelectionMode.value === 'existing_upload' && !selectedExistingUpload.value) {
    error.value = 'Please choose an existing uploaded video.';
    return;
  }
  if (compareMode.value === 'pro_library' && !selectedAmateurPro.value) {
    error.value = 'Please choose the comparison pro video.';
    return;
  }

  loading.value = true;
  try {
    let res;
    if (compareMode.value === 'upload') {
      if (uploadSelectionMode.value === 'new_upload') {
        const form = new FormData();
        form.append('video', uploadFile.value);
        form.append('proVideoId', selectedPro.value);
        res = await fetch('/api/upload', {
          method: 'POST',
          body: form
        });
      } else {
        res = await fetch('/api/compare-upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            uploadFileName: selectedExistingUpload.value,
            proVideoId: selectedPro.value
          })
        });
      }
    } else {
      res = await fetch('/api/compare-pros', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amateurProVideoId: selectedAmateurPro.value,
          proVideoId: selectedPro.value
        })
      });
    }

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.message || data.error || 'Upload failed');
    }

    activeSession.value = data;
    currentTime.value = 0;
    await Promise.all([fetchSessions(), fetchUploads()]);
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

function loadSession(session) {
  activeSession.value = session;
  currentTime.value = 0;
}

function syncVideoElements(displayTimeSec) {
  if (!activeComparison.value || !amateurRef.value || !proRef.value) return;
  const sharedTime = displayToSharedTime(displayTimeSec);
  const amateurTime = Math.max(0, isSyncedTimeline.value ? sharedToAmateurTime(sharedTime) : displayTimeSec);
  const proTime = Math.max(0, isSyncedTimeline.value ? sharedToProTime(sharedTime) : displayTimeSec);
  amateurRef.value.currentTime = amateurTime;
  proRef.value.currentTime = proTime;
}

function onScrub(e) {
  const value = Number(e.target.value || 0);
  const amFps = Number(activeComparison.value?.amateur?.metadata?.fps || 60);
  const proFps = Number(activeComparison.value?.pro?.metadata?.fps || 60);
  const scrubFps = Math.max(1, amFps, proFps);
  const snappedFrame = nearestFrameIndex(value, scrubFps);
  const snapped = clamp(snappedFrame / scrubFps, 0, durationSeconds.value);
  currentTime.value = snapped;
  syncVideoElements(snapped);
}

function jumpToMarker(marker) {
  const t = Math.max(0, Math.min(durationSeconds.value, Number(marker.displaySec || 0)));
  currentTime.value = t;
  syncVideoElements(t);
}

function stepCompareFrame(target, direction) {
  if (!activeComparison.value || !amateurRef.value || !proRef.value) return;
  const amFps = Number(activeComparison.value.amateur?.metadata?.fps || 60);
  const proFps = Number(activeComparison.value.pro?.metadata?.fps || 60);
  const dir = Math.sign(direction) || 1;
  let nextDisplayTime = currentTime.value;
  if (target === 'amateur') {
    const amDur = Number(activeComparison.value.amateur?.metadata?.duration || 0);
    const amMaxFrame = Math.max(0, Math.round(amDur * Math.max(1, amFps)));
    const amCurrentFrame = secondsToFrameIndex(Number(amateurRef.value.currentTime || 0), amFps, amMaxFrame);
    const amNextFrame = Math.max(0, Math.min(amMaxFrame, amCurrentFrame + dir));
    const nextAmTime = frameToSecondsForSeek(amNextFrame, amFps);
    nextDisplayTime = isSyncedTimeline.value
      ? nextAmTime - timelineMinSeconds.value
      : nextAmTime;
  } else {
    const proDur = Number(activeComparison.value.pro?.metadata?.duration || 0);
    const proMaxFrame = Math.max(0, Math.round(proDur * Math.max(1, proFps)));
    const proCurrentFrame = secondsToFrameIndex(Number(proRef.value.currentTime || 0), proFps, proMaxFrame);
    const proNextFrame = Math.max(0, Math.min(proMaxFrame, proCurrentFrame + dir));
    const nextProTime = frameToSecondsForSeek(proNextFrame, proFps);
    if (isSyncedTimeline.value) {
      const shared = nextProTime - alignmentOffsetSec.value;
      nextDisplayTime = shared - timelineMinSeconds.value;
    } else {
      nextDisplayTime = nextProTime;
    }
  }

  currentTime.value = clamp(nextDisplayTime, 0, durationSeconds.value);
  syncVideoElements(currentTime.value);
}

function isEditableTarget(el) {
  if (!el) return false;
  const tag = String(el.tagName || '').toLowerCase();
  if (el.isContentEditable) return true;
  if (tag === 'textarea' || tag === 'select') return true;
  if (tag === 'input') {
    const type = String(el.type || '').toLowerCase();
    // Let global frame-step handler control arrow keys on timeline sliders.
    if (type === 'range') return false;
    // Keep native arrow behavior for other form fields.
    return true;
  }
  return false;
}

function visibleAreaInViewport(el) {
  if (!el) return 0;
  const rect = el.getBoundingClientRect();
  const vw = window.innerWidth || document.documentElement.clientWidth || 0;
  const vh = window.innerHeight || document.documentElement.clientHeight || 0;
  const w = Math.max(0, Math.min(rect.right, vw) - Math.max(rect.left, 0));
  const h = Math.max(0, Math.min(rect.bottom, vh) - Math.max(rect.top, 0));
  return w * h;
}

function stepDominantVisibleVideo(direction) {
  const candidates = [];
  if (activePage.value === 'compare') {
    if (amateurRef.value) {
      candidates.push({
        area: visibleAreaInViewport(amateurRef.value),
        run: () => stepCompareFrame('amateur', direction)
      });
    }
    if (proRef.value) {
      candidates.push({
        area: visibleAreaInViewport(proRef.value),
        run: () => stepCompareFrame('pro', direction)
      });
    }
  } else if (activePage.value === 'diagnostics') {
    for (const item of sortedProDiagnostics.value) {
      const el = proDiagVideoEls.value[item.id];
      if (!el) continue;
      candidates.push({
        area: visibleAreaInViewport(el),
        run: () => stepDiagFrame(item, direction)
      });
    }
  } else if (activePage.value === 'user_videos') {
    for (const entry of userVideoEntries.value || []) {
      for (const clip of (entry?.extractedClips || [])) {
        const key = userClipKey(entry?.id, clip?.id);
        const el = userClipVideoEls.value[key];
        if (!el) continue;
        candidates.push({
          area: visibleAreaInViewport(el),
          run: () => stepUserClipFrame(entry, clip, direction)
        });
      }
    }
  } else if (activePage.value === 'user_detection') {
    for (const item of userDetectionItems.value || []) {
      const key = userDetKey(item);
      const el = userDetVideoEls.value[key];
      if (!el) continue;
      candidates.push({
        area: visibleAreaInViewport(el),
        run: () => stepUserDetFrame(item, direction)
      });
    }
  }

  const best = candidates
    .filter((c) => c.area > 0)
    .sort((a, b) => b.area - a.area)[0];
  if (!best) return false;
  best.run();
  return true;
}

function onGlobalArrowFrameStep(e) {
  if (e.defaultPrevented) return;
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  // Enforce one frame step per physical key press.
  if (e.repeat) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (isEditableTarget(document.activeElement)) return;
  const direction = e.key === 'ArrowRight' ? 1 : -1;
  const handled = stepDominantVisibleVideo(direction);
  if (handled) {
    e.preventDefault();
  }
}

function onVideoMetadataReady() {
  syncVideoElements(currentTime.value);
}

watch(activeSession, async () => {
  await new Promise((r) => setTimeout(r, 30));
  syncVideoElements(currentTime.value);
});

watch(timelineMode, () => {
  currentTime.value = 0;
  syncVideoElements(0);
});

watch(activePage, async (page) => {
  const targetUrl = buildUrlForState(page, {
    sort: proDiagSort.value,
    handedness: proDiagFilterHandedness.value,
    player: proDiagFilterPlayer.value,
    set: proDiagFilterSet.value,
    courtSide: proDiagFilterCourtSide.value,
    cameraAngle: proDiagFilterCameraAngle.value,
    result: proDiagFilterResult.value,
    groundTruth: proDiagFilterGroundTruth.value
  });
  if (`${window.location.pathname}${window.location.search}` !== targetUrl) {
    window.history.pushState({}, '', targetUrl);
  }
  if (page === 'diagnostics') {
    await ensureLabFreshData();
  } else if (page === 'user_videos') {
    try {
      await Promise.all([fetchUserVideoEntries(), fetchUserVideoJobs()]);
      ensureUserVideoJobsPolling();
    } catch (e) {
      userVideoError.value = e.message;
    }
  } else if (page === 'user_detection') {
    stopUserVideoJobsPolling();
    await fetchUserDetectionItems();
  } else {
    stopUserVideoJobsPolling();
  }
});

watch([proDiagSort, proDiagFilterHandedness, proDiagFilterPlayer, proDiagFilterSet, proDiagFilterCourtSide, proDiagFilterCameraAngle, proDiagFilterResult, proDiagFilterGroundTruth], (values) => {
  const [sort, handedness, player, set, courtSide, cameraAngle, result, groundTruth] = values;
  const normalizedSort = normalizeProDiagSort(sort);
  const normalizedHandedness = normalizeFilterValue(handedness, new Set(['all', 'left', 'right']));
  const normalizedPlayer = normalizePlayerName(player).toLowerCase() || 'all';
  const normalizedSet = normalizeFilterValue(set, new Set(['all', 'core', 'edge']));
  const normalizedCourtSide = normalizeFilterValue(courtSide, new Set(['all', 'deuce', 'ad']));
  const normalizedCameraAngle = normalizeCameraAngleFilter(cameraAngle);
  const normalizedResult = normalizeFilterValue(result, new Set(['all', 'good', 'medium', 'bad', 'na']));
  const normalizedGroundTruth = normalizeFilterValue(groundTruth, new Set(['all', 'set', 'not_set']));

  if (normalizedSort !== sort) {
    proDiagSort.value = normalizedSort;
    return;
  }
  if (normalizedHandedness !== handedness) {
    proDiagFilterHandedness.value = normalizedHandedness;
    return;
  }
  if (normalizedPlayer !== player) {
    proDiagFilterPlayer.value = normalizedPlayer;
    return;
  }
  if (normalizedSet !== set) {
    proDiagFilterSet.value = normalizedSet;
    return;
  }
  if (normalizedCourtSide !== courtSide) {
    proDiagFilterCourtSide.value = normalizedCourtSide;
    return;
  }
  if (normalizedCameraAngle !== cameraAngle) {
    proDiagFilterCameraAngle.value = normalizedCameraAngle;
    return;
  }
  if (normalizedResult !== result) {
    proDiagFilterResult.value = normalizedResult;
    return;
  }
  if (normalizedGroundTruth !== groundTruth) {
    proDiagFilterGroundTruth.value = normalizedGroundTruth;
    return;
  }
  if (activePage.value !== 'diagnostics') return;
  const targetUrl = buildUrlForState('diagnostics', {
    sort: normalizedSort,
    handedness: normalizedHandedness,
    player: normalizedPlayer,
    set: normalizedSet,
    courtSide: normalizedCourtSide,
    cameraAngle: normalizedCameraAngle,
    result: normalizedResult,
    groundTruth: normalizedGroundTruth
  });
  if (`${window.location.pathname}${window.location.search}` !== targetUrl) {
    window.history.replaceState({}, '', targetUrl);
  }
});

onMounted(async () => {
  bootstrapDiagLazyObserver();
  bootstrapUserClipLazyObserver();
  bootstrapUserDetLazyObserver();
  const initialLabState = parseLabStateFromSearch(window.location.search);
  proDiagSort.value = initialLabState.sort;
  proDiagFilterHandedness.value = initialLabState.handedness;
  proDiagFilterPlayer.value = initialLabState.player;
  proDiagFilterSet.value = initialLabState.set;
  proDiagFilterCourtSide.value = initialLabState.courtSide;
  proDiagFilterCameraAngle.value = initialLabState.cameraAngle;
  proDiagFilterResult.value = initialLabState.result;
  proDiagFilterGroundTruth.value = initialLabState.groundTruth;
  const initialPage = pageFromPath(window.location.pathname);
  if (activePage.value !== initialPage) {
    activePage.value = initialPage;
  }
  const initialUrl = buildUrlForState(initialPage, {
    sort: proDiagSort.value,
    handedness: proDiagFilterHandedness.value,
    player: proDiagFilterPlayer.value,
    set: proDiagFilterSet.value,
    courtSide: proDiagFilterCourtSide.value,
    cameraAngle: proDiagFilterCameraAngle.value,
    result: proDiagFilterResult.value,
    groundTruth: proDiagFilterGroundTruth.value
  });
  if (`${window.location.pathname}${window.location.search}` !== initialUrl) {
    window.history.replaceState({}, '', initialUrl);
  }
  const onPopState = () => {
    const parsed = parseLabStateFromSearch(window.location.search);
    if (proDiagSort.value !== parsed.sort) {
      proDiagSort.value = parsed.sort;
    }
    if (proDiagFilterHandedness.value !== parsed.handedness) {
      proDiagFilterHandedness.value = parsed.handedness;
    }
    if (proDiagFilterPlayer.value !== parsed.player) {
      proDiagFilterPlayer.value = parsed.player;
    }
    if (proDiagFilterSet.value !== parsed.set) {
      proDiagFilterSet.value = parsed.set;
    }
    if (proDiagFilterCourtSide.value !== parsed.courtSide) {
      proDiagFilterCourtSide.value = parsed.courtSide;
    }
    if (proDiagFilterCameraAngle.value !== parsed.cameraAngle) {
      proDiagFilterCameraAngle.value = parsed.cameraAngle;
    }
    if (proDiagFilterResult.value !== parsed.result) {
      proDiagFilterResult.value = parsed.result;
    }
    if (proDiagFilterGroundTruth.value !== parsed.groundTruth) {
      proDiagFilterGroundTruth.value = parsed.groundTruth;
    }
    const nextPage = pageFromPath(window.location.pathname);
    if (activePage.value !== nextPage) {
      activePage.value = nextPage;
    }
  };
  window.addEventListener('popstate', onPopState);
  window.addEventListener('keydown', onGlobalArrowFrameStep);
  onUnmounted(() => {
    if (copiedDiagVideoTimer) {
      clearTimeout(copiedDiagVideoTimer);
      copiedDiagVideoTimer = null;
    }
    window.removeEventListener('popstate', onPopState);
    window.removeEventListener('keydown', onGlobalArrowFrameStep);
    if (proDiagVisibilityObserver) {
      proDiagVisibilityObserver.disconnect();
      proDiagVisibilityObserver = null;
    }
    if (userClipVisibilityObserver) {
      userClipVisibilityObserver.disconnect();
      userClipVisibilityObserver = null;
    }
    if (userDetVisibilityObserver) {
      userDetVisibilityObserver.disconnect();
      userDetVisibilityObserver = null;
    }
    stopUserVideoJobsPolling();
    for (const rafId of Object.values(userClipRafIds.value || {})) {
      if (rafId) cancelAnimationFrame(rafId);
    }
    for (const rafId of Object.values(userDetRafIds.value || {})) {
      if (rafId) cancelAnimationFrame(rafId);
    }
    proDiagCardEls.clear();
    userClipCardEls.clear();
    userDetCardEls.clear();
  });
  await Promise.all([fetchPros(), fetchSessions(), fetchUploads(), fetchUserVideoEntries(), fetchUserVideoJobs(), fetchUserDetectionItems()]);
});
</script>

<template>
  <main>
    <h1>AI Tennis Compare (Serve v1)</h1>

    <div class="row" style="margin-bottom: 12px;">
      <button :disabled="activePage === 'compare'" @click="activePage = 'compare'">Comparison Page</button>
      <button :disabled="activePage === 'diagnostics'" @click="activePage = 'diagnostics'">Pro Detection Lab</button>
      <button :disabled="activePage === 'user_detection'" @click="activePage = 'user_detection'">User Detection Lab</button>
      <button :disabled="activePage === 'user_videos'" @click="activePage = 'user_videos'">User Video Management</button>
    </div>

    <template v-if="activePage === 'compare'">

    <section class="card">
      <h2>Upload Amateur Serve</h2>
      <div class="row">
        <div>
          <label>Comparison mode</label>
          <select v-model="compareMode">
            <option value="upload">Upload my footage (default)</option>
            <option value="pro_library">Use a pro clip instead of my upload</option>
          </select>
        </div>

        <div>
          <label>Pro reference</label>
          <select v-model="selectedPro">
            <option v-for="item in proVideos" :key="item.id" :value="item.id">
              {{ item.title }} ({{ item.available ? 'local' : 'download on demand' }})
            </option>
          </select>
        </div>

        <div v-if="compareMode === 'upload'">
          <label>Upload source</label>
          <select v-model="uploadSelectionMode">
            <option value="new_upload">Upload new file</option>
            <option value="existing_upload">Use previously uploaded file</option>
          </select>
        </div>
        <div v-if="compareMode === 'upload' && uploadSelectionMode === 'new_upload'">
          <label>Video file (max 10s)</label>
          <input type="file" accept="video/mp4,video/quicktime,video/webm" @change="onFileChange" />
        </div>
        <div v-if="compareMode === 'upload' && uploadSelectionMode === 'existing_upload'">
          <label>Existing uploaded video</label>
          <select v-model="selectedExistingUpload">
            <option v-for="item in uploads" :key="item.fileName" :value="item.fileName">
              {{ item.fileName }}
            </option>
          </select>
        </div>
        <div v-else>
          <label>Comparison clip (replaces upload)</label>
          <select v-model="selectedAmateurPro">
            <option v-for="item in proVideos" :key="`am-${item.id}`" :value="item.id">
              {{ item.title }} ({{ item.available ? 'local' : 'download on demand' }})
            </option>
          </select>
        </div>

        <div>
          <label>&nbsp;</label>
          <button :disabled="loading" @click="submitComparison">
            {{
              loading
                ? 'Processing...'
                : compareMode === 'upload'
                  ? uploadSelectionMode === 'new_upload'
                    ? 'Upload & Compare'
                    : 'Compare Existing Upload'
                  : 'Compare Pro Clips'
            }}
          </button>
        </div>
      </div>
      <p class="small">v1 detects only one event: ball contact. Tracks are auto-generated server-side.</p>
      <p v-if="error" class="error">{{ error }}</p>
    </section>

    <section v-if="activeSession" class="card">
      <h2>Comparison</h2>
      <div class="small">Session {{ activeSession.id }}</div>
      <div class="small">
        Contact confidence (amateur/pro):
        {{ activeComparison?.amateur?.event?.confidence?.toFixed?.(2) ?? 'n/a' }} /
        {{ activeComparison?.pro?.event?.confidence?.toFixed?.(2) ?? 'n/a' }}
      </div>
      <div class="small">
        Event reason (amateur/pro):
        {{ activeComparison?.amateur?.event?.reason ?? 'found' }} /
        {{ activeComparison?.pro?.event?.reason ?? 'found' }}
      </div>
      <div class="small">
        Tracking source (amateur/pro):
        {{ activeComparison?.amateur?.trackingSource ?? 'n/a' }} /
        {{ activeComparison?.pro?.trackingSource ?? 'n/a' }}
      </div>
      <div class="small">
        Offset sync by contact: {{ activeComparison?.alignment?.alignmentOffsetMs ?? 'n/a' }} ms
      </div>
      <div class="small">
        Generation: session `{{ sessionGenerationVersion }}` / current `{{ currentGenerationVersion || 'n/a' }}`
      </div>
      <div v-if="isActiveSessionOutdated" class="small error">
        This session was generated with older logic.
      </div>
      <div class="row" style="margin-top: 8px;">
        <button :disabled="recalcBusy" @click="recalculateActiveSession">
          {{ recalcBusy ? 'Recalculating...' : 'Recalculate With Latest Logic' }}
        </button>
        <span v-if="recalcMessage" class="small">{{ recalcMessage }}</span>
      </div>
      <div v-if="!canContactSync" class="small error">
        Contact sync unavailable: at least one contact event is missing or low-confidence.
      </div>
      <div
        v-if="activeComparison?.amateur?.trackingError || activeComparison?.pro?.trackingError"
        class="small error"
      >
        Tracking warning:
        {{ activeComparison?.amateur?.trackingError || activeComparison?.pro?.trackingError }}
      </div>

      <div class="video-grid" style="margin-top: 12px;">
        <div>
          <label>{{ activeSession.amateurVideo.source === 'pro_library' ? 'Pro (A)' : 'Amateur' }}</label>
          <video
            ref="amateurRef"
            :src="activeSession.amateurVideo.publicUrl"
            muted
            playsinline
            @loadedmetadata="onVideoMetadataReady"
          />
          <div class="row frame-controls">
            <button aria-label="Previous frame" @click="stepCompareFrame('amateur', -1)">&lt;</button>
            <button aria-label="Next frame" @click="stepCompareFrame('amateur', 1)">&gt;</button>
          </div>
        </div>
        <div>
          <label>Pro</label>
          <video
            ref="proRef"
            :src="activeSession.proVideo.publicUrl"
            muted
            playsinline
            @loadedmetadata="onVideoMetadataReady"
          />
          <div class="row frame-controls">
            <button aria-label="Previous frame" @click="stepCompareFrame('pro', -1)">&lt;</button>
            <button aria-label="Next frame" @click="stepCompareFrame('pro', 1)">&gt;</button>
          </div>
        </div>
      </div>

      <div style="margin-top: 12px;">
        <label>Shared scrub timeline</label>
        <div class="row" style="margin-bottom: 8px;">
          <label style="margin: 0;">Timeline mode</label>
          <select v-model="timelineMode">
            <option value="synced">Synced (offset applied)</option>
            <option value="unsynced">Unsynced (raw times)</option>
          </select>
        </div>
        <div class="timeline-shell">
          <div class="timeline-meta">
            <span>{{ formatTime(currentTime) }}</span>
            <span>{{ formatTime(durationSeconds) }}</span>
          </div>
          <div class="timeline-lanes">
            <button
              v-for="marker in eventMarkers"
              :key="marker.id"
              class="event-marker"
              :class="`event-${marker.lane}`"
              :style="{ left: timelineLeftFromPercent(marker.pct) }"
              :title="`${marker.label} @ ${formatTime(marker.timeSec)}`"
              @click="jumpToMarker(marker)"
            >
              <span class="event-dot" />
            </button>
              <div class="timeline-control" :style="{ '--progress-ratio': `${timelineProgressRatio}` }">
                <div class="timeline-bar">
                  <div class="timeline-wave timeline-wave-amateur">
                    <svg class="timeline-wave-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
                      <path v-if="amateurWavePath" class="wave-path wave-path-amateur" :d="amateurWavePath" />
                    </svg>
                  </div>
                  <div class="timeline-wave timeline-wave-pro">
                    <svg class="timeline-wave-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
                      <path v-if="proWavePath" class="wave-path wave-path-pro" :d="proWavePath" />
                    </svg>
                  </div>
                  <div class="audio-peak-layer audio-peak-layer-amateur">
                    <span
                      v-for="peak in amateurAudioPeaks"
                      :key="`am-peak-${peak.id}`"
                      :class="['audio-peak', peak.isSelected ? 'audio-peak-selected' : '']"
                      :style="{ left: `${peak.pct}%`, '--peak-alpha': `${0.2 + (peak.strength * 0.65)}` }"
                    />
                  </div>
                  <div class="audio-peak-layer audio-peak-layer-pro">
                    <span
                      v-for="peak in proAudioPeaks"
                      :key="`pro-peak-${peak.id}`"
                      :class="['audio-peak', peak.isSelected ? 'audio-peak-selected' : '']"
                      :style="{ left: `${peak.pct}%`, '--peak-alpha': `${0.2 + (peak.strength * 0.65)}` }"
                    />
                  </div>
                  <div class="timeline-fill" />
                </div>
                <input
                  class="timeline"
                  type="range"
                min="0"
                :max="durationSeconds"
                step="any"
                :value="currentTime"
                @input="onScrub"
              />
            </div>
          </div>
          <div class="timeline-legend">
            <span class="legend-item legend-amateur">Amateur contact</span>
            <span class="legend-item legend-pro">Pro contact</span>
          </div>
        </div>
      </div>
    </section>

    <section class="card">
      <h2>All Sessions (Global v1)</h2>
      <div v-if="!sessions.length" class="small">No sessions yet.</div>
      <div v-for="session in sessions" :key="session.id" class="session row">
        <div>
          <strong>{{ session.proVideo.title }}</strong>
          <div class="small">
            {{
              session.amateurVideo.source === 'pro_library'
                ? `vs ${session.amateurVideo.title}`
                : session.amateurVideo.source === 'upload_library'
                  ? `vs existing upload (${session.amateurVideo.fileName})`
                  : 'vs uploaded footage'
            }}
          </div>
          <div v-if="session.isOutdatedGeneration" class="small error">
            outdated generation ({{ session.generation?.version || 'unknown' }})
          </div>
          <div class="small">{{ session.createdAt }}</div>
        </div>
        <button @click="loadSession(session)">Open</button>
      </div>
    </section>
    </template>

    <template v-else-if="activePage === 'diagnostics'">
    <section class="card">
      <h2>Pro Detection Lab</h2>
      <p class="small">
        This page evaluates all pro videos from config, shows the detected contact frame, and exposes diagnostics.
      </p>
      <p class="small">
        <template v-if="labSyncState === 'checking' || refreshStatusLoading">
          Status: checking whether regeneration is needed...
        </template>
        <template v-else-if="labSyncState === 'refreshing' || refreshAllBusy">
          Status: regenerating outdated artifacts and rerunning diagnostics...
        </template>
        <template v-else-if="labSyncState === 'loading' || proDiagnosticsLoading">
          Status: loading latest diagnostics...
        </template>
        <template v-else-if="refreshStatus?.summary && refreshStatus.summary.needsRefreshCount > 0">
          Status: {{ refreshStatus.summary.needsRefreshCount }} clips still need regeneration
          (clip={{ refreshStatus.summary.clipNeedsRefreshCount }}, tracks={{ refreshStatus.summary.tracksNeedsRefreshCount }}, audio={{ refreshStatus.summary.audioNeedsRefreshCount }}).
        </template>
        <template v-else-if="refreshStatus?.summary">
          Status: everything is up to date.
        </template>
        <template v-else>
          Status: not loaded yet.
        </template>
      </p>
      <p v-if="debugMessage" class="small">{{ debugMessage }}</p>
      <p v-if="proDiagnosticsError" class="error">{{ proDiagnosticsError }}</p>
    </section>

    <section class="card">
      <h2>Detection Results</h2>
      <template v-for="setName in diagnosticSummarySetNames" :key="`summary-${setName}`">
        <div
          v-if="proDiagnosticsSummaryBySet[setName]"
          class="small"
          style="margin-bottom: 6px;"
        >
          Set `{{ setName }}`:
          count(with manual reference)={{ proDiagnosticsSummaryBySet[setName].evaluatedWithGroundTruth ?? 0 }},
          meanAbs(fr)=
          <span :class="getFrameErrorSeverityClass(proDiagnosticsSummaryBySet[setName].meanAbsErrorFrames)">
            {{
              Number.isFinite(proDiagnosticsSummaryBySet[setName].meanAbsErrorFrames)
                ? `${Math.round(proDiagnosticsSummaryBySet[setName].meanAbsErrorFrames)}`
                : 'n/a'
            }}
          </span>,
          maxAbs(fr)=
          <span :class="getFrameErrorSeverityClass(proDiagnosticsSummaryBySet[setName].maxAbsErrorFrames)">
            {{
              Number.isFinite(proDiagnosticsSummaryBySet[setName].maxAbsErrorFrames)
                ? `${Math.round(proDiagnosticsSummaryBySet[setName].maxAbsErrorFrames)}`
                : 'n/a'
            }}
          </span>
        </div>
      </template>
      <div v-if="proDiagnosticsSummary" class="small" style="margin-bottom: 10px;">
        Overall:
        Evaluated with manual reference: {{ proDiagnosticsSummary.evaluatedWithGroundTruth ?? 0 }} |
        Mean abs error (frames):
        <span :class="getFrameErrorSeverityClass(proDiagnosticsSummary.meanAbsErrorFrames)">
          {{
            Number.isFinite(proDiagnosticsSummary.meanAbsErrorFrames)
              ? `${Math.round(proDiagnosticsSummary.meanAbsErrorFrames)}`
              : 'n/a'
          }}
        </span>
        |
        Max abs error (frames):
        <span :class="getFrameErrorSeverityClass(proDiagnosticsSummary.maxAbsErrorFrames)">
          {{
            Number.isFinite(proDiagnosticsSummary.maxAbsErrorFrames)
              ? `${Math.round(proDiagnosticsSummary.maxAbsErrorFrames)}`
              : 'n/a'
          }}
        </span>
      </div>
      <div class="row diag-filter-row">
        <div class="diag-filter-field">
          <label>Sort by</label>
          <select v-model="proDiagSort">
            <option value="set_asc">set (ascending)</option>
            <option value="set_desc">set (descending)</option>
            <option value="date_added_asc">date added (ascending)</option>
            <option value="date_added_desc">date added (descending)</option>
            <option value="error_asc">error (ascending)</option>
            <option value="error_desc">error (descending)</option>
            <option value="confidence_asc">confidence (ascending)</option>
            <option value="confidence_desc">confidence (descending)</option>
          </select>
        </div>
        <div class="diag-filter-field">
          <label>Handedness</label>
          <select v-model="proDiagFilterHandedness">
            <option value="all">all</option>
            <option value="left">left</option>
            <option value="right">right</option>
          </select>
        </div>
        <div class="diag-filter-field">
          <label>Player</label>
          <select v-model="proDiagFilterPlayer">
            <option value="all">all</option>
            <option
              v-for="player in knownPlayers"
              :key="`filter-player-${player.name}`"
              :value="normalizePlayerName(player.name).toLowerCase()"
            >
              {{ player.name }}
            </option>
          </select>
        </div>
        <div class="diag-filter-field">
          <label>Set</label>
          <select v-model="proDiagFilterSet">
            <option value="all">all</option>
            <option value="core">core</option>
            <option value="edge">edge</option>
          </select>
        </div>
        <div class="diag-filter-field">
          <label>Court side</label>
          <select v-model="proDiagFilterCourtSide">
            <option value="all">all</option>
            <option value="deuce">deuce</option>
            <option value="ad">ad</option>
          </select>
        </div>
        <div class="diag-filter-field">
          <label>Camera angle</label>
          <select v-model="proDiagFilterCameraAngle">
            <option
              v-for="angle in diagnosticCameraAngleFilterOptions"
              :key="`filter-angle-${angle}`"
              :value="angle"
            >
              {{ angle }}
            </option>
          </select>
        </div>
        <div class="diag-filter-field">
          <label>Detection result</label>
          <select v-model="proDiagFilterResult">
            <option value="all">all</option>
            <option value="good">good</option>
            <option value="medium">medium</option>
            <option value="bad">bad</option>
            <option value="na">n/a</option>
          </select>
        </div>
        <div class="diag-filter-field">
          <label>Ground truth</label>
          <select v-model="proDiagFilterGroundTruth">
            <option value="all">all</option>
            <option value="set">set</option>
            <option value="not_set">not set</option>
          </select>
        </div>
      </div>
      <div v-if="!proDiagnostics.length" class="small">No diagnostics loaded yet.</div>
      <div v-else-if="!sortedProDiagnostics.length" class="small">No videos in current filter.</div>
      <div
        v-for="item in sortedProDiagnostics"
        :key="item.id"
        :ref="(el) => setDiagCardRef(item.id, el)"
        :data-diag-id="item.id"
        class="session"
        style="display: grid; gap: 10px;"
      >
          <div :class="['row', 'diag-title-row', { cinema: Boolean(proDiagCinemaMode[item.id]) }]">
            <strong class="diag-title-main">
              <span class="diag-title-copy-group">
                <span>{{ item.title }} ({{ item.id }})</span>
                <button
                  type="button"
                  class="diag-copy-btn"
                  title="Copy video id"
                  aria-label="Copy video id"
                  @click="copyDiagVideoId(item)"
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M5 2.5h7A1.5 1.5 0 0 1 13.5 4v8A1.5 1.5 0 0 1 12 13.5H5A1.5 1.5 0 0 1 3.5 12V4A1.5 1.5 0 0 1 5 2.5zm0 1A.5.5 0 0 0 4.5 4v8a.5.5 0 0 0 .5.5h7a.5.5 0 0 0 .5-.5V4a.5.5 0 0 0-.5-.5H5z" />
                    <path d="M2 5.5a.5.5 0 0 1 .5-.5H3v1h-.5a.5.5 0 0 0-.5.5V12a2 2 0 0 0 2 2h5.5a.5.5 0 0 0 .5-.5V13h1v.5A1.5 1.5 0 0 1 9.5 15H4a3 3 0 0 1-3-3V5.5z" />
                  </svg>
                </button>
              </span>
              <span v-if="copiedDiagVideoId === item.id" class="diag-copy-feedback">Copied to Clipboard</span>
              <span :class="['diag-set-badge', `diag-set-${String(item.evaluationSet || 'core').toLowerCase()}`]">
                {{ String(item.evaluationSet || 'core').toUpperCase() }}
              </span>
              <button
                type="button"
                class="diag-edit-btn"
                @click="toggleDiagEditMode(item)"
              >
                {{ proDiagEditMode[item.id] ? 'Close Edit' : 'Edit' }}
              </button>
            </strong>
            <span class="small" :class="hasGroundTruthValue(item) ? getFrameErrorSeverityClass(item.absErrorFrames) : 'metric-missing-warning'">
              {{
                !hasGroundTruthValue(item)
                  ? 'Warning: ground truth missing'
                  : hasErrorFramesValue(item)
                  ? `Error: ${Math.round(item.errorFrames)}`
                  : 'Error: n/a'
              }}
            </span>
          </div>
          <div v-if="isDiagLazyItemActive(item.id)" class="row diag-row" style="align-items: flex-start;">
            <div :class="['diag-video-shell', { cinema: Boolean(proDiagCinemaMode[item.id]) }]">
              <div class="diag-video-wrap" :class="{ cinema: Boolean(proDiagCinemaMode[item.id]) }">
                <div class="diag-overlay-badge small">
                  <div class="overlay-left">
                    <span class="overlay-toggle-row">
                      <button
                        type="button"
                        :class="['overlay-toggle-btn', 'overlay-pill-video', getOverlayPrefs(item.id).video ? 'overlay-on' : 'overlay-off']"
                        @click="toggleOverlayPart(item, 'video')"
                      >
                        video
                      </button>
                    </span>
                    <span class="overlay-toggle-row">
                      <button
                        type="button"
                        :disabled="!getOverlayAvailability(item).ball"
                        :class="[
                          'overlay-toggle-btn',
                          'overlay-pill-ball',
                          getOverlayPrefs(item.id).ball ? 'overlay-on' : 'overlay-off',
                          !getOverlayAvailability(item).ball ? 'overlay-unavailable' : ''
                        ]"
                        @click="toggleOverlayPart(item, 'ball')"
                      >
                        ball
                      </button>
                    </span>
                    <span class="overlay-toggle-row">
                      <button
                        type="button"
                        :disabled="!getOverlayAvailability(item).racket"
                        :class="[
                          'overlay-toggle-btn',
                          'overlay-pill-racket',
                          getOverlayPrefs(item.id).racket ? 'overlay-on' : 'overlay-off',
                          !getOverlayAvailability(item).racket ? 'overlay-unavailable' : ''
                        ]"
                        @click="toggleOverlayPart(item, 'racket')"
                      >
                        wrist
                      </button>
                    </span>
                    <span class="overlay-toggle-row">
                      <button
                        type="button"
                        :disabled="!getOverlayAvailability(item).pose"
                        :class="[
                          'overlay-toggle-btn',
                          'overlay-pill-pose',
                          getOverlayPrefs(item.id).pose ? 'overlay-on' : 'overlay-off',
                          !getOverlayAvailability(item).pose ? 'overlay-unavailable' : ''
                        ]"
                        @click="toggleOverlayPart(item, 'pose')"
                      >
                        pose
                      </button>
                    </span>
                  </div>
                  <div class="overlay-right">
                    <span>frame {{ proDiagOverlayStats[item.id]?.frame ?? 0 }}</span>
                    <span class="overlay-toggle-row">
                      <button
                        type="button"
                        :class="['overlay-toggle-btn', 'overlay-pill-video', Boolean(proDiagCinemaMode[item.id]) ? 'overlay-on' : 'overlay-off']"
                        @click="toggleDiagCinema(item)"
                      >
                        widescreen
                      </button>
                    </span>
                  </div>
                </div>
                <div class="diag-media">
                  <video
                    :ref="(el) => setDiagVideoRef(item.id, el)"
                    :class="{ 'diag-video-hidden': !getOverlayPrefs(item.id).video }"
                    :src="getDiagLazyVideoSrc(item)"
                    :controls="!item.analysis"
                    muted
                    playsinline
                    @loadedmetadata="onDiagVideoLoaded(item)"
                    @error="onDiagVideoError(item)"
                    @timeupdate="onDiagVideoTimeUpdate(item)"
                    @seeked="onDiagVideoSeeked(item)"
                    @play="onDiagPlay(item)"
                    @pause="onDiagPause(item)"
                    @ended="onDiagPause(item)"
                  />
                  <canvas
                    :ref="(el) => setDiagCanvasRef(item.id, el)"
                    class="diag-overlay"
                  />
                </div>
              </div>
              <div v-if="item.analysis" class="timeline-shell" style="margin-top: 8px;">
                <div class="timeline-meta">
                  <span>{{ formatTime(proDiagTimes[item.id] || 0) }} ({{ getDiagCurrentFrameDisplay(item) }})</span>
                  <span>{{ formatTime(getDiagDuration(item)) }} ({{ getDiagMaxFrameDisplay(item) }})</span>
                </div>
                <div class="row timeline-actions" style="margin-bottom: 6px;">
                  <div class="row timeline-action-group">
                    <button
                      type="button"
                      class="icon-btn"
                      :aria-label="proDiagPlaying[item.id] ? 'Pause' : 'Play'"
                      @click="toggleDiagPlay(item)"
                    >
                      <svg v-if="!proDiagPlaying[item.id]" class="icon-svg" viewBox="0 0 16 16" aria-hidden="true">
                        <path d="M4 2.5L13 8L4 13.5V2.5z" />
                      </svg>
                      <svg v-else class="icon-svg" viewBox="0 0 16 16" aria-hidden="true">
                        <rect x="3.5" y="2.5" width="3.5" height="11" rx="0.5" />
                        <rect x="9" y="2.5" width="3.5" height="11" rx="0.5" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      class="icon-btn"
                      :aria-label="getDiagMuted(item) ? 'Unmute' : 'Mute'"
                      @click="toggleDiagMute(item)"
                    >
                      <svg v-if="getDiagMuted(item)" class="icon-svg" viewBox="0 0 16 16" aria-hidden="true">
                        <path d="M2.5 6.5h3L9.5 3v10l-4-3.5h-3z" />
                        <path d="M11.2 6.1l3.1 3.1M14.3 6.1l-3.1 3.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none" />
                      </svg>
                      <svg v-else class="icon-svg" viewBox="0 0 16 16" aria-hidden="true">
                        <path d="M2.5 6.5h3L9.5 3v10l-4-3.5h-3z" />
                        <path d="M11.2 6.1a2.2 2.2 0 010 3.8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                        <path d="M12.8 4.6a4.2 4.2 0 010 6.8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                      </svg>
                    </button>
                    <input
                      class="volume-slider"
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      :value="getDiagVolumeValue(item)"
                      @input="onDiagVolumeInput(item, $event)"
                    />
                  </div>
                  <div class="row frame-controls">
                    <button aria-label="Previous frame" @click="stepDiagFrame(item, -1)">&lt;</button>
                    <button aria-label="Next frame" @click="stepDiagFrame(item, 1)">&gt;</button>
                  </div>
                </div>
                <div class="timeline-lanes">
                  <button
                    v-if="hasSavedDiagGroundTruth(item)"
                    class="event-marker event-ground"
                    :style="{ left: timelineLeftFromPercent(getSavedDiagGroundTruthPct(item)) }"
                    :title="`Ground truth @ ${formatTime(getSavedDiagGroundTruthSec(item) || 0)}`"
                    @click="onDiagGroundTruthMarkerClick(item)"
                  >
                    <span class="event-dot" />
                  </button>
                  <button
                    v-if="hasDiagGroundTruth(item)"
                    class="event-marker event-pro"
                    :style="{ left: timelineLeftFromPercent(getDiagMarkerPct(item)) }"
                    :title="`Detected event @ ${formatTime(getDiagDetectedSec(item))}`"
                    @click="onDiagMarkerClick(item)"
                  >
                    <span class="event-dot" />
                  </button>
                  <div class="timeline-control" :style="{ '--progress-ratio': `${getDiagProgressRatio(item)}` }">
                    <div class="timeline-bar">
                      <div class="timeline-wave timeline-wave-pro">
                        <svg class="timeline-wave-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
                          <path
                            v-if="getDiagWavePath(item)"
                            class="wave-path wave-path-pro"
                            :d="getDiagWavePath(item)"
                          />
                        </svg>
                      </div>
                      <div class="audio-peak-layer audio-peak-layer-pro">
                        <span
                          v-for="peak in getDiagAudioPeaks(item)"
                          :key="`diag-peak-${item.id}-${peak.id}`"
                          :class="['audio-peak', peak.isSelected ? 'audio-peak-selected' : '']"
                          :style="{ left: `${peak.pct}%`, '--peak-alpha': `${0.2 + (peak.strength * 0.65)}` }"
                        />
                      </div>
                      <div class="timeline-fill" />
                    </div>
                    <input
                      class="timeline"
                      type="range"
                      min="0"
                      :max="getDiagDuration(item)"
                      step="any"
                      :value="proDiagTimes[item.id] || 0"
                      @input="onDiagScrub(item, $event)"
                    />
                  </div>
                </div>
              </div>
              <div v-else class="small error" style="margin-top: 8px;">
                Detection unavailable for this clip.
              </div>
              <div v-if="item.error" class="error" style="margin-top: 8px;">Error: {{ item.error }}</div>
              <template v-if="item.analysis">
              <div class="diag-summary-block">
                <div class="small">
                  Auto-detected contact (frame):
                  {{
                    Number.isFinite(Number(item.detectedFrame ?? item.analysis?.event?.frame))
                      ? Math.round(Number(item.detectedFrame ?? item.analysis?.event?.frame))
                      : 'n/a'
                  }}
                  <span class="small">
                    ({{ formatTime(((item.detectedMs ?? item.analysis?.event?.timestampMs) || 0) / 1000) }})
                  </span>
                </div>
                <div class="small">Confidence: {{ item.analysis?.event?.confidence?.toFixed?.(3) ?? 'n/a' }}</div>
                <div class="small">
                  Manual reference contact (ground truth frame):
                  {{
                    Number.isFinite(Number(item.groundTruthContactFrame))
                      ? `${Math.round(Number(item.groundTruthContactFrame))} (${formatTime(Number(item.groundTruthContactMs || 0) / 1000)})`
                      : 'not set'
                  }}
                </div>
                <div class="small" :class="hasGroundTruthValue(item) ? getFrameErrorSeverityClass(item.absErrorFrames) : 'metric-missing-warning'">
                  {{
                    !hasGroundTruthValue(item)
                      ? 'Warning: ground truth missing'
                      : hasErrorFramesValue(item)
                      ? `Error (frames): ${Math.round(item.errorFrames)} (abs: ${hasAbsErrorFramesValue(item) ? Math.round(item.absErrorFrames) : 'n/a'}, ms: ${Number.isFinite(Number(item.errorMs)) ? Math.round(item.errorMs) : 'n/a'})`
                      : 'Error (frames): n/a (detection unavailable)'
                  }}
                </div>
                <template v-if="!proDiagEditMode[item.id]">
                  <div v-if="hasMissingGroundTruth(item)" class="row manual-actions" style="margin-top: 8px;">
                    <input
                      type="number"
                      min="0"
                      step="1"
                      :value="proGroundTruthFrame[item.id] ?? ''"
                      @input="onGroundTruthInput(item, $event)"
                      placeholder="Manual reference (frame)"
                      style="max-width: 150px;"
                    />
                    <button @click="setGroundTruthFromCurrent(item)">Set From Current Frame</button>
                    <button
                      :disabled="Boolean(proSaveLabelBusy[item.id])"
                      @click="saveGroundTruth(item)"
                    >
                      {{ proSaveLabelBusy[item.id] ? 'Saving...' : 'Save Manual Reference' }}
                    </button>
                  </div>
                  <div v-if="hasMissingGroundTruth(item)" class="row manual-actions" style="margin-top: 6px;">
                    <label style="margin: 0; display: inline-flex; align-items: center; gap: 6px;">
                      <input
                        type="checkbox"
                        :checked="Boolean(proGroundTruthLowFpsAmbiguous[item.id])"
                        @change="proGroundTruthLowFpsAmbiguous[item.id] = Boolean($event.target.checked)"
                      />
                      Low-FPS ambiguous contact window
                    </label>
                  </div>
                  <div v-if="hasMissingPlayer(item)" class="row manual-actions" style="margin-top: 8px;">
                    <select v-model="proDiagPlayerSelection[item.id]" style="min-width: 220px;">
                      <option value="__add_new__">Add New</option>
                      <option
                        v-for="player in knownPlayers"
                        :key="`player-${player.name}`"
                        :value="player.name"
                      >
                        {{ player.handedness ? `${player.name} (${player.handedness})` : player.name }}
                      </option>
                    </select>
                    <template v-if="proDiagPlayerSelection[item.id] === '__add_new__'">
                      <input
                        type="text"
                        :value="proDiagNewPlayerName[item.id] || ''"
                        @input="proDiagNewPlayerName[item.id] = $event.target.value"
                        placeholder="Player name"
                        style="max-width: 220px;"
                      />
                      <select v-model="proDiagNewPlayerHandedness[item.id]" style="max-width: 120px;">
                        <option value="right">right</option>
                        <option value="left">left</option>
                      </select>
                    </template>
                    <button
                      :disabled="Boolean(proDiagPlayerSaveBusy[item.id])"
                      @click="saveDiagPlayerName(item)"
                    >
                      {{ proDiagPlayerSaveBusy[item.id] ? 'Saving...' : 'Save Player' }}
                    </button>
                  </div>
                </template>
              </div>
              <div style="margin-top: 8px;">
                <button type="button" @click="toggleDiagDetails(item)">
                  {{ proDiagDetailsOpen[item.id] ? 'Hide Details' : 'Details' }}
                </button>
                <button type="button" style="margin-left: 8px;" @click="toggleDiagComments(item)">
                  {{
                    proDiagCommentsOpen[item.id]
                      ? `Hide Comments${Number(item.commentCount || 0) > 0 ? ` (${Math.round(Number(item.commentCount || 0))})` : ''}`
                      : `Comments${Number(item.commentCount || 0) > 0 ? ` (${Math.round(Number(item.commentCount || 0))})` : ''}`
                  }}
                </button>
              </div>
              <div v-if="proDiagDetailsOpen[item.id]" class="small" style="margin-top: 6px;">
                <div>Player: {{ item.playerName || 'unknown' }}</div>
                <div>Evaluation set: {{ item.evaluationSet || 'core' }}</div>
                <div>Date added: {{ item.dateAdded || 'unknown' }}</div>
                <div>Court side: {{ item.courtSide || 'unknown' }}</div>
                <div>Source: {{ item.sourceUrl }}</div>
                <div>Found: {{ item.analysis?.event?.found ? 'yes' : 'no' }}</div>
                <div>Reason: {{ item.analysis?.event?.reason ?? 'found' }}</div>
                <div>Tracking source: {{ item.analysis?.trackingSource ?? 'n/a' }}</div>
                <div>Tracking error: {{ item.analysis?.trackingError ?? 'none' }}</div>
                <div>Clip QC: {{ getClipQcStatusText(item) }}</div>
                <div>Clip QC checked at: {{ getClipQc(item)?.checkedAt ?? 'n/a' }}</div>
                <div>Clip QC details: {{ JSON.stringify(getClipQc(item)?.issues || []) }}</div>
                <div>
                  Track availability:
                  ball={{ getOverlayAvailability(item).ball ? 'yes' : 'no' }},
                  wrist={{ getOverlayAvailability(item).racket ? 'yes' : 'no' }},
                  pose={{ getOverlayAvailability(item).pose ? 'yes' : 'no' }}
                </div>
                <div>Diagnostics: {{ JSON.stringify(item.analysis?.event?.diagnostics || {}) }}</div>
              </div>
              <div v-if="proDiagCommentsOpen[item.id]" class="diag-comments-wrap" style="margin-top: 8px;">
                <div class="diag-comments-list">
                  <div v-if="!Array.isArray(item.comments) || !item.comments.length" class="small">
                    No comments yet.
                  </div>
                  <div
                    v-for="(comment, idx) in (Array.isArray(item.comments) ? item.comments : [])"
                    :key="`comment-${item.id}-${idx}`"
                    class="diag-comment-item"
                  >
                    <div class="diag-comment-head">
                      <div class="small diag-comment-date">{{ formatCommentDate(comment.createdAt) }}</div>
                      <button
                        type="button"
                        class="diag-comment-delete"
                        :disabled="Boolean(proDiagCommentDeleteBusy[`${item.id}:${idx}`])"
                        @click="deleteDiagComment(item, idx)"
                      >
                        {{ proDiagCommentDeleteBusy[`${item.id}:${idx}`] ? 'Deleting...' : 'Delete' }}
                      </button>
                    </div>
                    <div class="diag-comment-text">{{ comment.text }}</div>
                  </div>
                </div>
                <div class="diag-comment-editor">
                  <textarea
                    :value="proDiagNewComment[item.id] || ''"
                    @input="proDiagNewComment[item.id] = $event.target.value"
                    rows="3"
                    placeholder="Add comment about this clip..."
                  />
                  <button
                    type="button"
                    :disabled="Boolean(proDiagCommentBusy[item.id])"
                    @click="submitDiagComment(item)"
                  >
                    {{ proDiagCommentBusy[item.id] ? 'Saving...' : 'Submit Comment' }}
                  </button>
                </div>
              </div>
              </template>
            </div>
            <div v-if="proDiagEditMode[item.id] && proDiagEditDraft[item.id]" class="diag-edit-side">
              <div class="diag-edit-grid">
                <label class="diag-edit-field">
                  <span>Title</span>
                  <input
                    type="text"
                    :value="proDiagEditDraft[item.id].title"
                    @input="proDiagEditDraft[item.id].title = $event.target.value"
                  />
                </label>
                <label class="diag-edit-field">
                  <span>Stroke type</span>
                  <select v-model="proDiagEditDraft[item.id].strokeType">
                    <option value="serve">serve</option>
                  </select>
                </label>
                <label class="diag-edit-field">
                  <span>Evaluation set</span>
                  <select v-model="proDiagEditDraft[item.id].evaluationSet">
                    <option value="core">core</option>
                    <option value="edge">edge</option>
                  </select>
                </label>
                <label class="diag-edit-field">
                  <span>Camera angle</span>
                  <select v-model="proDiagEditDraft[item.id].cameraAngle">
                    <option v-for="angle in editableCameraAngleOptions" :key="`edit-angle-${item.id}-${angle}`" :value="angle">
                      {{ angle }}
                    </option>
                  </select>
                </label>
                <label class="diag-edit-field">
                  <span>Court side</span>
                  <select v-model="proDiagEditDraft[item.id].courtSide">
                    <option value="deuce">deuce</option>
                    <option value="ad">ad</option>
                  </select>
                </label>
                <label class="diag-edit-field">
                  <span>Player</span>
                  <select v-model="proDiagPlayerSelection[item.id]">
                    <option value="__add_new__">Add New</option>
                    <option
                      v-for="player in knownPlayers"
                      :key="`edit-player-${item.id}-${player.name}`"
                      :value="player.name"
                    >
                      {{ player.handedness ? `${player.name} (${player.handedness})` : player.name }}
                    </option>
                  </select>
                </label>
                <template v-if="proDiagPlayerSelection[item.id] === '__add_new__'">
                  <label class="diag-edit-field">
                    <span>New player name</span>
                    <input
                      type="text"
                      :value="proDiagNewPlayerName[item.id] || ''"
                      @input="proDiagNewPlayerName[item.id] = $event.target.value"
                      placeholder="Player name"
                    />
                  </label>
                  <label class="diag-edit-field">
                    <span>New player handedness</span>
                    <select v-model="proDiagNewPlayerHandedness[item.id]">
                      <option value="right">right</option>
                      <option value="left">left</option>
                    </select>
                  </label>
                </template>
                <label class="diag-edit-field">
                  <span>Ground truth frame</span>
                  <div class="diag-edit-ground-row">
                    <input
                      type="number"
                      min="0"
                      step="1"
                      :value="proDiagEditDraft[item.id].groundTruthFrame"
                      @input="proDiagEditDraft[item.id].groundTruthFrame = $event.target.value"
                      placeholder="Ground truth frame"
                    />
                    <button type="button" @click="setEditGroundTruthFromCurrent(item)">
                      Use Current Frame
                    </button>
                  </div>
                </label>
                <label class="diag-edit-checkbox">
                  <input
                    type="checkbox"
                    :checked="Boolean(proDiagEditDraft[item.id].lowFpsAmbiguous)"
                    @change="proDiagEditDraft[item.id].lowFpsAmbiguous = Boolean($event.target.checked)"
                  />
                  Low-FPS ambiguous contact window
                </label>
              </div>
              <div class="row manual-actions" style="margin-top: 8px;">
                <button
                  :disabled="Boolean(proDiagEditBusy[item.id])"
                  @click="saveDiagVideoEdits(item)"
                >
                  {{ proDiagEditBusy[item.id] ? 'Saving...' : 'Save Edits' }}
                </button>
                <button
                  :disabled="Boolean(proDiagEditBusy[item.id])"
                  @click="cancelDiagEditMode(item)"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
          <div v-else class="diag-lazy-placeholder">
            <div class="small">Lazy load active. Scroll this clip into view to initialize video, tracks, and timeline.</div>
            <button type="button" @click="activateDiagLazyItem(item.id, { pin: true })">Load now</button>
          </div>
      </div>
    </section>
    </template>

    <template v-else-if="activePage === 'user_detection'">
    <section class="card">
      <h2>User Detection Lab</h2>
      <p class="small">
        Validate extracted user clips with overlay debugging and ground truth labels.
      </p>
      <div class="row diag-filter-row">
        <div class="diag-filter-field">
          <label>Sort by</label>
          <select v-model="userDetSort">
            <option value="set_asc">set (ascending)</option>
            <option value="set_desc">set (descending)</option>
            <option value="date_added_asc">date added (ascending)</option>
            <option value="date_added_desc">date added (descending)</option>
            <option value="error_asc">error (ascending)</option>
            <option value="error_desc">error (descending)</option>
            <option value="confidence_asc">confidence (ascending)</option>
            <option value="confidence_desc">confidence (descending)</option>
          </select>
        </div>
        <div class="diag-filter-field">
          <label>Has Contact</label>
          <select v-model="userDetFilterHasContact">
            <option value="all">all</option>
            <option value="none">none</option>
            <option value="single">single</option>
            <option value="multiple">multiple</option>
            <option value="unknown">unknown</option>
          </select>
        </div>
      </div>
      <p v-if="userDetectionLoading" class="small">Loading user detection clips...</p>
      <p v-if="userDetectionError" class="error">{{ userDetectionError }}</p>
      <div v-if="!userDetectionLoading && !userDetectionItems.length" class="small">No extracted user clips yet.</div>
      <div v-else-if="!userDetectionLoading && !sortedUserDetectionItems.length" class="small">No clips in current filter.</div>
      <div
        v-for="item in sortedUserDetectionItems"
        :key="item.id"
        class="session"
        :ref="(el) => setUserDetCardRef(item.id, el)"
        :data-user-det-id="item.id"
        style="display: grid; gap: 8px;"
      >
        <div :class="['row', 'diag-title-row', 'cinema']">
          <strong class="diag-title-main">{{ item.clipFileName }}</strong>
          <span class="small" :class="Number.isFinite(getUserDetAbsError(item)) ? getFrameErrorSeverityClass(getUserDetAbsError(item)) : 'metric-missing-warning'">
            {{
              Number.isFinite(getUserDetAbsError(item))
                ? `Error: ${Math.round(getUserDetAbsError(item))}`
                : 'Warning: ground truth missing'
            }}
          </span>
        </div>
        <div class="small">
          source: {{ item.sourceFileName }} |
          detected frame: {{ Number.isFinite(getUserDetDetectedFrame(item)) ? getUserDetDetectedFrame(item) : 'n/a' }} |
          confidence: {{ Number(item.detectedConfidence || 0).toFixed(3) }} |
          handedness: {{ item.detectedHandedness || 'n/a' }}
        </div>
        <template v-if="isUserDetLazyActive(item.id)">
        <div class="diag-video-wrap">
          <div class="diag-overlay-badge small">
            <div class="overlay-left">
              <span class="overlay-toggle-row">
                <button
                  type="button"
                  :class="['overlay-toggle-btn', 'overlay-pill-video', getUserDetOverlayPrefs(item.id).video ? 'overlay-on' : 'overlay-off']"
                  @click="toggleUserDetOverlay(item, 'video')"
                >
                  video
                </button>
              </span>
              <span class="overlay-toggle-row">
                <button
                  type="button"
                  :class="['overlay-toggle-btn', 'overlay-pill-ball', getUserDetOverlayPrefs(item.id).ball ? 'overlay-on' : 'overlay-off']"
                  @click="toggleUserDetOverlay(item, 'ball')"
                >
                  ball
                </button>
              </span>
              <span class="overlay-toggle-row">
                <button
                  type="button"
                  :class="['overlay-toggle-btn', 'overlay-pill-racket', getUserDetOverlayPrefs(item.id).racket ? 'overlay-on' : 'overlay-off']"
                  @click="toggleUserDetOverlay(item, 'racket')"
                >
                  wrist
                </button>
              </span>
              <span class="overlay-toggle-row">
                <button
                  type="button"
                  :class="['overlay-toggle-btn', 'overlay-pill-pose', getUserDetOverlayPrefs(item.id).pose ? 'overlay-on' : 'overlay-off']"
                  @click="toggleUserDetOverlay(item, 'pose')"
                >
                  pose
                </button>
              </span>
            </div>
            <div class="overlay-right">
              <span>frame {{ userDetOverlayStats[item.id]?.frame ?? 0 }}</span>
            </div>
          </div>
          <div class="diag-media user-det-media">
            <video
              :ref="(el) => setUserDetVideoRef(item.id, el)"
              class="user-det-video"
              :class="{ 'diag-video-hidden': !getUserDetOverlayPrefs(item.id).video }"
              :src="item.videoPublicUrl"
              preload="metadata"
              playsinline
              @loadedmetadata="onUserDetLoaded(item)"
              @timeupdate="onUserDetTimeUpdate(item)"
              @seeked="onUserDetSeeked(item)"
              @play="onUserDetPlay(item)"
              @pause="onUserDetPause(item)"
              @ended="onUserDetPause(item)"
            />
            <canvas :ref="(el) => setUserDetCanvasRef(item.id, el)" class="diag-overlay user-det-overlay" />
          </div>
        </div>
        <div class="timeline-shell">
          <div class="timeline-meta">
            <span>{{ formatTime(userDetTimes[item.id] || 0) }} ({{ getUserDetCurrentFrameDisplay(item) }})</span>
            <span>{{ formatTime(getUserDetDuration(item)) }} ({{ getUserDetMaxFrameDisplay(item) }})</span>
          </div>
          <div class="row timeline-actions" style="margin-bottom: 6px;">
            <div class="row timeline-action-group">
              <button type="button" class="icon-btn" :aria-label="userDetPlaying[item.id] ? 'Pause' : 'Play'" @click="toggleUserDetPlay(item)">
                <svg v-if="!userDetPlaying[item.id]" class="icon-svg" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5L13 8L4 13.5V2.5z" /></svg>
                <svg v-else class="icon-svg" viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="2.5" width="3.5" height="11" rx="0.5" /><rect x="9" y="2.5" width="3.5" height="11" rx="0.5" /></svg>
              </button>
              <button type="button" class="icon-btn" :aria-label="getUserDetMuted(item) ? 'Unmute' : 'Mute'" @click="toggleUserDetMute(item)">
                <svg v-if="getUserDetMuted(item)" class="icon-svg" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 6.5h3L9.5 3v10l-4-3.5h-3z" /><path d="M11.2 6.1l3.1 3.1M14.3 6.1l-3.1 3.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none" /></svg>
                <svg v-else class="icon-svg" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 6.5h3L9.5 3v10l-4-3.5h-3z" /><path d="M11.2 6.1a2.2 2.2 0 010 3.8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /><path d="M12.8 4.6a4.2 4.2 0 010 6.8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /></svg>
              </button>
              <input class="volume-slider" type="range" min="0" max="1" step="0.01" :value="getUserDetVolumeValue(item)" @input="onUserDetVolumeInput(item, $event)" />
            </div>
            <div class="row frame-controls">
              <button aria-label="Previous frame" @click="stepUserDetFrame(item, -1)">&lt;</button>
              <button aria-label="Next frame" @click="stepUserDetFrame(item, 1)">&gt;</button>
            </div>
          </div>
          <div class="timeline-lanes">
            <button
              v-if="hasUserDetGroundTruth(item) && getUserDetDuration(item) > 0"
              class="event-marker event-ground"
              :style="{ left: timelineLeftFromPercent((Number(getUserDetGroundTruthFrame(item) || 0) / Math.max(1, getUserDetMaxFrameDisplay(item))) * 100) }"
              :title="`Ground truth @ frame ${Math.round(Number(getUserDetGroundTruthFrame(item) || 0))}`"
              @click="onUserDetScrub(item, { target: { value: Number(getUserDetGroundTruthFrame(item) || 0) / Math.max(1, getUserDetStepFps(item)) } })"
            >
              <span class="event-dot" />
            </button>
            <button
              v-if="Number.isFinite(getUserDetDetectedFrame(item)) && getUserDetDuration(item) > 0"
              class="event-marker event-pro"
              :style="{ left: timelineLeftFromPercent((Number(getUserDetDetectedFrame(item) || 0) / Math.max(1, getUserDetMaxFrameDisplay(item))) * 100) }"
              :title="`Detected @ frame ${Math.round(Number(getUserDetDetectedFrame(item) || 0))}`"
              @click="onUserDetScrub(item, { target: { value: Number(getUserDetDetectedFrame(item) || 0) / Math.max(1, getUserDetStepFps(item)) } })"
            >
              <span class="event-dot" />
            </button>
            <div class="timeline-control" :style="{ '--progress-ratio': `${getUserDetProgressRatio(item)}` }">
              <div class="timeline-bar"><div class="timeline-fill" /></div>
              <input class="timeline" type="range" min="0" :max="getUserDetDuration(item)" step="any" :value="userDetTimes[item.id] || 0" @input="onUserDetScrub(item, $event)" />
            </div>
          </div>
        </div>
        <div class="row manual-actions">
          <input
            type="number"
            min="0"
            step="1"
            :value="userDetGroundTruthInput[item.id] ?? ''"
            @input="userDetGroundTruthInput[item.id] = $event.target.value"
            placeholder="Ground truth frame"
            style="max-width: 170px;"
          />
          <button type="button" @click="setUserDetGroundTruthFromCurrent(item)">Use Current Frame</button>
          <select v-model="userDetHasContactInput[item.id]" style="max-width: 170px;">
            <option value="unknown">hasContact: unknown</option>
            <option value="none">hasContact: none</option>
            <option value="single">hasContact: single</option>
            <option value="multiple">hasContact: multiple</option>
          </select>
          <button :disabled="Boolean(userDetSaveBusy[item.id])" @click="saveUserDetLabel(item)">
            {{ userDetSaveBusy[item.id] ? 'Saving...' : 'Save Label' }}
          </button>
        </div>
        </template>
        <div v-else class="diag-lazy-placeholder">
          <div class="small">Lazy load active. Scroll this clip into view to initialize video, tracks, and timeline.</div>
          <button type="button" @click="activateUserDetLazyItem(item.id, { pin: true })">Load now</button>
        </div>
      </div>
    </section>
    </template>

    <template v-else-if="activePage === 'user_videos'">
    <section class="card">
      <h2>User Video Management</h2>
      <p class="small">
        Upload a longer user video, scan for likely serve contacts, and auto-extract per-serve clips
        using a 2-pass flow (quick window scan + focused extraction).
      </p>
      <div class="row">
        <div>
          <label>Long video file</label>
          <input
            type="file"
            accept="video/mp4,video/quicktime,video/webm,.m4v,.mkv"
            @change="onUserVideoFileChange"
          />
          <div v-if="userVideoFile" class="small" style="margin-top: 4px;">
            Selected: {{ userVideoFile.name }} ({{ formatBytes(userVideoOriginalBytes) }})
            <span v-if="userVideoCompressedBytes > 0">
              -> compressed {{ formatBytes(userVideoCompressedBytes) }}
            </span>
          </div>
          <label class="small" style="display: inline-flex; align-items: center; gap: 6px; margin-top: 8px;">
            <input type="checkbox" v-model="userVideoCompressEnabled" />
            Compress before upload (recommended)
          </label>
          <div class="small" style="margin-top: 4px;">
            {{
              supportsClientVideoCompression()
                ? 'Client-side compression available'
                : 'Client-side compression unavailable in this browser (will upload original)'
            }}
          </div>
        </div>
        <div>
          <label>&nbsp;</label>
          <button :disabled="userVideoBusy" @click="submitUserVideoScan">
            {{ userVideoBusy ? 'Scanning & Extracting...' : 'Scan And Extract Serve Clips' }}
          </button>
        </div>
      </div>
      <p v-if="userVideoInfo" class="small">{{ userVideoInfo }}</p>
      <div v-if="userVideoCompressStatus" class="small" style="margin-top: 8px;">
        {{ userVideoCompressStatus }}
      </div>
      <div v-if="userVideoCompressProgress !== null" class="small" style="margin-top: 6px;">
        <progress :value="userVideoCompressProgress" max="1" style="width: 100%;"></progress>
      </div>
      <p v-if="userVideoError" class="error">{{ userVideoError }}</p>
    </section>

    <section class="card">
      <h2>Processing Jobs</h2>
      <div v-if="!userVideoJobs.length" class="small">No jobs yet.</div>
      <div v-for="job in userVideoJobs" :key="job.jobId" class="session" style="display: grid; gap: 6px;">
        <div class="small">
          Job {{ job.jobId }} |
          status: <strong>{{ job.status }}</strong> |
          file: {{ job.upload?.fileName || 'unknown' }}
        </div>
        <div class="small">
          {{ job.progress?.message || 'No progress yet.' }}
          <span v-if="Number.isFinite(Number(job.progress?.percent))"> ({{ Math.round(Number(job.progress?.percent)) }}%)</span>
        </div>
        <progress
          v-if="Number.isFinite(Number(job.progress?.percent))"
          :value="Math.max(0, Math.min(100, Number(job.progress?.percent)))"
          max="100"
          style="width: 100%;"
        ></progress>
        <div v-if="job.error" class="error">{{ job.error }}</div>
      </div>
    </section>

    <section class="card">
      <h2>Extraction Runs</h2>
      <div v-if="!userVideoEntries.length" class="small">No user video runs yet.</div>
      <div v-for="entry in userVideoEntries" :key="entry.id" class="session" style="display: grid; gap: 8px;">
        <div class="row" style="justify-content: space-between; align-items: flex-start; gap: 12px;">
          <div>
            <strong>{{ entry.sourceFileName }}</strong>
            <div class="small">
              {{ entry.createdAt }} | source duration: {{ Number(entry.sourceDurationSec || 0).toFixed(2) }}s |
              windows scanned: {{ entry.candidateWindowsScanned || 0 }} |
              contacts found: {{ entry.candidateContactsFound || 0 }}
            </div>
          </div>
        </div>

        <div v-if="!Array.isArray(entry.extractedClips) || !entry.extractedClips.length" class="small">
          No clips extracted for this run.
        </div>
        <div v-else style="display: grid; gap: 10px;">
          <div
            v-for="clip in entry.extractedClips"
            :key="clip.id"
            class="session"
            :ref="(el) => setUserClipCardRef(userClipKey(entry.id, clip.id), el)"
            :data-user-clip-key="userClipKey(entry.id, clip.id)"
            style="display: grid; gap: 6px;"
          >
            <div class="small">
              <strong>{{ clip.fileName }}</strong> |
              clip: {{ Number(clip.clipStartSec || 0).toFixed(2) }}s - {{ Number(clip.clipEndSec || 0).toFixed(2) }}s |
              contact: {{ Number(getUserClipDetectedContactSec(clip) || 0).toFixed(2) }}s |
              frame: {{ getUserClipDetectedFrame(entry, clip) ?? 'n/a' }} |
              conf: {{ Number(clip.detectedConfidence || 0).toFixed(3) }} |
              hand: {{ clip.detectedHandedness || 'n/a' }}
            </div>
            <template v-if="isUserClipLazyActive(userClipKey(entry.id, clip.id))">
              <video
                :ref="(el) => setUserClipVideoRef(userClipKey(entry.id, clip.id), el)"
                class="user-clip-video"
                :src="clip.publicUrl"
                preload="metadata"
                playsinline
                @loadedmetadata="onUserClipLoaded(entry, clip)"
                @timeupdate="onUserClipTimeUpdate(entry, clip)"
                @play="onUserClipPlay(entry, clip)"
                @pause="onUserClipPause(entry, clip)"
                @ended="onUserClipPause(entry, clip)"
              />
              <div class="timeline-shell">
                <div class="timeline-meta">
                  <span>
                    {{ formatTime(userClipTimes[userClipKey(entry.id, clip.id)] || 0) }}
                    ({{ getUserClipCurrentFrameDisplay(entry, userClipKey(entry.id, clip.id)) }})
                  </span>
                  <span>
                    {{ formatTime(getUserClipDuration(userClipKey(entry.id, clip.id))) }}
                    ({{ getUserClipMaxFrameDisplay(entry, userClipKey(entry.id, clip.id)) }})
                  </span>
                </div>
                <div class="row timeline-actions" style="margin-bottom: 6px;">
                  <div class="row timeline-action-group">
                    <button
                      type="button"
                      class="icon-btn"
                      :aria-label="userClipPlaying[userClipKey(entry.id, clip.id)] ? 'Pause' : 'Play'"
                      @click="toggleUserClipPlay(entry, clip)"
                    >
                      <svg v-if="!userClipPlaying[userClipKey(entry.id, clip.id)]" class="icon-svg" viewBox="0 0 16 16" aria-hidden="true">
                        <path d="M4 2.5L13 8L4 13.5V2.5z" />
                      </svg>
                      <svg v-else class="icon-svg" viewBox="0 0 16 16" aria-hidden="true">
                        <rect x="3.5" y="2.5" width="3.5" height="11" rx="0.5" />
                        <rect x="9" y="2.5" width="3.5" height="11" rx="0.5" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      class="icon-btn"
                      :aria-label="getUserClipMuted(userClipKey(entry.id, clip.id)) ? 'Unmute' : 'Mute'"
                      @click="toggleUserClipMute(entry, clip)"
                    >
                      <svg v-if="getUserClipMuted(userClipKey(entry.id, clip.id))" class="icon-svg" viewBox="0 0 16 16" aria-hidden="true">
                        <path d="M2.5 6.5h3L9.5 3v10l-4-3.5h-3z" />
                        <path d="M11.2 6.1l3.1 3.1M14.3 6.1l-3.1 3.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none" />
                      </svg>
                      <svg v-else class="icon-svg" viewBox="0 0 16 16" aria-hidden="true">
                        <path d="M2.5 6.5h3L9.5 3v10l-4-3.5h-3z" />
                        <path d="M11.2 6.1a2.2 2.2 0 010 3.8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                        <path d="M12.8 4.6a4.2 4.2 0 010 6.8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                      </svg>
                    </button>
                    <input
                      class="volume-slider"
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      :value="getUserClipVolumeValue(userClipKey(entry.id, clip.id))"
                      @input="onUserClipVolumeInput(entry, clip, $event)"
                    />
                  </div>
                  <div class="row frame-controls">
                    <button aria-label="Previous frame" @click="stepUserClipFrame(entry, clip, -1)">&lt;</button>
                    <button aria-label="Next frame" @click="stepUserClipFrame(entry, clip, 1)">&gt;</button>
                  </div>
                </div>
                <div class="timeline-lanes">
                  <button
                    v-if="Number.isFinite(Number(getUserClipDetectedContactSec(clip))) && getUserClipDuration(userClipKey(entry.id, clip.id)) > 0"
                    class="event-marker event-pro"
                    :style="{ left: timelineLeftFromPercent((Number(getUserClipDetectedContactSec(clip) || 0) / Math.max(0.0001, getUserClipDuration(userClipKey(entry.id, clip.id)))) * 100) }"
                    :title="`Detected contact @ ${formatTime(Number(getUserClipDetectedContactSec(clip) || 0))}`"
                    @click="onUserClipScrub(entry, clip, { target: { value: Number(getUserClipDetectedContactSec(clip) || 0) } })"
                  >
                    <span class="event-dot" />
                  </button>
                  <div class="timeline-control" :style="{ '--progress-ratio': `${getUserClipProgressRatio(userClipKey(entry.id, clip.id))}` }">
                    <div class="timeline-bar">
                      <div class="timeline-fill" />
                    </div>
                    <input
                      class="timeline"
                      type="range"
                      min="0"
                      :max="getUserClipDuration(userClipKey(entry.id, clip.id))"
                      step="any"
                      :value="userClipTimes[userClipKey(entry.id, clip.id)] || 0"
                      @input="onUserClipScrub(entry, clip, $event)"
                    />
                  </div>
                </div>
              </div>
            </template>
            <div v-else class="diag-lazy-placeholder">
              <div class="small">Lazy load active. Scroll this clip into view to initialize video and timeline.</div>
              <button type="button" @click="activateUserClipLazyItem(userClipKey(entry.id, clip.id), { pin: true })">Load now</button>
            </div>
          </div>
        </div>
      </div>
    </section>
    </template>
  </main>
</template>
