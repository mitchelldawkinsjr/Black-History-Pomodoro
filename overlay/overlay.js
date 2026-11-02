import { createPaintSketch } from './paint-sketch.js';

const container = document.getElementById('paint-container');
const revealHud = document.getElementById('reveal-hud');
const revealHudToggle = document.getElementById('reveal-hud-toggle');
const revealHudBody = document.getElementById('reveal-hud-body');
const revealProgress = document.getElementById('reveal-progress');
const revealHeadline = document.getElementById('reveal-headline');
const revealSubtitle = document.getElementById('reveal-subtitle');
const revealFact = document.getElementById('reveal-fact');
const revealAttribution = document.getElementById('reveal-attribution')
  || document.querySelector('.reveal-attribution');
const revealClues = document.getElementById('reveal-clues');
const revealTimer = document.getElementById('reveal-timer');

let breakEndAt = null;
let breakTimerPausedAt = null;
let breakTimerRemainingMs = null;
let hudInterval = null;
let hudExpanded = true;
let breakTimerExpired = false;
let paintOutFailsafeTimer = null;
let paintOutCompletionSent = false;

function clearPaintOutFailsafe() {
  if (paintOutFailsafeTimer) {
    clearTimeout(paintOutFailsafeTimer);
    paintOutFailsafeTimer = null;
  }
}

function completePaintOut() {
  if (paintOutCompletionSent) {
    return;
  }
  paintOutCompletionSent = true;
  clearPaintOutFailsafe();
  setOverlayFade(0);
  hideRevealHud();
  requestOverlayHide();
  chrome.runtime.sendMessage({ type: 'PAINT_OUT_DONE' }).catch(() => {});
}

function armPaintOutFailsafe() {
  clearPaintOutFailsafe();
  paintOutCompletionSent = false;
  // Paint-out animation is ~4.2s; force completion if the sketch loop stalls.
  paintOutFailsafeTimer = setTimeout(() => {
    completePaintOut();
  }, 7000);
}

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
    completePaintOut();
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
    { source: 'black-history-pomodoro', event: 'READY' },
    '*',
  );
}

function requestOverlayHide() {
  window.parent.postMessage(
    { source: 'black-history-pomodoro', event: 'HIDE' },
    '*',
  );
}

