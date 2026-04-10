(() => {
  const BRIDGE_MESSAGE_TYPE = "tmusic:spotify-volume-bridge";
  const BRIDGE_SOURCE = "tmusic-bridge";
  const DEFAULT_VOLUME = 1;
  const MIN_VOLUME = 0;
  const MAX_VOLUME = 1;

  if (window.__tmusicSpotifyMainInstalled) {
    return;
  }
  window.__tmusicSpotifyMainInstalled = true;

  let targetVolume = DEFAULT_VOLUME;
  const contexts = new Set();
  const trackedMedia = new WeakSet();
  const observedRoots = new WeakSet();
  const originalConnect = AudioNode.prototype.connect;

  function clampVolume(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return DEFAULT_VOLUME;
    }

    return Math.min(MAX_VOLUME, Math.max(MIN_VOLUME, numeric));
  }

  function ensureMasterGain(context) {
    if (!context || context.__tmusicMasterGain) {
      return;
    }

    try {
      const gain = context.createGain();
      gain.gain.value = targetVolume;
      originalConnect.call(gain, context.destination);
      context.__tmusicMasterGain = gain;
      contexts.add(context);
    } catch {
      // Ignore unsupported contexts.
    }
  }

  function applyVolumeToContext(context) {
    if (!context) {
      return;
    }

    ensureMasterGain(context);
    const gain = context.__tmusicMasterGain;
    if (!gain) {
      return;
    }

    try {
      gain.gain.setTargetAtTime(targetVolume, context.currentTime, 0.03);
    } catch {
      gain.gain.value = targetVolume;
    }
  }

  function patchAudioContextConstructor(name) {
    const OriginalCtor = window[name];
    if (typeof OriginalCtor !== "function" || OriginalCtor.__tmusicWrapped) {
      return;
    }

    function WrappedAudioContext(...args) {
      const context = new OriginalCtor(...args);
      applyVolumeToContext(context);
      return context;
    }

    WrappedAudioContext.prototype = OriginalCtor.prototype;
    Object.setPrototypeOf(WrappedAudioContext, OriginalCtor);
    WrappedAudioContext.__tmusicWrapped = true;

    Object.getOwnPropertyNames(OriginalCtor).forEach((prop) => {
      try {
        WrappedAudioContext[prop] = OriginalCtor[prop];
      } catch {
        // Ignore readonly static properties.
      }
    });

    window[name] = WrappedAudioContext;
  }

  function patchAudioNodeConnect() {
    if (AudioNode.prototype.__tmusicConnectPatched) {
      return;
    }

    AudioNode.prototype.__tmusicConnectPatched = true;

    AudioNode.prototype.connect = function patchedConnect(destination, ...rest) {
      try {
        const context = this.context;
        if (
          context
          && destination === context.destination
          && this !== context.__tmusicMasterGain
        ) {
          ensureMasterGain(context);
          if (context.__tmusicMasterGain) {
            return originalConnect.call(this, context.__tmusicMasterGain, ...rest);
          }
        }
      } catch {
        // Fall through to original connect.
      }

      return originalConnect.call(this, destination, ...rest);
    };
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

  function trackMedia(media) {
    if (!(media instanceof HTMLMediaElement) || trackedMedia.has(media)) {
      return;
    }

    trackedMedia.add(media);

    const enforce = () => {
      applyVolumeToMedia(media);
    };

    media.addEventListener("play", enforce, { passive: true });
    media.addEventListener("volumechange", enforce, { passive: true });
    media.addEventListener("loadedmetadata", enforce, { passive: true });

    enforce();
  }

  function scanRoot(rootNode) {
    if (!rootNode || typeof rootNode.querySelectorAll !== "function") {
      return;
    }

    rootNode.querySelectorAll("audio, video").forEach((media) => {
      trackMedia(media);
    });

    rootNode.querySelectorAll("*").forEach((element) => {
      if (element.shadowRoot) {
        observeRoot(element.shadowRoot);
        scanRoot(element.shadowRoot);
      }
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
            trackMedia(node);
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

  function applyVolumeEverywhere() {
    contexts.forEach((context) => {
      applyVolumeToContext(context);
    });

    scanRoot(document);

    document.querySelectorAll("audio, video").forEach((media) => {
      applyVolumeToMedia(media);
    });
  }

  function startBridgeListener() {
    window.addEventListener("message", (event) => {
      if (event.source !== window || !event.data) {
        return;
      }

      if (event.data.type !== BRIDGE_MESSAGE_TYPE || event.data.source !== BRIDGE_SOURCE) {
        return;
      }

      targetVolume = clampVolume(event.data.volume);
      applyVolumeEverywhere();
    });
  }

  function startGuardLoop() {
    window.setInterval(() => {
      applyVolumeEverywhere();
    }, 220);
  }

  patchAudioContextConstructor("AudioContext");
  patchAudioContextConstructor("webkitAudioContext");
  patchAudioNodeConnect();

  observeRoot(document.documentElement);
  scanRoot(document);

  startBridgeListener();
  startGuardLoop();

  console.log("[TMusic][Spotify Main] audio hook installed");
})();
