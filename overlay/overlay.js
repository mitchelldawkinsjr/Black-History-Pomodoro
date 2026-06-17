import { createPaintSketch } from './paint-sketch.js';

const container = document.getElementById('paint-container');
const revealHud = document.getElementById('reveal-hud');
const revealProgress = document.getElementById('reveal-progress');
const revealHeadline = document.getElementById('reveal-headline');
const revealClue = document.getElementById('reveal-clue');
const revealTimer = document.getElementById('reveal-timer');

let breakEndAt = null;
let hudInterval = null;

const sketch = createPaintSketch(container, {
  onPaintInComplete: async (dataUrl) => {
    if (dataUrl) {
      await chrome.runtime.sendMessage({ type: 'CANVAS_SAVED', dataUrl });
    }
    chrome.runtime.sendMessage({ type: 'PAINT_IN_DONE' }).catch(() => {});
  },
  onPaintOutComplete: () => {
    hideRevealHud();
    chrome.runtime.sendMessage({ type: 'PAINT_OUT_DONE' }).catch(() => {});
  },
  onReady: () => {
    signalReady();
  },
});

function getApi() {
  return sketch.getApi();
}

function signalReady() {
  window.parent.postMessage(
    { source: 'paint-pomodoro', event: 'READY' },
    '*',
  );
}

function formatTime(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function updateRevealTimer() {
  if (!breakEndAt) {
    return;
  }
  revealTimer.textContent = formatTime(breakEndAt - Date.now());
}

function showRevealHud(payload = {}) {
  const reveal = payload.breakReveal ?? {};
  const breakNumber = reveal.breakNumber ?? payload.breakNumber ?? 1;
  const maxBreaks = reveal.maxBreaks ?? payload.maxBreaks ?? 10;

  revealProgress.textContent = reveal.progressLabel ?? `Break ${breakNumber} of ${maxBreaks}`;
  revealHeadline.textContent = reveal.headline ?? '';
  revealHeadline.hidden = !reveal.headline;

  if (reveal.clue) {
    revealClue.textContent = `${reveal.clue.label}: ${reveal.clue.value}`;
    revealClue.hidden = false;
  } else {
    revealClue.textContent = 'More of the painting will appear as you rest.';
    revealClue.hidden = false;
  }

  breakEndAt = Date.now() + (payload.breakDurationMs ?? 5 * 60 * 1000);
  updateRevealTimer();
  revealHud.hidden = false;

  if (hudInterval) {
    clearInterval(hudInterval);
  }
  hudInterval = setInterval(updateRevealTimer, 1000);
}

function hideRevealHud() {
  revealHud.hidden = true;
  breakEndAt = null;
  if (hudInterval) {
    clearInterval(hudInterval);
    hudInterval = null;
  }
}

async function waitForApi(maxAttempts = 120) {
  for (let i = 0; i < maxAttempts; i += 1) {
    const api = getApi();
    if (api?.startPaintIn) {
      return api;
    }
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  return null;
}

async function startBreakPaint(payload = {}) {
  const api = await waitForApi();
  if (!api) {
    console.error('[PaintPomodoro overlay] Sketch API not ready');
    return;
  }

  showRevealHud(payload);

  await api.startPaintIn({
    breakNumber: payload.breakNumber ?? 1,
    previousCanvas: payload.previousCanvas ?? null,
    maxBreaks: payload.maxBreaks ?? 10,
    artwork: payload.artwork ?? null,
    marks: payload.marks ?? null,
    breakDurationMs: payload.breakDurationMs,
    paintDurationMs: payload.paintDurationMs ?? 20000,
  });
}

async function handleCommand(command, payload = {}) {
  const api = await waitForApi();
  if (!api) {
    console.error('[PaintPomodoro overlay] Sketch API not ready');
    return;
  }

  switch (command) {
    case 'PING':
      signalReady();
      break;
    case 'RESIZE':
      sketch.instance?.windowResized?.();
      break;
    case 'START_BREAK':
    case 'PAINT_IN':
      await startBreakPaint(payload);
      break;
    case 'PAINT_OUT':
      hideRevealHud();
      api.startPaintOut();
      break;
    case 'PAUSE':
      api.pause();
      break;
    case 'RESUME':
      api.resume();
      break;
    case 'RESET':
      hideRevealHud();
      api.reset();
      break;
    default:
      break;
  }
}

window.addEventListener('message', (event) => {
  if (event.data?.source !== 'paint-pomodoro') {
    return;
  }
  handleCommand(event.data.command, event.data);
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'OVERLAY_COMMAND') {
    handleCommand(message.command, message);
  }
});

waitForApi().then((api) => {
  if (api) {
    signalReady();
  }
});

window.addEventListener('unload', () => {
  if (hudInterval) {
    clearInterval(hudInterval);
  }
});
