(() => {
  const ROOT_ID = "tmusic-root";
  const BUTTON_ID = "tmusic-toggle";
  const FULLSCREEN_BUTTON_ID = "tmusic-fs-toggle";
  const PANEL_ID = "tmusic-panel";
  const CLOSE_ID = "tmusic-close";
  const FRAME_ID = "tmusic-frame";
  const OPEN_SPOTIFY_LINK_ID = "tmusic-open-spotify";
  const SETTINGS_TOGGLE_ID = "tmusic-settings-toggle";
  const SETTINGS_PANEL_ID = "tmusic-settings-panel";
  const SETTINGS_INPUT_ID = "tmusic-settings-input";
  const SETTINGS_SAVE_ID = "tmusic-settings-save";
  const SETTINGS_RESET_ID = "tmusic-settings-reset";
  const SETTINGS_STATUS_ID = "tmusic-settings-status";
  const SETTINGS_PRESET_NAME_ID = "tmusic-settings-preset-name";
  const SETTINGS_PRESET_ADD_ID = "tmusic-settings-preset-add";
  const SETTINGS_PRESETS_LIST_ID = "tmusic-settings-presets-list";
  const VOLUME_SLIDER_ID = "tmusic-volume-slider";
  const VOLUME_VALUE_ID = "tmusic-volume-value";
  const MSG_UI_GET_VOLUME = "tmusic:ui-get-volume";
  const MSG_UI_SET_VOLUME = "tmusic:ui-set-volume";
  const VOLUME_MIN = 0;
  const VOLUME_MAX = 100;
  const VOLUME_DEFAULT = 100;
  const VOLUME_FEEDBACK_DEFAULT_TEXT = "Le slider ajuste le son lu dans ce panneau";
  const DEFAULT_PLAYLIST_ID = "41T9KGwH5FRbiQAKeTNMTb";
  const PLAYLIST_ID_STORAGE_KEY = "tmusicPlaylistId";
  const PLAYLIST_INPUT_STORAGE_KEY = "tmusicPlaylistInput";
  const PLAYLIST_PRESETS_STORAGE_KEY = "tmusicPlaylistPresets";
  const MAX_PLAYLIST_PRESETS = 8;
  const FULLSCREEN_UI_IDLE_MS = 2200;
  const PANEL_POSITION_STORAGE_KEY = "tmusic-panel-position-v1";
  const PANEL_EDGE_MARGIN = 12;
  const CHAT_TOGGLE_SELECTORS = [
    'button.ScCoreButton-sc-ocjdkq-0.glPhvE.ScButtonIcon-sc-9yap0r-0.dgVYJo',
    'button.ScCoreButton-sc-ocjdkq-0.ScButtonIcon-sc-9yap0r-0',
    'button[class*="ScCoreButton-sc-ocjdkq-0"][class*="ScButtonIcon-sc-9yap0r-0"]',
    'button[data-a-target="right-column__toggle-collapse-btn"]',
    'button[data-a-target="right-column__toggle-collapse-button"]',
    'button[data-a-target="right-column__toggle-visibility-btn"]',
    'button[data-a-target="right-column__toggle-visibility-button"]'
  ];

  let listenersBound = false;
  let updateRaf = 0;
  let fullscreenIdleTimeout = 0;
  let lastFullscreenActivityAt = Date.now();
  let panelDragState = null;
  let volumeSendTimeout = 0;
  let volumeFeedbackTimeout = 0;
  let presetHandlers = {
    onSelectPreset: null,
    onDeletePreset: null
  };
  let playlistState = {
    playlistId: DEFAULT_PLAYLIST_ID,
    playlistInput: `https://open.spotify.com/playlist/${DEFAULT_PLAYLIST_ID}`
  };
  let playlistPresets = [];

  function buildPlaylistEmbedUrl(playlistId) {
    return `https://open.spotify.com/embed/playlist/${playlistId}?utm_source=generator`;
  }

  function buildPlaylistOpenUrl(playlistId) {
    return `https://open.spotify.com/playlist/${playlistId}`;
  }

  function extractPlaylistId(value) {
    if (!value || typeof value !== "string") {
      return null;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const directIdMatch = trimmed.match(/^([a-zA-Z0-9]{22})$/);
    if (directIdMatch) {
      return directIdMatch[1];
    }

    const spotifyUriMatch = trimmed.match(/spotify:playlist:([a-zA-Z0-9]{22})/i);
    if (spotifyUriMatch) {
      return spotifyUriMatch[1];
    }

    const spotifyUrlMatch = trimmed.match(/open\.spotify\.com\/(?:intl-[^/]+\/)?(?:embed\/)?playlist\/([a-zA-Z0-9]{22})/i);
    if (spotifyUrlMatch) {
      return spotifyUrlMatch[1];
    }

    return null;
  }

  function setSettingsStatus(message, isError) {
    const statusNode = document.getElementById(SETTINGS_STATUS_ID);
    if (!statusNode) {
      return;
    }

    statusNode.textContent = message || "";
    statusNode.classList.toggle("tmusic-settings-status-error", Boolean(isError));
  }

  function buildPresetName(rawValue, fallback) {
    const normalized = typeof rawValue === "string"
      ? rawValue.replace(/\s+/g, " ").trim()
      : "";

    if (!normalized) {
      return fallback;
    }

    return normalized.slice(0, 30);
  }

  function createPresetId() {
    return `preset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function applyPlaylistStateToUi(state) {
    if (!state || !state.playlistId) {
      return;
    }

    const frame = document.getElementById(FRAME_ID);
    if (frame) {
      frame.src = buildPlaylistEmbedUrl(state.playlistId);
    }

    const openLink = document.getElementById(OPEN_SPOTIFY_LINK_ID);
    if (openLink) {
      openLink.href = buildPlaylistOpenUrl(state.playlistId);
    }

    const input = document.getElementById(SETTINGS_INPUT_ID);
    if (input && document.activeElement !== input) {
      input.value = state.playlistInput;
    }
  }

  async function savePlaylistState(state) {
    try {
      await chrome.storage.local.set({
        [PLAYLIST_ID_STORAGE_KEY]: state.playlistId,
        [PLAYLIST_INPUT_STORAGE_KEY]: state.playlistInput
      });
    } catch {
      // Ignore storage errors and continue with in-memory state.
    }
  }

  async function savePlaylistPresets() {
    try {
      await chrome.storage.local.set({
        [PLAYLIST_PRESETS_STORAGE_KEY]: playlistPresets
      });
    } catch {
      // Ignore storage errors and continue with in-memory presets.
    }
  }

  async function loadPlaylistPresets() {
    const presets = [];

    try {
      const data = await chrome.storage.local.get(PLAYLIST_PRESETS_STORAGE_KEY);
      const rawPresets = data[PLAYLIST_PRESETS_STORAGE_KEY];
      if (!Array.isArray(rawPresets)) {
        return presets;
      }

      rawPresets.forEach((item, index) => {
        if (!item || typeof item !== "object") {
          return;
        }

        const extractedId = extractPlaylistId(item.playlistId)
          || extractPlaylistId(item.playlistInput);
        if (!extractedId) {
          return;
        }

        const defaultName = `Preset ${index + 1}`;
        const nextName = buildPresetName(item.name, defaultName);
        const nextInput = typeof item.playlistInput === "string" && item.playlistInput.trim()
          ? item.playlistInput.trim()
          : buildPlaylistOpenUrl(extractedId);

        presets.push({
          id: typeof item.id === "string" && item.id ? item.id : createPresetId(),
          name: nextName,
          playlistId: extractedId,
          playlistInput: nextInput
        });
      });
    } catch {
      return presets;
    }

    return presets.slice(0, MAX_PLAYLIST_PRESETS);
  }

  function renderPlaylistPresets() {
    const listNode = document.getElementById(SETTINGS_PRESETS_LIST_ID);
    if (!listNode) {
      return;
    }

    listNode.replaceChildren();

    if (!playlistPresets.length) {
      const emptyNode = document.createElement("div");
      emptyNode.className = "tmusic-presets-empty";
      emptyNode.textContent = "Aucun preset enregistre";
      listNode.appendChild(emptyNode);
      return;
    }

    playlistPresets.forEach((preset) => {
      const itemNode = document.createElement("div");
      itemNode.className = "tmusic-preset-item";
      if (preset.playlistId === playlistState.playlistId) {
        itemNode.classList.add("tmusic-preset-item-active");
      }

      const selectButton = document.createElement("button");
      selectButton.type = "button";
      selectButton.className = "tmusic-preset-select";
      selectButton.textContent = preset.name;
      selectButton.title = preset.playlistInput;

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "tmusic-preset-remove";
      removeButton.setAttribute("aria-label", `Supprimer le preset ${preset.name}`);
      removeButton.textContent = "Suppr";

      if (typeof presetHandlers.onSelectPreset === "function") {
        selectButton.addEventListener("click", () => {
          presetHandlers.onSelectPreset(preset);
        });
      }

      if (typeof presetHandlers.onDeletePreset === "function") {
        removeButton.addEventListener("click", () => {
          presetHandlers.onDeletePreset(preset);
        });
      }

      itemNode.appendChild(selectButton);
      itemNode.appendChild(removeButton);
      listNode.appendChild(itemNode);
    });
  }

  async function loadPlaylistState() {
    let playlistId = DEFAULT_PLAYLIST_ID;
    let playlistInput = buildPlaylistOpenUrl(DEFAULT_PLAYLIST_ID);

    try {
      const data = await chrome.storage.local.get([
        PLAYLIST_ID_STORAGE_KEY,
        PLAYLIST_INPUT_STORAGE_KEY
      ]);

      if (typeof data[PLAYLIST_INPUT_STORAGE_KEY] === "string") {
        const extractedFromInput = extractPlaylistId(data[PLAYLIST_INPUT_STORAGE_KEY]);
        if (extractedFromInput) {
          playlistId = extractedFromInput;
          playlistInput = data[PLAYLIST_INPUT_STORAGE_KEY];
        }
      }

      if (typeof data[PLAYLIST_ID_STORAGE_KEY] === "string") {
        const extractedId = extractPlaylistId(data[PLAYLIST_ID_STORAGE_KEY]);
        if (extractedId) {
          playlistId = extractedId;
          if (!playlistInput) {
            playlistInput = buildPlaylistOpenUrl(extractedId);
          }
        }
      }
    } catch {
      // Keep defaults when storage is unavailable.
    }

    return {
      playlistId,
      playlistInput: playlistInput || buildPlaylistOpenUrl(playlistId)
    };
  }

  async function initializePlaylistState() {
    const loaded = await loadPlaylistState();
    playlistState = loaded;
    playlistPresets = await loadPlaylistPresets();
    applyPlaylistStateToUi(playlistState);
    renderPlaylistPresets();
  }

  function setSettingsPanelOpen(isOpen) {
    const root = document.getElementById(ROOT_ID);
    const panel = document.getElementById(SETTINGS_PANEL_ID);
    const toggleButton = document.getElementById(SETTINGS_TOGGLE_ID);

    if (root) {
      root.classList.toggle("tmusic-settings-open", Boolean(isOpen));
    }

    if (panel) {
      panel.hidden = !isOpen;
    }

    if (toggleButton) {
      toggleButton.setAttribute("aria-expanded", String(Boolean(isOpen)));
    }

    if (!isOpen) {
      setSettingsStatus("", false);
    }
  }

  function clampVolumePercent(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return VOLUME_DEFAULT;
    }

    return Math.min(VOLUME_MAX, Math.max(VOLUME_MIN, Math.round(numeric)));
  }

  function setVolumeUi(percent) {
    const slider = document.getElementById(VOLUME_SLIDER_ID);
    const valueNode = document.getElementById(VOLUME_VALUE_ID);
    const clamped = clampVolumePercent(percent);

    if (slider && Number(slider.value) !== clamped) {
      slider.value = String(clamped);
    }

    if (valueNode) {
      valueNode.textContent = `${clamped}%`;
    }
  }

  function getVolumeFailureMessage(error) {
    const raw = String(error && error.message ? error.message : error || "").toLowerCase();

    if (raw.includes("toolbar icon") || raw.includes("has not been invoked") || raw.includes("activetab")) {
      return "Active le volume: clique l'icone extension (barre Chrome), puis reessaie.";
    }

    if (raw.includes("chrome pages cannot be captured")) {
      return "Capture audio impossible sur cette page.";
    }

    return "Volume indisponible. Recharge l'extension puis la page Twitch.";
  }

  async function sendVolumeToBackground(percent) {
    const normalized = clampVolumePercent(percent) / 100;

    try {
      const response = await chrome.runtime.sendMessage({
        type: MSG_UI_SET_VOLUME,
        volume: normalized
      });

      if (!response || !response.ok) {
        throw new Error(response && response.error ? response.error : "Volume command rejected");
      }
    } catch (error) {
      const footerText = document.querySelector(".tmusic-footer-text");
      if (footerText) {
        if (volumeFeedbackTimeout) {
          window.clearTimeout(volumeFeedbackTimeout);
          volumeFeedbackTimeout = 0;
        }

        footerText.textContent = getVolumeFailureMessage(error);
        footerText.style.color = "#ff8080";

        volumeFeedbackTimeout = window.setTimeout(() => {
          volumeFeedbackTimeout = 0;
          footerText.textContent = VOLUME_FEEDBACK_DEFAULT_TEXT;
          footerText.style.removeProperty("color");
        }, 3800);
      }

      console.warn("TMusic volume command failed", error);
    }
  }

  function scheduleVolumeUpdate(percent) {
    if (volumeSendTimeout) {
      window.clearTimeout(volumeSendTimeout);
      volumeSendTimeout = 0;
    }

    volumeSendTimeout = window.setTimeout(() => {
      volumeSendTimeout = 0;
      sendVolumeToBackground(percent);
    }, 70);
  }

  async function initializeVolumeState() {
    let startingPercent = VOLUME_DEFAULT;

    try {
      const response = await chrome.runtime.sendMessage({
        type: MSG_UI_GET_VOLUME
      });

      if (response && response.ok && Number.isFinite(response.volume)) {
        startingPercent = clampVolumePercent(response.volume * 100);
      }
    } catch {
      startingPercent = VOLUME_DEFAULT;
    }

    setVolumeUi(startingPercent);
  }

  function loadSavedPanelPosition() {
    try {
      const raw = window.localStorage.getItem(PANEL_POSITION_STORAGE_KEY);
      if (!raw) {
        return null;
      }

      const parsed = JSON.parse(raw);
      if (!parsed || !Number.isFinite(parsed.left) || !Number.isFinite(parsed.top)) {
        return null;
      }

      return {
        left: parsed.left,
        top: parsed.top
      };
    } catch {
      return null;
    }
  }

  function savePanelPosition(left, top) {
    try {
      window.localStorage.setItem(PANEL_POSITION_STORAGE_KEY, JSON.stringify({ left, top }));
    } catch {
      // Ignore storage errors in restricted browsing modes.
    }
  }

  function clampPanelPosition(panel, left, top) {
    const rect = panel.getBoundingClientRect();
    const panelWidth = rect.width || panel.offsetWidth || 420;
    const panelHeight = rect.height || panel.offsetHeight || 520;
    const maxLeft = Math.max(PANEL_EDGE_MARGIN, window.innerWidth - panelWidth - PANEL_EDGE_MARGIN);
    const maxTop = Math.max(PANEL_EDGE_MARGIN, window.innerHeight - panelHeight - PANEL_EDGE_MARGIN);

    return {
      left: Math.min(maxLeft, Math.max(PANEL_EDGE_MARGIN, left)),
      top: Math.min(maxTop, Math.max(PANEL_EDGE_MARGIN, top))
    };
  }

  function applyPanelPosition(panel, left, top, persist) {
    const root = document.getElementById(ROOT_ID);
    if (!panel || !root) {
      return;
    }

    const clamped = clampPanelPosition(panel, left, top);
    panel.style.left = `${Math.round(clamped.left)}px`;
    panel.style.top = `${Math.round(clamped.top)}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
    root.classList.add("tmusic-panel-custom-position");

    if (persist) {
      savePanelPosition(clamped.left, clamped.top);
    }
  }

  function applySavedPanelPosition() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) {
      return;
    }

    const saved = loadSavedPanelPosition();
    if (!saved) {
      return;
    }

    applyPanelPosition(panel, saved.left, saved.top, false);
  }

  function clampSavedPanelIntoViewport() {
    const root = document.getElementById(ROOT_ID);
    const panel = document.getElementById(PANEL_ID);
    if (!root || !panel || !root.classList.contains("tmusic-panel-custom-position")) {
      return;
    }

    const rect = panel.getBoundingClientRect();
    applyPanelPosition(panel, rect.left, rect.top, true);
  }

  function stopPanelDrag(pointerId) {
    if (!panelDragState || (typeof pointerId === "number" && panelDragState.pointerId !== pointerId)) {
      return;
    }

    const panel = document.getElementById(PANEL_ID);
    if (panel) {
      panel.classList.remove("tmusic-dragging");
      const rect = panel.getBoundingClientRect();
      savePanelPosition(rect.left, rect.top);
    }

    panelDragState = null;
    window.removeEventListener("pointermove", onPanelDragMove, true);
    window.removeEventListener("pointerup", onPanelDragEnd, true);
    window.removeEventListener("pointercancel", onPanelDragEnd, true);
  }

  function onPanelDragMove(event) {
    if (!panelDragState || event.pointerId !== panelDragState.pointerId) {
      return;
    }

    const panel = document.getElementById(PANEL_ID);
    if (!panel) {
      return;
    }

    const nextLeft = panelDragState.originLeft + (event.clientX - panelDragState.startX);
    const nextTop = panelDragState.originTop + (event.clientY - panelDragState.startY);
    applyPanelPosition(panel, nextLeft, nextTop, false);
  }

  function onPanelDragEnd(event) {
    stopPanelDrag(event.pointerId);
  }

  function startPanelDrag(event) {
    if (event.button !== 0) {
      return;
    }

    const interactiveTarget = event.target instanceof Element ? event.target.closest("a, button, input, textarea, select") : null;
    if (interactiveTarget) {
      return;
    }

    const panel = document.getElementById(PANEL_ID);
    if (!panel) {
      return;
    }

    const rect = panel.getBoundingClientRect();
    applyPanelPosition(panel, rect.left, rect.top, false);
    panel.classList.add("tmusic-dragging");

    panelDragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originLeft: rect.left,
      originTop: rect.top
    };

    window.addEventListener("pointermove", onPanelDragMove, true);
    window.addEventListener("pointerup", onPanelDragEnd, true);
    window.addEventListener("pointercancel", onPanelDragEnd, true);
    event.preventDefault();
  }

  function bindPanelDragHandlers(handle, header) {
    if (!handle || !header) {
      return;
    }

    handle.addEventListener("pointerdown", startPanelDrag);
    header.addEventListener("pointerdown", startPanelDrag);
  }

  function togglePanel(forceOpen) {
    const root = document.getElementById(ROOT_ID);
    if (!root) {
      return;
    }

    const shouldOpen = typeof forceOpen === "boolean"
      ? forceOpen
      : !root.classList.contains("tmusic-open");

    root.classList.toggle("tmusic-open", shouldOpen);

    if (!shouldOpen) {
      setSettingsPanelOpen(false);
    }

    const toggleBtn = document.getElementById(BUTTON_ID);
    if (toggleBtn) {
      toggleBtn.setAttribute("aria-expanded", String(shouldOpen));
    }

    const fullscreenToggleBtn = document.getElementById(FULLSCREEN_BUTTON_ID);
    if (fullscreenToggleBtn) {
      fullscreenToggleBtn.setAttribute("aria-expanded", String(shouldOpen));
    }

    const panel = document.getElementById(PANEL_ID);
    if (panel) {
      panel.setAttribute("aria-hidden", String(!shouldOpen));
    }
  }

  function findChatToggleButton() {
    for (const selector of CHAT_TOGGLE_SELECTORS) {
      const element = document.querySelector(selector);
      if (element) {
        return element;
      }
    }

    const labelledButtons = Array.from(document.querySelectorAll("button[aria-label]"));
    return labelledButtons.find((button) => {
      const label = (button.getAttribute("aria-label") || "").toLowerCase();
      return label.includes("chat") || label.includes("discussion");
    }) || null;
  }

  function isElementVisibleInTree(element) {
    if (!element || !element.isConnected) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) {
      return false;
    }

    let current = element;
    while (current && current !== document.documentElement) {
      const style = window.getComputedStyle(current);
      if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") {
        return false;
      }

      if (Number(style.opacity) <= 0.05) {
        return false;
      }

      current = current.parentElement;
    }

    return rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
  }

  function restartFullscreenIdleTimer() {
    if (fullscreenIdleTimeout) {
      window.clearTimeout(fullscreenIdleTimeout);
      fullscreenIdleTimeout = 0;
    }

    if (!document.fullscreenElement) {
      return;
    }

    fullscreenIdleTimeout = window.setTimeout(() => {
      scheduleFullscreenPositionUpdate();
    }, FULLSCREEN_UI_IDLE_MS + 50);
  }

  function markFullscreenActivity() {
    if (!document.fullscreenElement) {
      return;
    }

    lastFullscreenActivityAt = Date.now();
    restartFullscreenIdleTimer();
    scheduleFullscreenPositionUpdate();
  }

  function ensureOverlayContainer(root, inFullscreen) {
    if (!root) {
      return;
    }

    const container = inFullscreen && document.fullscreenElement
      ? document.fullscreenElement
      : document.body;

    if (container && root.parentElement !== container) {
      container.appendChild(root);
    }
  }

  function updateFullscreenButtonPosition() {
    const root = document.getElementById(ROOT_ID);
    const fullscreenButton = document.getElementById(FULLSCREEN_BUTTON_ID);
    if (!root || !fullscreenButton) {
      return;
    }

    const inFullscreen = Boolean(document.fullscreenElement);
    root.classList.toggle("tmusic-in-fullscreen", inFullscreen);
    ensureOverlayContainer(root, inFullscreen);

    if (!inFullscreen) {
      root.classList.remove("tmusic-ui-hidden");
      fullscreenButton.style.removeProperty("top");
      fullscreenButton.style.removeProperty("left");
      fullscreenButton.style.removeProperty("right");
      fullscreenButton.style.removeProperty("bottom");
      return;
    }

    const chatToggleButton = findChatToggleButton();
    const isRecentlyActive = Date.now() - lastFullscreenActivityAt < FULLSCREEN_UI_IDLE_MS;
    const isChatToggleVisible = isElementVisibleInTree(chatToggleButton);
    const showFullscreenButton = isRecentlyActive && isChatToggleVisible;

    root.classList.toggle("tmusic-ui-hidden", !showFullscreenButton);

    if (!showFullscreenButton) {
      return;
    }

    fullscreenButton.style.top = "auto";
    fullscreenButton.style.left = "auto";
    fullscreenButton.style.right = "16px";
    fullscreenButton.style.bottom = "116px";
  }

  function scheduleFullscreenPositionUpdate() {
    if (updateRaf) {
      return;
    }

    updateRaf = window.requestAnimationFrame(() => {
      updateRaf = 0;
      updateFullscreenButtonPosition();
    });
  }

  function bindGlobalListeners() {
    if (listenersBound) {
      return;
    }
    listenersBound = true;

    document.addEventListener("fullscreenchange", () => {
      lastFullscreenActivityAt = Date.now();
      restartFullscreenIdleTimer();
      clampSavedPanelIntoViewport();
      scheduleFullscreenPositionUpdate();
    });
    window.addEventListener("resize", () => {
      clampSavedPanelIntoViewport();
      scheduleFullscreenPositionUpdate();
    }, { passive: true });
    window.addEventListener("scroll", scheduleFullscreenPositionUpdate, true);
    window.addEventListener("pointermove", markFullscreenActivity, { passive: true });
    window.addEventListener("keydown", markFullscreenActivity, true);
    window.addEventListener("touchstart", markFullscreenActivity, { passive: true });
    window.addEventListener("blur", () => stopPanelDrag(), true);
  }

  function buildUi() {
    if (!document.body || document.getElementById(ROOT_ID)) {
      return;
    }

    const root = document.createElement("div");
    root.id = ROOT_ID;
    root.className = "tmusic-root";

    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.className = "tmusic-toggle";
    button.setAttribute("aria-label", "Afficher ou masquer le lecteur de musique");
    button.setAttribute("aria-expanded", "false");
    button.textContent = "♪";

    const fullscreenButton = document.createElement("button");
    fullscreenButton.id = FULLSCREEN_BUTTON_ID;
    fullscreenButton.type = "button";
    fullscreenButton.className = "tmusic-fs-toggle";
    fullscreenButton.setAttribute("aria-label", "Ouvrir l'overlay musique");
    fullscreenButton.setAttribute("aria-expanded", "false");
    fullscreenButton.textContent = "Musique";

    const panel = document.createElement("aside");
    panel.id = PANEL_ID;
    panel.className = "tmusic-panel";
    panel.setAttribute("aria-hidden", "true");

    const handle = document.createElement("div");
    handle.className = "tmusic-handle";
    handle.setAttribute("aria-hidden", "true");

    const header = document.createElement("div");
    header.className = "tmusic-header";

    const brand = document.createElement("div");
    brand.className = "tmusic-brand";

    const brandIcon = document.createElement("span");
    brandIcon.className = "tmusic-brand-icon";
    brandIcon.textContent = "♪";

    const heading = document.createElement("div");
    heading.className = "tmusic-heading";

    const title = document.createElement("h3");
    title.className = "tmusic-title";
    title.textContent = "Lecteur musique";

    const subtitle = document.createElement("p");
    subtitle.className = "tmusic-subtitle";
    subtitle.textContent = "Playlist Spotify integree";

    const actions = document.createElement("div");
    actions.className = "tmusic-actions";

    const openSpotify = document.createElement("a");
    openSpotify.id = OPEN_SPOTIFY_LINK_ID;
    openSpotify.className = "tmusic-open-link";
    openSpotify.href = buildPlaylistOpenUrl(playlistState.playlistId);
    openSpotify.target = "_blank";
    openSpotify.rel = "noopener noreferrer";
    openSpotify.textContent = "Ouvrir Spotify";

    const settingsToggle = document.createElement("button");
    settingsToggle.id = SETTINGS_TOGGLE_ID;
    settingsToggle.type = "button";
    settingsToggle.className = "tmusic-settings-toggle";
    settingsToggle.setAttribute("aria-label", "Ouvrir les parametres de playlist");
    settingsToggle.setAttribute("aria-expanded", "false");
    settingsToggle.textContent = "Parametres";

    const close = document.createElement("button");
    close.id = CLOSE_ID;
    close.type = "button";
    close.className = "tmusic-close";
    close.setAttribute("aria-label", "Fermer le lecteur");
    close.textContent = "✕";

    const frameWrap = document.createElement("div");
    frameWrap.className = "tmusic-frame-wrap";

    const frame = document.createElement("iframe");
    frame.id = FRAME_ID;
    frame.className = "tmusic-frame";
    frame.setAttribute("data-testid", "embed-iframe");
    frame.style.borderRadius = "12px";
    frame.src = buildPlaylistEmbedUrl(playlistState.playlistId);
    frame.title = "Playlist Spotify";
    frame.width = "100%";
    frame.height = "520";
    frame.setAttribute("frameBorder", "0");
    frame.loading = "lazy";
    frame.referrerPolicy = "strict-origin-when-cross-origin";
    frame.allow = "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture";

    const footer = document.createElement("div");
    footer.className = "tmusic-footer";

    const settingsPanel = document.createElement("div");
    settingsPanel.id = SETTINGS_PANEL_ID;
    settingsPanel.className = "tmusic-settings-panel";
    settingsPanel.hidden = true;

    const settingsLabel = document.createElement("label");
    settingsLabel.className = "tmusic-settings-label";
    settingsLabel.setAttribute("for", SETTINGS_INPUT_ID);
    settingsLabel.textContent = "Lien playlist Spotify";

    const settingsInput = document.createElement("input");
    settingsInput.id = SETTINGS_INPUT_ID;
    settingsInput.className = "tmusic-settings-input";
    settingsInput.type = "text";
    settingsInput.value = playlistState.playlistInput;
    settingsInput.placeholder = "https://open.spotify.com/playlist/...";
    settingsInput.spellcheck = false;

    const settingsActions = document.createElement("div");
    settingsActions.className = "tmusic-settings-actions";

    const presetsCreateRow = document.createElement("div");
    presetsCreateRow.className = "tmusic-presets-create";

    const presetNameInput = document.createElement("input");
    presetNameInput.id = SETTINGS_PRESET_NAME_ID;
    presetNameInput.className = "tmusic-preset-name-input";
    presetNameInput.type = "text";
    presetNameInput.placeholder = "Nom du preset";
    presetNameInput.maxLength = 30;

    const presetAdd = document.createElement("button");
    presetAdd.id = SETTINGS_PRESET_ADD_ID;
    presetAdd.type = "button";
    presetAdd.className = "tmusic-preset-add";
    presetAdd.textContent = "Ajouter";

    const presetsList = document.createElement("div");
    presetsList.id = SETTINGS_PRESETS_LIST_ID;
    presetsList.className = "tmusic-presets-list";

    const settingsSave = document.createElement("button");
    settingsSave.id = SETTINGS_SAVE_ID;
    settingsSave.type = "button";
    settingsSave.className = "tmusic-settings-save";
    settingsSave.textContent = "Enregistrer";

    const settingsReset = document.createElement("button");
    settingsReset.id = SETTINGS_RESET_ID;
    settingsReset.type = "button";
    settingsReset.className = "tmusic-settings-reset";
    settingsReset.textContent = "Defaut";

    const settingsStatus = document.createElement("span");
    settingsStatus.id = SETTINGS_STATUS_ID;
    settingsStatus.className = "tmusic-settings-status";

    const volumeRow = document.createElement("div");
    volumeRow.className = "tmusic-volume-row";

    const volumeLabel = document.createElement("span");
    volumeLabel.className = "tmusic-volume-label";
    volumeLabel.textContent = "Volume";

    const volumeSlider = document.createElement("input");
    volumeSlider.id = VOLUME_SLIDER_ID;
    volumeSlider.className = "tmusic-volume-slider";
    volumeSlider.type = "range";
    volumeSlider.min = String(VOLUME_MIN);
    volumeSlider.max = String(VOLUME_MAX);
    volumeSlider.step = "1";
    volumeSlider.value = String(VOLUME_DEFAULT);
    volumeSlider.setAttribute("aria-label", "Regler le volume Spotify");

    const volumeValue = document.createElement("span");
    volumeValue.id = VOLUME_VALUE_ID;
    volumeValue.className = "tmusic-volume-value";
    volumeValue.textContent = "100%";

    const footerText = document.createElement("span");
    footerText.className = "tmusic-footer-text";
    footerText.textContent = VOLUME_FEEDBACK_DEFAULT_TEXT;

    heading.appendChild(title);
    heading.appendChild(subtitle);
    brand.appendChild(brandIcon);
    brand.appendChild(heading);

    actions.appendChild(openSpotify);
    actions.appendChild(settingsToggle);
    actions.appendChild(close);

    settingsActions.appendChild(settingsSave);
    settingsActions.appendChild(settingsReset);
    settingsActions.appendChild(settingsStatus);

    settingsPanel.appendChild(settingsLabel);
    settingsPanel.appendChild(settingsInput);
    presetsCreateRow.appendChild(presetNameInput);
    presetsCreateRow.appendChild(presetAdd);
    settingsPanel.appendChild(presetsCreateRow);
    settingsPanel.appendChild(presetsList);
    settingsPanel.appendChild(settingsActions);

    const applyPlaylistFromInput = async (inputValue, options = {}) => {
      const playlistId = extractPlaylistId(inputValue);
      if (!playlistId) {
        if (options.setStatus !== false) {
          setSettingsStatus("Lien invalide", true);
        }
        return;
      }

      const nextState = {
        playlistId,
        playlistInput: inputValue.trim() || buildPlaylistOpenUrl(playlistId)
      };

      playlistState = nextState;
      applyPlaylistStateToUi(nextState);
      await savePlaylistState(nextState);

      if (options.setStatus !== false) {
        setSettingsStatus(options.statusMessage || "Enregistre", false);
      }

      renderPlaylistPresets();
    };

    const addOrUpdatePresetFromCurrentInput = async () => {
      const playlistId = extractPlaylistId(settingsInput.value);
      if (!playlistId) {
        setSettingsStatus("Lien invalide", true);
        return;
      }

      const fallbackName = `Preset ${playlistPresets.length + 1}`;
      const presetName = buildPresetName(presetNameInput.value, fallbackName);
      const presetInput = settingsInput.value.trim() || buildPlaylistOpenUrl(playlistId);

      const existingIndex = playlistPresets.findIndex((preset) => preset.playlistId === playlistId);
      if (existingIndex >= 0) {
        playlistPresets[existingIndex] = {
          ...playlistPresets[existingIndex],
          name: presetName,
          playlistInput: presetInput
        };
      } else {
        playlistPresets.unshift({
          id: createPresetId(),
          name: presetName,
          playlistId,
          playlistInput: presetInput
        });

        if (playlistPresets.length > MAX_PLAYLIST_PRESETS) {
          playlistPresets = playlistPresets.slice(0, MAX_PLAYLIST_PRESETS);
        }
      }

      await savePlaylistPresets();
      renderPlaylistPresets();
      presetNameInput.value = "";
      setSettingsStatus(`Preset ${presetName} enregistre`, false);
    };

    presetHandlers = {
      onSelectPreset: async (preset) => {
        settingsInput.value = preset.playlistInput;
        await applyPlaylistFromInput(preset.playlistInput, {
          statusMessage: `Preset ${preset.name} active`
        });
      },
      onDeletePreset: async (preset) => {
        playlistPresets = playlistPresets.filter((entry) => entry.id !== preset.id);
        await savePlaylistPresets();
        renderPlaylistPresets();
        setSettingsStatus(`Preset ${preset.name} supprime`, false);
      }
    };

    renderPlaylistPresets();

    settingsToggle.addEventListener("click", () => {
      const willOpen = settingsPanel.hidden;
      setSettingsPanelOpen(willOpen);
      if (willOpen) {
        settingsInput.focus();
        settingsInput.select();
      }
    });

    settingsSave.addEventListener("click", () => {
      applyPlaylistFromInput(settingsInput.value);
    });

    presetAdd.addEventListener("click", () => {
      addOrUpdatePresetFromCurrentInput();
    });

    settingsReset.addEventListener("click", async () => {
      const defaultInput = buildPlaylistOpenUrl(DEFAULT_PLAYLIST_ID);
      settingsInput.value = defaultInput;
      await applyPlaylistFromInput(defaultInput);
    });

    settingsInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        applyPlaylistFromInput(settingsInput.value);
      }
    });

    presetNameInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        addOrUpdatePresetFromCurrentInput();
      }
    });

    volumeSlider.addEventListener("input", (event) => {
      const target = event.currentTarget;
      const percent = clampVolumePercent(target && target.value);
      setVolumeUi(percent);
      scheduleVolumeUpdate(percent);
    });

    volumeSlider.addEventListener("change", (event) => {
      const target = event.currentTarget;
      const percent = clampVolumePercent(target && target.value);
      setVolumeUi(percent);
      sendVolumeToBackground(percent);
    });

    header.appendChild(brand);
    header.appendChild(actions);

    volumeRow.appendChild(volumeLabel);
    volumeRow.appendChild(volumeSlider);
    volumeRow.appendChild(volumeValue);
    footer.appendChild(volumeRow);
    footer.appendChild(footerText);

    panel.appendChild(handle);
    frameWrap.appendChild(frame);
    panel.appendChild(header);
    panel.appendChild(settingsPanel);
    panel.appendChild(frameWrap);
    panel.appendChild(footer);

    root.appendChild(button);
    root.appendChild(fullscreenButton);
    root.appendChild(panel);

    bindPanelDragHandlers(handle, header);

    button.addEventListener("click", () => togglePanel());
    fullscreenButton.addEventListener("click", () => togglePanel());
    close.addEventListener("click", () => togglePanel(false));

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        togglePanel(false);
      }
    });

    document.body.appendChild(root);
    applySavedPanelPosition();
    clampSavedPanelIntoViewport();
    initializePlaylistState();
    initializeVolumeState();
    lastFullscreenActivityAt = Date.now();
    restartFullscreenIdleTimer();
    scheduleFullscreenPositionUpdate();
  }

  function ensureUi() {
    if (!document.body) {
      requestAnimationFrame(ensureUi);
      return;
    }

    buildUi();
    bindGlobalListeners();

    const observer = new MutationObserver(() => {
      if (!document.getElementById(ROOT_ID)) {
        buildUi();
      }

      scheduleFullscreenPositionUpdate();
    });

    observer.observe(document.body, { childList: true, subtree: true });

    scheduleFullscreenPositionUpdate();
  }

  ensureUi();
})();
