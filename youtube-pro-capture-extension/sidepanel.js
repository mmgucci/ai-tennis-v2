const BACKEND_BASE = "http://localhost:3000";

const els = {
  form: document.getElementById("capture-form"),
  status: document.getElementById("status"),
  result: document.getElementById("result"),
  refreshBtn: document.getElementById("refresh-btn"),
  captureStartBtn: document.getElementById("capture-start-btn"),
  captureEndBtn: document.getElementById("capture-end-btn"),
  saveBtn: document.getElementById("save-btn"),
  youtubeUrl: document.getElementById("youtube-url"),
  title: document.getElementById("title"),
  startTime: document.getElementById("start-time"),
  endTime: document.getElementById("end-time"),
  strokeType: document.getElementById("stroke-type"),
  handedness: document.getElementById("handedness"),
  playerChoice: document.getElementById("player-choice"),
  newPlayerFields: document.getElementById("new-player-fields"),
  newPlayerName: document.getElementById("new-player-name"),
  evaluationSet: document.getElementById("evaluation-set"),
  cameraAngle: document.getElementById("camera-angle"),
  courtSide: document.getElementById("court-side"),
};

let activeTabIsYouTube = false;
let knownPlayers = [];

function setResult(message, kind = "") {
  els.result.textContent = message;
  els.result.className = `result ${kind}`.trim();
}

function setFormEnabled(enabled) {
  for (const el of Object.values(els)) {
    if (!el) continue;
    if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLButtonElement) {
      if (el.id === "youtube-url") {
        el.readOnly = !enabled;
      } else {
        el.disabled = !enabled;
      }
    }
  }
  els.refreshBtn.disabled = false;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

function extractPageContext() {
  const titleEl = document.querySelector("h1 yt-formatted-string");
  const rawTitle = (titleEl?.textContent || document.title || "").replace(/\s+-\s+YouTube$/i, "").trim();
  const videoEl = document.querySelector("video");
  const currentTime = Number(videoEl?.currentTime || 0);
  return {
    href: window.location.href,
    title: rawTitle,
    currentTime: Number.isFinite(currentTime) ? currentTime : null,
  };
}

async function getYouTubeContextFromTab() {
  const tab = await getActiveTab();
  if (!tab?.id) return null;
  const url = String(tab.url || "");
  if (!url.includes("youtube.com")) return null;
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: extractPageContext,
  });
  return results?.[0]?.result || null;
}

function roundMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return "";
  return String(Math.round(n * 1000) / 1000);
}

function normalizePlayerName(raw) {
  return String(raw || "").trim().replace(/\s+/g, " ").slice(0, 120);
}

function normalizeHandedness(raw) {
  const v = String(raw || "").trim().toLowerCase();
  return (v === "left" || v === "right") ? v : null;
}

