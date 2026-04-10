const DEFAULT_VOLUME = 1;
const MIN_VOLUME = 0;
const MAX_VOLUME = 1;
const VOLUME_STORAGE_KEY = "tmusicOverlayVolume";
const MSG_UI_GET_VOLUME = "tmusic:ui-get-volume";
const MSG_UI_SET_VOLUME = "tmusic:ui-set-volume";
const MSG_OFFSCREEN_INIT = "tmusic:offscreen-init-tab-audio";
const MSG_OFFSCREEN_SET = "tmusic:offscreen-set-volume";
const MSG_OFFSCREEN_DESTROY = "tmusic:offscreen-destroy-tab-audio";
const INVOCATION_REQUIRED_ERROR = "Click the extension toolbar icon once on this Twitch tab, then retry volume.";
const tabStates = new Map();

function clampVolume(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_VOLUME;
  }
  return Math.min(MAX_VOLUME, Math.max(MIN_VOLUME, numeric));
}

async function getStoredVolume() {
  try {
    const data = await chrome.storage.local.get(VOLUME_STORAGE_KEY);
    return clampVolume(data[VOLUME_STORAGE_KEY]);
  } catch {
    return DEFAULT_VOLUME;
  }
}

async function setStoredVolume(volume) {
  try {
    await chrome.storage.local.set({ [VOLUME_STORAGE_KEY]: clampVolume(volume) });
  } catch {
    // Ignore storage errors in restricted modes.
  }
}

async function ensureOffscreenDocument() {
  if (!chrome.offscreen || typeof chrome.offscreen.createDocument !== "function") {
    throw new Error("Offscreen API unavailable in this browser version");
  }

  if (typeof chrome.offscreen.hasDocument === "function" && await chrome.offscreen.hasDocument()) {
    return;
  }

  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["AUDIO_PLAYBACK"],
    justification: "Apply user-controlled gain to captured tab audio for overlay volume slider"
  });
}

function getTabState(tabId) {
  if (!tabStates.has(tabId)) {
    tabStates.set(tabId, {
      initialized: false,
      volume: DEFAULT_VOLUME
    });
  }
  return tabStates.get(tabId);
}

function isInvocationRequiredError(error) {
  const message = String(error && error.message ? error.message : error || "").toLowerCase();
  return message.includes("has not been invoked")
    || message.includes("activetab")
    || message.includes("chrome pages cannot be captured");
}

async function ensureTabAudioInitialized(tabId) {
  const state = getTabState(tabId);
  if (state.initialized) {
    return true;
  }

  await ensureOffscreenDocument();

  let streamId;
  try {
    streamId = await chrome.tabCapture.getMediaStreamId({
      targetTabId: tabId
    });
  } catch (error) {
    if (isInvocationRequiredError(error)) {
      throw new Error(INVOCATION_REQUIRED_ERROR);
    }
    throw error;
  }

  const response = await chrome.runtime.sendMessage({
    type: MSG_OFFSCREEN_INIT,
    tabId,
    streamId,
    volume: state.volume
  });

  if (!response || !response.ok) {
    throw new Error(response && response.error ? response.error : "Failed to initialize offscreen audio");
  }

  state.initialized = true;
  return true;
}

async function setVolumeForTab(tabId, volume) {
  const normalized = clampVolume(volume);
  const state = getTabState(tabId);
  state.volume = normalized;

  await setStoredVolume(normalized);
  await ensureTabAudioInitialized(tabId);

  let response = await chrome.runtime.sendMessage({
    type: MSG_OFFSCREEN_SET,
    tabId,
    volume: normalized
  });

  const hasMissingSessionError = response
    && response.ok === false
    && typeof response.error === "string"
    && response.error.toLowerCase().includes("no audio session");

  if (hasMissingSessionError) {
    state.initialized = false;
    await ensureTabAudioInitialized(tabId);
    response = await chrome.runtime.sendMessage({
      type: MSG_OFFSCREEN_SET,
      tabId,
      volume: normalized
    });
  }

  if (!response || !response.ok) {
    throw new Error(response && response.error ? response.error : "Failed to apply volume");
  }

  return normalized;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== "string") {
    return;
  }

  if (message.type === MSG_UI_GET_VOLUME) {
    (async () => {
      const tabId = sender.tab && typeof sender.tab.id === "number" ? sender.tab.id : null;
      const storedVolume = await getStoredVolume();

      if (tabId !== null) {
        const state = getTabState(tabId);
        state.volume = storedVolume;
      }

      sendResponse({ ok: true, volume: storedVolume });
    })().catch((error) => {
      sendResponse({
        ok: false,
        error: error && error.message ? error.message : "Failed to read volume"
      });
    });

    return true;
  }

  if (message.type === MSG_UI_SET_VOLUME) {
    (async () => {
      const tabId = sender.tab && typeof sender.tab.id === "number" ? sender.tab.id : null;
      if (tabId === null) {
        throw new Error("No active tab context for volume command");
      }

      const volume = await setVolumeForTab(tabId, message.volume);
      sendResponse({ ok: true, volume });
    })().catch((error) => {
      sendResponse({
        ok: false,
        error: error && error.message ? error.message : "Failed to set volume"
      });
    });

    return true;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabStates.delete(tabId);
  chrome.runtime.sendMessage({
    type: MSG_OFFSCREEN_DESTROY,
    tabId
  }).catch(() => {
    // Offscreen document may not be active.
  });
});

chrome.action.onClicked.addListener((tab) => {
  if (!tab || typeof tab.id !== "number") {
    return;
  }

  const tabId = tab.id;
  const state = getTabState(tabId);

  ensureTabAudioInitialized(tabId).catch(() => {
    state.initialized = false;
  });
});
