import {
  ALARM,
  MESSAGE,
  OVERLAY,
  PHASE,
  createDefaultState,
  createTask,
  getPhaseDurationMs,
  getRemainingMs,
} from './state.js';
import {
  MAX_DAILY_BREAKS,
  ensureDailyArtReset,
  ensureDailyArtwork,
  getCanvasForBreak,
  getNextBreakNumber,
  getTodayKey,
  loadDailyArt,
  rotateArtworkIfNewSession,
  rotateToNextPainting,
  saveDailyCanvas,
} from './daily-art.js';
import { getArtworkDisplay, getBreakRevealDisplay } from './reveal-tiers.js';
import { packMarksForBreak } from './mark-generator.js';

const STORAGE_KEY = 'paintPomodoroState';

let state = createDefaultState();
let pendingBreakNumber = null;
let overlayTabId = null;

async function loadState() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const loaded = stored[STORAGE_KEY] ?? createDefaultState();
  const migrated = ensureTasksCurrentDay(loaded);
  state = migrated;
  if (loaded.tasksDateKey !== migrated.tasksDateKey) {
    await saveState();
  }
  if (state.phase === PHASE.PAINTING_IN) {
    state.phase = PHASE.RESTING;
  }
}

function ensureTasksCurrentDay(nextState) {
  const today = getTodayKey();
  if (nextState.tasksDateKey === today) {
    return nextState;
  }
  return {
    ...nextState,
    tasks: [],
    tasksDateKey: today,
  };
}

async function saveState() {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

async function broadcastState() {
  const payload = {
    type: MESSAGE.STATE_UPDATED,
    state: await getPublicState(),
  };

  try {
    await chrome.runtime.sendMessage(payload);
  } catch {
    // No listeners open (popup closed) — expected.
  }
}

async function getPublicState() {
  const dailyArt = await loadDailyArt();
  return {
    ...state,
    remainingMs: getRemainingMs(state),
    dailyArt: {
      breakCount: dailyArt.breakCount,
      dateKey: dailyArt.dateKey,
      maxBreaks: MAX_DAILY_BREAKS,
      artworkDisplay: getArtworkDisplay(dailyArt.artwork, dailyArt.breakCount),
      artworkReady: Boolean(dailyArt.artwork?.objectID),
    },
  };
}

async function clearAlarm() {
  await chrome.alarms.clear(ALARM.PHASE_END);
}

async function schedulePhaseEndAlarm() {
  await clearAlarm();
  const remainingMs = getRemainingMs(state);
  if (remainingMs <= 0) {
    return;
  }
  await chrome.alarms.create(ALARM.PHASE_END, { when: Date.now() + remainingMs });
}

async function setState(nextState) {
  state = nextState;
  await saveState();
  await broadcastState();
}

async function getActiveBrowsableTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id || !tab.url) {
    return null;
  }
  if (
    tab.url.startsWith('chrome://') ||
    tab.url.startsWith('chrome-extension://') ||
    tab.url.startsWith('edge://') ||
    tab.url.startsWith('about:')
  ) {
    return null;
  }
  return tab;
}

function isBrowsableUrl(url) {
  return (
    url &&
    !url.startsWith('chrome://') &&
    !url.startsWith('chrome-extension://') &&
    !url.startsWith('edge://') &&
    !url.startsWith('about:')
  );
}

async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    return true;
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content/inject-overlay.js'],
      });
      await chrome.tabs.sendMessage(tabId, { type: 'PING' });
      return true;
    } catch (error) {
      console.warn('[PaintPomodoro] Could not inject into tab', tabId, error);
      return false;
    }
  }
}

async function sendToTab(tabId, message) {
  if (!(await ensureContentScript(tabId))) {
    return false;
  }
  try {
    await chrome.tabs.sendMessage(tabId, message);
    return true;
  } catch (error) {
    console.warn('[PaintPomodoro] Message failed for tab', tabId, error);
    return false;
  }
}

async function sendToAllTabs(message) {
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs.map(async (tab) => {
      if (!tab.id || !isBrowsableUrl(tab.url)) {
        return;
      }
      await sendToTab(tab.id, message);
    }),
  );
}

async function sendOverlayToTargets(message, preferredTabId = overlayTabId) {
  if (preferredTabId && (await sendToTab(preferredTabId, message))) {
    return { delivered: true, tabId: preferredTabId };
  }

  const activeTab = await getActiveBrowsableTab();
  if (activeTab?.id && (await sendToTab(activeTab.id, message))) {
    return { delivered: true, tabId: activeTab.id };
  }

  const tabs = await chrome.tabs.query({ currentWindow: true });
  for (const tab of tabs) {
    if (tab.id && isBrowsableUrl(tab.url) && (await sendToTab(tab.id, message))) {
      return { delivered: true, tabId: tab.id };
    }
  }

  await sendToAllTabs(message);
  return { delivered: false, tabId: null };
}

