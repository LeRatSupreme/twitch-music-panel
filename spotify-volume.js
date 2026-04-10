(() => {
  const SPOTIFY_VOLUME_STORAGE_KEY = "volumeSpotify";
  const BRIDGE_MESSAGE_TYPE = "tmusic:spotify-volume-bridge";
  const BRIDGE_SOURCE = "tmusic-bridge";
  const DEFAULT_VOLUME = 1;
  const MIN_VOLUME = 0;
  const MAX_VOLUME = 1;

  let targetVolume = DEFAULT_VOLUME;
  const observedRoots = new WeakSet();

  function clampVolume(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return DEFAULT_VOLUME;
    }

    return Math.min(MAX_VOLUME, Math.max(MIN_VOLUME, numeric));
  }

  function broadcastToMainWorld() {
    window.postMessage({
      type: BRIDGE_MESSAGE_TYPE,
      source: BRIDGE_SOURCE,
      volume: targetVolume
    }, "*");
  }

  function applyVolumeToMedia(media) {
    if (!(media instanceof HTMLMediaElement)) {
      return;
    }

    try {
      if (Math.abs(media.volume - targetVolume) > 0.01) {
        media.volume = targetVolume;
      }

      if (targetVolume > 0 && media.muted) {
        media.muted = false;
      }
    } catch {
      // Ignore media states where volume is not writable.
    }
  }

  function scanRoot(rootNode) {
    if (!rootNode || typeof rootNode.querySelectorAll !== "function") {
      return;
    }

    rootNode.querySelectorAll("audio, video").forEach((media) => {
      applyVolumeToMedia(media);
    });

    rootNode.querySelectorAll("*").forEach((element) => {
      if (element.shadowRoot) {
        observeRoot(element.shadowRoot);
        scanRoot(element.shadowRoot);
      }
    });
  }

  function forceApplyVolume() {
    scanRoot(document);
    document.querySelectorAll("audio, video").forEach((media) => {
      applyVolumeToMedia(media);
    });
  }

  function observeRoot(rootNode) {
    if (!rootNode || observedRoots.has(rootNode)) {
      return;
    }

    observedRoots.add(rootNode);

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof Element)) {
            return;
          }

          if (node.matches("audio, video")) {
            applyVolumeToMedia(node);
          }

          if (node.shadowRoot) {
            observeRoot(node.shadowRoot);
            scanRoot(node.shadowRoot);
          }

          scanRoot(node);
        });
      });
    });

    observer.observe(rootNode, {
      childList: true,
      subtree: true
    });
  }

  async function initializeVolumeFromStorage() {
    try {
      const data = await chrome.storage.local.get(SPOTIFY_VOLUME_STORAGE_KEY);
      if (Number.isFinite(data[SPOTIFY_VOLUME_STORAGE_KEY])) {
        targetVolume = clampVolume(data[SPOTIFY_VOLUME_STORAGE_KEY]);
      }
    } catch {
      targetVolume = DEFAULT_VOLUME;
    }

    console.log("[TMusic][Spotify] injected, target volume:", targetVolume);
    forceApplyVolume();
    broadcastToMainWorld();
  }

  function startWatchingStorage() {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local" || !changes[SPOTIFY_VOLUME_STORAGE_KEY]) {
        return;
      }

      targetVolume = clampVolume(changes[SPOTIFY_VOLUME_STORAGE_KEY].newValue);
      console.log("[TMusic][Spotify] volume changed:", targetVolume);
      forceApplyVolume();
      broadcastToMainWorld();
    });
  }

  function startDynamicWatch() {
    observeRoot(document.documentElement);

    document.addEventListener("play", (event) => {
      const media = event.target;
      if (media instanceof HTMLMediaElement) {
        applyVolumeToMedia(media);
      }
    }, true);

    window.setInterval(() => {
      forceApplyVolume();
      broadcastToMainWorld();
    }, 200);
  }

  initializeVolumeFromStorage();
  startWatchingStorage();
  startDynamicWatch();
})();