function setOverlayFade(opacity) {
  const clamped = Math.max(0, Math.min(1, opacity));
  revealHud.style.opacity = String(clamped);
  window.parent.postMessage(
    { source: 'black-history-pomodoro', event: 'FADE', opacity: clamped },
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
  // Service worker ends the break, checkpoints canvas, and starts the next focus.
  // Do not start a local paint-out here — that races the checkpoint/RESET path.
  chrome.runtime.sendMessage({ type: 'BREAK_TIMER_EXPIRED' }).catch(() => {});
}

async function startLocalPaintOut() {
  const api = await waitForApi();
  if (!api) {
    completePaintOut();
    return;
  }

  const mode = api.getMode?.();
  if (mode === 'paintOut') {
    return;
  }
  if (mode === 'idle') {
    completePaintOut();
    return;
  }

  setOverlayFade(1);
  armPaintOutFailsafe();
  api.startPaintOut();
}

function pauseBreakTimer() {
  if (!breakEndAt || breakTimerPausedAt !== null) {
    return;
  }

  breakTimerRemainingMs = Math.max(0, breakEndAt - Date.now());
  breakTimerPausedAt = Date.now();
  revealTimer.textContent = formatTime(breakTimerRemainingMs);
}

function resumeBreakTimer() {
  if (breakTimerPausedAt === null || breakTimerRemainingMs === null) {
    return;
  }

  breakEndAt = Date.now() + breakTimerRemainingMs;
  breakTimerPausedAt = null;
  breakTimerRemainingMs = null;
  updateRevealTimer();
}

function updateRevealTimer() {
  if (!breakEndAt) {
    return;
  }

  if (breakTimerPausedAt !== null && breakTimerRemainingMs !== null) {
    revealTimer.textContent = formatTime(breakTimerRemainingMs);
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

function isFactClue(clue) {
  return clue?.kind === 'fact' || clue?.label === 'Fact' || clue?.label === 'Excerpt';
}

function latestFactClue(unlockedClues = []) {
  const facts = (unlockedClues ?? []).filter(isFactClue);
  return facts.length ? facts[facts.length - 1] : null;
}

function latestFactText(unlockedClues = []) {
  return latestFactClue(unlockedClues)?.value ?? '';
}

function renderRevealClues(unlockedClues, currentBreak, paintingBreakNumber = currentBreak) {
  revealClues.replaceChildren();

  const metaClues = (unlockedClues ?? []).filter((clue) => !isFactClue(clue));

  if (!metaClues.length && !latestFactText(unlockedClues)) {
    const placeholder = document.createElement('p');
    placeholder.className = 'reveal-clue-placeholder';
    placeholder.textContent = 'Complete a focus session to unlock the first Black history clue.';
    revealClues.appendChild(placeholder);
    return;
  }

  const total = metaClues.length;
  metaClues.forEach((clue, index) => {
    const entry = document.createElement('article');
    entry.className = 'reveal-clue-entry';
    const isNew = clue.breakNumber === paintingBreakNumber;
    if (isNew) {
      entry.classList.add('is-new');
    } else {
      entry.classList.add('is-past');
      // Soften earlier cards more as the stack grows.
      const age = Math.max(0, total - 1 - index);
      entry.dataset.age = String(Math.min(age, 3));
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
  });

  const newest = revealClues.querySelector('.is-new');
  if (newest) {
    newest.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

function showRevealHud(payload = {}) {
  const reveal = payload.breakReveal ?? {};
  const breakNumber = reveal.breakNumber ?? payload.breakNumber ?? 1;
  const paintingBreakNumber = reveal.paintingBreakNumber ?? breakNumber;
  const unlocked = reveal.unlockedClues ?? [];
  const factText = latestFactText(unlocked);

  revealProgress.textContent = reveal.progressLabel ?? `Discovery ${paintingBreakNumber}/10`;
  if (revealHeadline) {
    revealHeadline.textContent = reveal.headline ?? 'Black history discovery';
  }
  if (revealSubtitle) {
    revealSubtitle.textContent =
      paintingBreakNumber >= 10
        ? 'Full Black history fact revealed'
        : 'Black history facts unlock as you earn focus sessions';
  }
  if (revealFact) {
    const factClue = latestFactClue(unlocked);
    if (factText) {
      revealFact.hidden = false;
      revealFact.replaceChildren();

      const body = document.createElement('span');
      body.className = 'reveal-fact-text';
      body.textContent = factText;
      revealFact.appendChild(body);

      const factDetail = factClue?.detail && factClue.detail !== factText ? factClue.detail : '';
      if (factDetail) {
        const detail = document.createElement('span');
        detail.className = 'reveal-fact-detail';
        detail.textContent = factDetail;
        revealFact.appendChild(detail);
      }

      revealFact.classList.toggle('is-complete', paintingBreakNumber >= 10);
      revealFact.classList.toggle('has-detail', Boolean(factDetail));
    } else {
      revealFact.hidden = true;
      revealFact.replaceChildren();
      revealFact.classList.remove('is-complete', 'has-detail');
    }
  }
  if (revealAttribution && reveal.attribution) {
    revealAttribution.textContent = reveal.attribution;
  }
  renderRevealClues(unlocked, breakNumber, paintingBreakNumber);
  setHudExpanded(true);

  breakEndAt = Date.now() + (payload.breakDurationMs ?? 5 * 60 * 1000);
  breakTimerPausedAt = null;
  breakTimerRemainingMs = null;
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
  breakTimerPausedAt = null;
  breakTimerRemainingMs = null;
  breakTimerExpired = false;
  if (hudInterval) {
    clearInterval(hudInterval);
    hudInterval = null;
  }
}

function hardResetOverlay() {
  clearPaintOutFailsafe();
  paintOutCompletionSent = false;
  hideRevealHud();
  setOverlayFade(1);
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
    console.error('[BlackHistoryPomodoro overlay] Sketch API not ready');
    return;
  }

  showRevealHud(payload);

  await api.startPaintIn({
    breakNumber: payload.paintingBreakNumber ?? payload.breakNumber ?? 1,
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
    console.error('[BlackHistoryPomodoro overlay] Sketch API not ready');
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
    case 'PAINT_OUT': {
      const mode = api.getMode?.();
      if (mode === 'paintOut') {
        break;
      }
      if (mode === 'idle') {
        completePaintOut();
        break;
      }
      setOverlayFade(1);
      armPaintOutFailsafe();
      api.startPaintOut();
      break;
    }
    case 'PAUSE':
      api.pause();
      pauseBreakTimer();
      break;
    case 'RESUME':
      api.resume();
      resumeBreakTimer();
      break;
    case 'CHECKPOINT': {
      const dataUrl = api.checkpointProgress?.() ?? null;
      chrome.runtime
        .sendMessage({ type: 'CHECKPOINT_DONE', dataUrl })
        .catch(() => {});
      break;
    }
    case 'RESET':
      clearPaintOutFailsafe();
      paintOutCompletionSent = false;
      hideRevealHud();
      api.reset();
      break;
    default:
      break;
  }
}

window.addEventListener('message', (event) => {
  if (event.data?.source !== 'black-history-pomodoro') {
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