async function showOverlayOnAllTabs() {
  await sendOverlayToTargets({ type: OVERLAY.SHOW });
}

async function hideOverlayOnAllTabs() {
  await sendOverlayToTargets({ type: OVERLAY.HIDE });
}

async function sendOverlayCommand(command, payload = {}) {
  const result = await sendOverlayToTargets({
    type: OVERLAY.COMMAND,
    command,
    ...payload,
  });
  if (result.tabId) {
    overlayTabId = result.tabId;
  }
  return result.delivered;
}

async function beginBreak() {
  let art = await ensureDailyArtwork();

  if (art.breakCount >= MAX_DAILY_BREAKS) {
    art = await rotateToNextPainting();
  }

  const breakNumber = getNextBreakNumber(art);
  const previousCanvas = getCanvasForBreak(art);

  pendingBreakNumber = breakNumber;
  const breakDurationMs = state.settings.breakMinutes * 60 * 1000;
  const paintDurationMs = (state.settings.paintRevealSeconds ?? 20) * 1000;

  await setState({
    ...state,
    phase: PHASE.RESTING,
    phaseStartedAt: Date.now(),
    pausedAt: null,
    remainingMs: null,
  });
  await schedulePhaseEndAlarm();

  const breakReveal = getBreakRevealDisplay(art.artwork, breakNumber, MAX_DAILY_BREAKS);

  const delivery = await sendOverlayToTargets({
    type: OVERLAY.COMMAND,
    command: 'START_BREAK',
    breakNumber,
    previousCanvas,
    maxBreaks: MAX_DAILY_BREAKS,
    artwork: art.artwork,
    marks: packMarksForBreak(art.marks, breakNumber),
    breakDurationMs,
    paintDurationMs,
    breakReveal,
  });
  if (delivery.tabId) {
    overlayTabId = delivery.tabId;
  }
  return delivery.delivered;
}

async function beginPaintOut() {
  if (state.phase === PHASE.PAINTING_OUT) {
    await sendOverlayCommand('PAINT_OUT');
    return;
  }

  if (state.phase !== PHASE.RESTING) {
    return;
  }

  await setState({
    ...state,
    phase: PHASE.PAINTING_OUT,
    phaseStartedAt: Date.now(),
    pausedAt: null,
    remainingMs: null,
  });
  await clearAlarm();
  await sendOverlayCommand('PAINT_OUT');
}

async function startFocus() {
  overlayTabId = null;
  await hideOverlayOnAllTabs();
  await sendOverlayCommand('RESET');
  await setState({
    ...state,
    phase: PHASE.FOCUSING,
    phaseStartedAt: Date.now(),
    pausedAt: null,
    remainingMs: null,
  });
  await schedulePhaseEndAlarm();
}

async function pauseTimer() {
  if (
    state.phase === PHASE.IDLE ||
    state.phase === PHASE.PAINTING_OUT ||
    state.pausedAt !== null
  ) {
    return;
  }

  const remainingMs = getRemainingMs(state);
  await clearAlarm();
  await sendOverlayCommand('PAUSE');
  await setState({
    ...state,
    pausedAt: Date.now(),
    remainingMs,
  });
}

async function resumeTimer() {
  if (state.pausedAt === null || state.remainingMs === null) {
    return;
  }

  await setState({
    ...state,
    phaseStartedAt: Date.now() - (getPhaseDurationMs(state) - state.remainingMs),
    pausedAt: null,
    remainingMs: null,
  });
  await sendOverlayCommand('RESUME');
  await schedulePhaseEndAlarm();
}

async function resetTimer() {
  const { tasks, tasksDateKey } = state;
  await clearAlarm();
  overlayTabId = null;
  await hideOverlayOnAllTabs();
  await sendOverlayCommand('RESET');
  await setState({ ...createDefaultState(), tasks, tasksDateKey });
}

async function addTask(text) {
  const trimmed = text?.trim();
  if (!trimmed) {
    return;
  }

  const current = ensureTasksCurrentDay(state);
  await setState({
    ...current,
    tasks: [...current.tasks, createTask(trimmed)],
    tasksDateKey: getTodayKey(),
  });
}

async function toggleTask(taskId) {
  const tasks = state.tasks.map((task) =>
    task.id === taskId ? { ...task, done: !task.done } : task,
  );
  await setState({ ...state, tasks });
}

async function removeTask(taskId) {
  const tasks = state.tasks.filter((task) => task.id !== taskId);
  await setState({ ...state, tasks });
}

async function skipBreak() {
  if (state.phase !== PHASE.RESTING) {
    return;
  }
  await beginPaintOut();
}

async function handlePhaseEnd() {
  if (state.pausedAt !== null) {
    return;
  }

  if (state.phase === PHASE.FOCUSING) {
    await beginBreak();
    return;
  }

  if (state.phase === PHASE.RESTING) {
    await beginPaintOut();
  }
}

