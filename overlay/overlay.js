import { createPaintSketch } from './paint-sketch.js';

const container = document.getElementById('paint-container');
const revealHud = document.getElementById('reveal-hud');
const revealHudToggle = document.getElementById('reveal-hud-toggle');
const revealHudBody = document.getElementById('reveal-hud-body');
const revealProgress = document.getElementById('reveal-progress');
const revealClues = document.getElementById('reveal-clues');
const revealTimer = document.getElementById('reveal-timer');

let breakEndAt = null;
let hudInterval = null;
let hudExpanded = true;
let breakTimerExpired = false;

const sketch = createPaintSketch(container, {
  onPaintInComplete: async (dataUrl) => {
    if (dataUrl) {
      await chrome.runtime.sendMessage({ type: 'CANVAS_SAVED', dataUrl });
    }
    chrome.runtime.sendMessage({ type: 'PAINT_IN_DONE' }).catch(() => {});
  },
  onPaintOutProgress: (opacity) => {
    setOverlayFade(opacity);
  },
  onPaintOutComplete: () => {
    setOverlayFade(0);
    hideRevealHud();
    requestOverlayHide();
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

function requestOverlayHide() {
  window.parent.postMessage(
    { source: 'paint-pomodoro', event: 'HIDE' },
    '*',
  );
}

function setOverlayFade(opacity) {
  const clamped = Math.max(0, Math.min(1, opacity));
  revealHud.style.opacity = String(clamped);
  window.parent.postMessage(
    { source: 'paint-pomodoro', event: 'FADE', opacity: clamped },
    '*',
  );
}

function formatTime(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function notifyBreakTimerExpired() {
  if (breakTimerExpired) {
    return;
  }
  breakTimerExpired = true;
  chrome.runtime.sendMessage({ type: 'BREAK_TIMER_EXPIRED' }).catch(() => {});
  startLocalPaintOut();
}

async function startLocalPaintOut() {
  const api = await waitForApi();
  if (!api) {
    return;
  }

  const mode = api.getMode?.();
  if (mode === 'resting' || mode === 'paintIn') {
    setOverlayFade(1);
    api.startPaintOut();
  }
}

function updateRevealTimer() {
  if (!breakEndAt) {
    return;
  }

  const remainingMs = breakEndAt - Date.now();
  if (remainingMs <= 0) {
    revealTimer.textContent = '00:00';
    notifyBreakTimerExpired();
    return;
  }

  revealTimer.textContent = formatTime(remainingMs);
}

function setHudExpanded(expanded) {
  hudExpanded = expanded;
  revealHud.classList.toggle('is-collapsed', !expanded);
  revealHudToggle.setAttribute('aria-expanded', String(expanded));
}

revealHudToggle.addEventListener('click', () => {
  setHudExpanded(!hudExpanded);
});

function renderRevealClues(unlockedClues, currentBreak) {
  revealClues.replaceChildren();

  if (!unlockedClues?.length) {
    const placeholder = document.createElement('p');
    placeholder.className = 'reveal-clue-placeholder';
    placeholder.textContent = 'More about this painting will appear with each break.';
    revealClues.appendChild(placeholder);
    return;
  }

  for (const clue of unlockedClues) {
    const entry = document.createElement('article');
    entry.className = 'reveal-clue-entry';
    if (clue.breakNumber === currentBreak) {
      entry.classList.add('is-new');
    }

    const label = document.createElement('h3');
    label.className = 'reveal-clue-label';
    label.textContent = clue.label;

    const value = document.createElement('p');
    value.className = 'reveal-clue-value';
    value.textContent = clue.value;

    entry.append(label, value);

    if (clue.detail && clue.detail !== clue.value) {
      const detail = document.createElement('p');
      detail.className = 'reveal-clue-detail';
      detail.textContent = clue.detail;
      entry.appendChild(detail);
    }

    revealClues.appendChild(entry);
  }

  const newest = revealClues.querySelector('.is-new');
  if (newest) {
    newest.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

function showRevealHud(payload = {}) {
  const reveal = payload.breakReveal ?? {};
  const breakNumber = reveal.breakNumber ?? payload.breakNumber ?? 1;

  revealProgress.textContent = reveal.progressLabel ?? `Break ${breakNumber}`;
  renderRevealClues(reveal.unlockedClues ?? [], breakNumber);
  setHudExpanded(true);

  breakEndAt = Date.now() + (payload.breakDurationMs ?? 5 * 60 * 1000);
  breakTimerExpired = false;
  updateRevealTimer();
  revealHud.hidden = false;
  revealHud.style.opacity = '1';

  if (hudInterval) {
    clearInterval(hudInterval);
  }
  hudInterval = setInterval(updateRevealTimer, 1000);
}

function hideRevealHud() {
  revealHud.hidden = true;
  revealHud.style.opacity = '1';
  setHudExpanded(true);
  breakEndAt = null;
  breakTimerExpired = false;
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
      setOverlayFade(1);
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
