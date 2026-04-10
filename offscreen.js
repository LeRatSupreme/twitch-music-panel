const sessions = new Map();
const MIN_VOLUME = 0;
const MAX_VOLUME = 1;
const MSG_OFFSCREEN_INIT = "tmusic:offscreen-init-tab-audio";
const MSG_OFFSCREEN_SET = "tmusic:offscreen-set-volume";
const MSG_OFFSCREEN_DESTROY = "tmusic:offscreen-destroy-tab-audio";

function clampVolume(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 1;
  }
  return Math.min(MAX_VOLUME, Math.max(MIN_VOLUME, numeric));
}

async function initTabAudio(tabId, streamId, volume) {
  if (sessions.has(tabId)) {
    const existingSession = sessions.get(tabId);
    existingSession.gainNode.gain.setTargetAtTime(clampVolume(volume), existingSession.audioContext.currentTime, 0.02);
    return;
  }

  const mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId
      }
    },
    video: false
  });

  const audioContext = new AudioContext();
  const sourceNode = audioContext.createMediaStreamSource(mediaStream);
  const gainNode = audioContext.createGain();
  gainNode.gain.value = clampVolume(volume);

  if (audioContext.state === "suspended") {
    try {
      await audioContext.resume();
    } catch {
      // Ignore resume failures; a later user interaction may resume playback.
    }
  }

  sourceNode.connect(gainNode);
  gainNode.connect(audioContext.destination);

  sessions.set(tabId, {
    mediaStream,
    audioContext,
    sourceNode,
    gainNode
  });
}

function setVolume(tabId, volume) {
  const session = sessions.get(tabId);
  if (!session) {
    return false;
  }

  const target = clampVolume(volume);
  session.gainNode.gain.setTargetAtTime(target, session.audioContext.currentTime, 0.02);
  return true;
}

async function destroyTabAudio(tabId) {
  const session = sessions.get(tabId);
  if (!session) {
    return;
  }

  sessions.delete(tabId);

  session.mediaStream.getTracks().forEach((track) => track.stop());

  try {
    await session.audioContext.close();
  } catch {
    // Ignore close failures.
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.type !== "string") {
    return;
  }

  if (message.type === MSG_OFFSCREEN_INIT) {
    initTabAudio(message.tabId, message.streamId, message.volume)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error && error.message ? error.message : "Failed to init tab audio"
        });
      });
    return true;
  }

  if (message.type === MSG_OFFSCREEN_SET) {
    try {
      const updated = setVolume(message.tabId, message.volume);
      if (!updated) {
        sendResponse({ ok: false, error: "No audio session for this tab" });
        return;
      }
      sendResponse({ ok: true });
    } catch (error) {
      sendResponse({
        ok: false,
        error: error && error.message ? error.message : "Failed to set volume"
      });
    }
    return;
  }

  if (message.type === MSG_OFFSCREEN_DESTROY) {
    destroyTabAudio(message.tabId)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error && error.message ? error.message : "Failed to destroy tab audio"
        });
      });
    return true;
  }
});
