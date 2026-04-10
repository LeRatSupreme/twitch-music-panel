const sessions = new Map();
const MIN_VOLUME = 0;
const MAX_VOLUME = 1;

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
    return;
  }

  const target = clampVolume(volume);
  session.gainNode.gain.setTargetAtTime(target, session.audioContext.currentTime, 0.02);
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

  if (message.type === "tmusic:init-tab-audio") {
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

  if (message.type === "tmusic:set-volume") {
    try {
      setVolume(message.tabId, message.volume);
      sendResponse({ ok: true });
    } catch (error) {
      sendResponse({
        ok: false,
        error: error && error.message ? error.message : "Failed to set volume"
      });
    }
    return;
  }

  if (message.type === "tmusic:destroy-tab-audio") {
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