async function handlePaintInDone() {
  // Painting finishes during the break; phase stays RESTING until the timer ends.
}

async function handlePaintOutDone() {
  if (state.phase !== PHASE.PAINTING_OUT) {
    return;
  }
  await startFocus();
}

async function handleBreakTimerExpired() {
  if (state.pausedAt !== null) {
    return;
  }

  if (state.phase === PHASE.RESTING) {
    await beginPaintOut();
    return;
  }

  if (state.phase === PHASE.PAINTING_OUT) {
    await sendOverlayCommand('PAINT_OUT');
  }
}

async function syncPhaseTimer() {
  if (state.phase !== PHASE.FOCUSING && state.phase !== PHASE.RESTING) {
    return;
  }

  if (state.pausedAt !== null) {
    return;
  }

  if (getRemainingMs(state) <= 0) {
    await handlePhaseEnd();
    return;
  }

  await schedulePhaseEndAlarm();
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM.PHASE_END) {
    await loadState();
    await handlePhaseEnd();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch((error) => {
      console.error('[PaintPomodoro]', error);
      sendResponse({ ok: false, error: error.message });
    });
  return true;
});

async function handleMessage(message) {
  await loadState();

  switch (message.type) {
    case MESSAGE.GET_STATE:
      ensureDailyArtwork()
        .then(() => broadcastState())
        .catch((error) => {
          console.warn('[PaintPomodoro] Failed to load daily artwork', error);
        });
      return { ok: true, state: await getPublicState() };

    case MESSAGE.START_FOCUS:
      await startFocus();
      return { ok: true, state: await getPublicState() };

    case MESSAGE.START_BREAK:
      await beginBreak();
      return { ok: true, state: await getPublicState() };

    case MESSAGE.PAUSE:
      await pauseTimer();
      return { ok: true, state: await getPublicState() };

    case MESSAGE.RESUME:
      await resumeTimer();
      return { ok: true, state: await getPublicState() };

    case MESSAGE.RESET:
      await resetTimer();
      return { ok: true, state: await getPublicState() };

    case MESSAGE.SKIP_BREAK:
      await skipBreak();
      return { ok: true, state: await getPublicState() };

    case MESSAGE.ADD_TASK:
      await addTask(message.text);
      return { ok: true, state: await getPublicState() };

    case MESSAGE.TOGGLE_TASK:
      await toggleTask(message.taskId);
      return { ok: true, state: await getPublicState() };

    case MESSAGE.REMOVE_TASK:
      await removeTask(message.taskId);
      return { ok: true, state: await getPublicState() };

    case MESSAGE.ACTIVATE: {
      const delivered = await beginBreak();
      const publicState = await getPublicState();
      return {
        ok: true,
        delivered,
        state: publicState,
        error: delivered
          ? undefined
          : 'Could not reach a webpage tab. Open a normal site (not chrome://) and try again.',
      };
    }

    case MESSAGE.CANVAS_SAVED:
      if (message.dataUrl && pendingBreakNumber != null) {
        await saveDailyCanvas(message.dataUrl, pendingBreakNumber);
        pendingBreakNumber = null;
        await broadcastState();
      }
      return { ok: true, state: await getPublicState() };

    case MESSAGE.PAINT_IN_DONE:
      await handlePaintInDone();
      return { ok: true, state: await getPublicState() };

    case MESSAGE.PAINT_OUT_DONE:
      await handlePaintOutDone();
      return { ok: true, state: await getPublicState() };

    case MESSAGE.BREAK_TIMER_EXPIRED:
      await handleBreakTimerExpired();
      return { ok: true, state: await getPublicState() };

    default:
      return { ok: false, error: `Unknown message type: ${message.type}` };
  }
}

let bootPromise = null;

async function bootServiceWorker() {
  if (!bootPromise) {
    bootPromise = (async () => {
      await rotateArtworkIfNewSession();
      await startup();
    })();
  }
  return bootPromise;
}

async function startup() {
  await loadState();
  await ensureDailyArtReset();

  try {
    await ensureDailyArtwork();
    await broadcastState();
  } catch (error) {
    console.warn('[PaintPomodoro] Failed to prefetch daily artwork', error);
  }

  await syncPhaseTimer();
}

chrome.runtime.onInstalled.addListener(async () => {
  try {
    await bootServiceWorker();
  } catch (error) {
    console.warn('[PaintPomodoro] Failed to boot service worker on install', error);
  }

  if (state.phase === PHASE.RESTING) {
    await showOverlayOnAllTabs();
    await sendOverlayCommand('START_BREAK', {
      breakDurationMs: state.settings.breakMinutes * 60 * 1000,
    });
  }
  if (state.phase === PHASE.PAINTING_OUT) {
    await showOverlayOnAllTabs();
    await sendOverlayCommand('PAINT_OUT');
  }
});

bootServiceWorker().catch((error) => {
  console.warn('[PaintPomodoro] Failed to boot service worker', error);
});