function deriveKnownPlayersFromVideoItems(items) {
  const byName = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const name = normalizePlayerName(item?.playerName);
    if (!name) continue;
    const handedness = normalizeHandedness(item?.handedness);
    if (!byName.has(name)) {
      byName.set(name, { name, leftCount: 0, rightCount: 0, latestHandedness: handedness });
    }
    const acc = byName.get(name);
    if (handedness === "left") acc.leftCount += 1;
    if (handedness === "right") acc.rightCount += 1;
    if (handedness) acc.latestHandedness = handedness;
  }
  return Array.from(byName.values())
    .map((acc) => {
      let handedness = null;
      if (acc.leftCount > acc.rightCount) handedness = "left";
      else if (acc.rightCount > acc.leftCount) handedness = "right";
      else handedness = acc.latestHandedness || null;
      return { name: acc.name, handedness };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function renderKnownPlayers() {
  const selected = normalizePlayerName(els.playerChoice.value);
  while (els.playerChoice.options.length > 0) {
    els.playerChoice.remove(0);
  }
  const addNew = document.createElement("option");
  addNew.value = "__add_new__";
  addNew.textContent = "Add New";
  els.playerChoice.appendChild(addNew);
  for (const player of knownPlayers) {
    const option = document.createElement("option");
    option.value = player.name;
    option.textContent = player.handedness ? `${player.name} (${player.handedness})` : player.name;
    els.playerChoice.appendChild(option);
  }
  els.playerChoice.value = knownPlayers.some((p) => p.name === selected) ? selected : "__add_new__";
  updatePlayerModeUI();
}

function applyPlayerHandednessSelection() {
  const selected = normalizePlayerName(els.playerChoice.value);
  if (!selected || selected === "__add_new__") return;
  const match = knownPlayers.find((p) => p.name === selected);
  const handedness = normalizeHandedness(match?.handedness);
  if (handedness) {
    els.handedness.value = handedness;
  }
}

function updatePlayerModeUI() {
  const selected = String(els.playerChoice.value || "__add_new__");
  const isAddNew = selected === "__add_new__";
  if (els.newPlayerFields) {
    els.newPlayerFields.style.display = isAddNew ? "" : "none";
  }
  if (!isAddNew) {
    els.newPlayerName.value = "";
  }
}

async function loadKnownPlayers() {
  try {
    const res = await fetch(`${BACKEND_BASE}/api/pro-videos`);
    const data = await res.json();
    if (!res.ok) return;
    knownPlayers = deriveKnownPlayersFromVideoItems(data?.items || []);
    renderKnownPlayers();
    applyPlayerHandednessSelection();
  } catch {
    // Ignore; extension can still save without this convenience data.
  }
}

function applyKnownPlayersFromResponse(data) {
  if (!Array.isArray(data?.knownPlayers)) return;
  const mapped = data.knownPlayers
    .map((p) => ({
      name: normalizePlayerName(p?.name),
      handedness: normalizeHandedness(p?.handedness),
    }))
    .filter((p) => Boolean(p.name));
  const dedup = new Map();
  for (const p of mapped) dedup.set(p.name, p);
  knownPlayers = Array.from(dedup.values()).sort((a, b) => a.name.localeCompare(b.name));
  renderKnownPlayers();
  applyPlayerHandednessSelection();
}

async function refreshFromTab() {
  try {
    const context = await getYouTubeContextFromTab();
    activeTabIsYouTube = Boolean(context?.href);
    if (!activeTabIsYouTube) {
      els.status.textContent = "Active tab is not youtube.com. Open a YouTube video tab and try again.";
      setFormEnabled(false);
      return;
    }

    els.status.textContent = "Connected to active YouTube tab.";
    setFormEnabled(true);
    // Always keep URL aligned with current active page.
    els.youtubeUrl.value = context.href || "";
    // Keep title synced as default value on navigation.
    els.title.value = context.title || "";
  } catch (err) {
    els.status.textContent = `Failed reading tab context: ${String(err?.message || err)}`;
    setFormEnabled(false);
  }
}

async function refreshAll() {
  await Promise.all([refreshFromTab(), loadKnownPlayers()]);
}

async function captureCurrentTime(target) {
  try {
    const context = await getYouTubeContextFromTab();
    if (!context) {
      setResult("Could not read current YouTube time.", "err");
      return;
    }
    const value = roundMs(context.currentTime);
    if (target === "start") {
      els.startTime.value = value;
    } else {
      els.endTime.value = value;
    }
    if (context.href) {
      els.youtubeUrl.value = context.href;
    }
    if (!els.title.value.trim() && context.title) {
      els.title.value = context.title;
    }
    setResult(`Captured ${target} time: ${value}s`, "ok");
  } catch (err) {
    setResult(`Failed to capture time: ${String(err?.message || err)}`, "err");
  }
}

async function saveEntry() {
  const selectedPlayerName = normalizePlayerName(els.playerChoice.value);
  const newPlayerName = normalizePlayerName(els.newPlayerName.value);
  const isAddNew = selectedPlayerName === "__add_new__";
  const finalPlayerName = isAddNew ? newPlayerName : selectedPlayerName;
  if (isAddNew && !finalPlayerName) {
    setResult("Please enter a new player name.", "err");
    return;
  }
  const knownHand = knownPlayers.find((p) => p.name === finalPlayerName)?.handedness || null;
  const finalHandedness = normalizeHandedness(isAddNew ? els.handedness.value : knownHand) || "right";
  const payload = {
    youtubeUrl: els.youtubeUrl.value.trim(),
    title: els.title.value.trim(),
    startTime: Number(els.startTime.value),
    endTime: Number(els.endTime.value),
    strokeType: els.strokeType.value,
    handedness: finalHandedness,
    playerName: finalPlayerName || null,
    evaluationSet: els.evaluationSet.value,
    cameraAngle: els.cameraAngle.value,
    courtSide: els.courtSide.value,
  };

  setResult("Saving...", "");
  try {
    const res = await fetch(`${BACKEND_BASE}/api/debug/pro-videos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data?.ok) {
      throw new Error(data?.message || data?.error || "Save failed");
    }
    applyKnownPlayersFromResponse(data);
    if (newPlayerName && isAddNew) {
      els.playerChoice.value = newPlayerName;
      els.newPlayerName.value = "";
    }
    updatePlayerModeUI();
    applyPlayerHandednessSelection();
    const jobId = data?.processingJob?.jobId;
    setResult(
      `Saved as id: ${data.item.id}${jobId ? ` | background job: ${jobId}` : ""}`,
      "ok"
    );
  } catch (err) {
    setResult(`Save failed: ${String(err?.message || err)}`, "err");
  }
}

els.refreshBtn.addEventListener("click", refreshAll);
els.captureStartBtn.addEventListener("click", () => captureCurrentTime("start"));
els.captureEndBtn.addEventListener("click", () => captureCurrentTime("end"));
els.playerChoice.addEventListener("change", () => {
  updatePlayerModeUI();
  applyPlayerHandednessSelection();
});
els.form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!activeTabIsYouTube) {
    setResult("Open a YouTube tab first.", "err");
    return;
  }
  await saveEntry();
});

chrome.tabs.onActivated.addListener(async () => {
  await refreshFromTab();
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!tab?.active) return;
  if (!changeInfo.url && changeInfo.status !== "complete") return;
  await refreshFromTab();
});

// Keep player options in sync with backend edits made outside the extension (e.g. Lab UI).
window.addEventListener("focus", () => {
  loadKnownPlayers();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    loadKnownPlayers();
  }
});
setInterval(() => {
  if (document.visibilityState === "visible") {
    loadKnownPlayers();
  }
}, 15000);

refreshAll();
