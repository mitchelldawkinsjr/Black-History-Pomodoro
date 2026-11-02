import {
  ALARM,
  MESSAGE,
  OVERLAY,
  PHASE,
  PAINT_OUT_WATCHDOG_MS,
  createDefaultState,
  createTask,
  getPhaseDurationMs,
  getRemainingMs,
  normalizeSettings,
} from './state.js';
import {
  MAX_DAILY_BREAKS,
  ensureDailyArtReset,
  ensureDailyArtwork,
  getCanvasForBreak,
  getNextBreakNumber,
  getPaintingBreakNumber,
  getTodayKey,
  loadDailyArt,
  rotateArtworkIfNewSession,
  rotateToNextPainting,
  saveDailyCanvas,
  completeBreakProgress,
} from './daily-art.js';
import { getArtworkDisplay, getBreakRevealDisplay } from './reveal-tiers.js';
import { packMarksForBreak } from './mark-generator.js';

const STORAGE_KEY = 'blackHistoryPomodoroState';
const LEGACY_STORAGE_KEY = 'paintPomodoroState';

let state = createDefaultState();
let pendingBreakNumber = null;
let overlayTabId = null;

async function loadState() {
  const stored = await chrome.storage.local.get([STORAGE_KEY, LEGACY_STORAGE_KEY]);
  let loaded = stored[STORAGE_KEY];
  if (!loaded && stored[LEGACY_STORAGE_KEY]) {
    loaded = stored[LEGACY_STORAGE_KEY];
    await chrome.storage.local.set({ [STORAGE_KEY]: loaded });
    await chrome.storage.local.remove(LEGACY_STORAGE_KEY);
  }
  loaded = loaded ?? createDefaultState();
  const migrated = ensureTasksCurrentDay(loaded);
  const settings = normalizeSettings(migrated.settings);
  state = { ...migrated, settings };
  if (
    loaded.tasksDateKey !== migrated.tasksDateKey ||
    JSON.stringify(loaded.settings ?? {}) !== JSON.stringify(settings)
  ) {
    await saveState();
  }
  if (state.phase === PHASE.PAINTING_IN) {
    state.phase = PHASE.RESTING;
  }
  // Recover from a previous paint-out that never received PAINT_OUT_DONE.
  if (state.phase === PHASE.PAINTING_OUT) {
    state = {
      ...state,
      phase: PHASE.IDLE,
      phaseStartedAt: null,
      pausedAt: null,
      remainingMs: null,
    };
    await saveState();
    await clearPaintOutWatchdog();
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

function getDiscoveryPeriods() {
  return state.settings?.discoveryPeriods ?? MAX_DAILY_BREAKS;
}

async function getPublicState() {
  const dailyArt = await loadDailyArt();
  const discovery = dailyArt.artwork?.discovery ?? null;
  const artworkReady = Boolean(
    dailyArt.artwork?.objectID && discovery?.factText,
  );
  const maxBreaks = getDiscoveryPeriods();
  return {
    ...state,
    remainingMs: getRemainingMs(state),
    dailyArt: {
      breakCount: dailyArt.breakCount,
      totalBreakCount: dailyArt.totalBreakCount ?? dailyArt.breakCount ?? 0,
      dateKey: dailyArt.dateKey,
      maxBreaks,
      artworkDisplay: getArtworkDisplay(dailyArt.artwork, dailyArt.breakCount),
      artworkReady,
      discoveryId: discovery?.id ?? null,
      discoveryError: dailyArt.discoveryError ?? null,
      discoveryLoading: Boolean(dailyArt.discoveryLoading),
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
      console.warn('[BlackHistoryPomodoro] Could not inject into tab', tabId, error);
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
    console.warn('[BlackHistoryPomodoro] Message failed for tab', tabId, error);
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
  const preferredId = overlayTabId;
  overlayTabId = null;

  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs.map(async (tab) => {
      if (!tab.id || !isBrowsableUrl(tab.url)) {
        return;
      }
      try {
        await chrome.tabs.sendMessage(tab.id, { type: OVERLAY.HIDE });
      } catch {
        // No content script on this tab.
      }
    }),
  );

  // If the script was unloaded, inject so a leftover iframe is still removed.
  const active = await getActiveBrowsableTab();
  const reinjectIds = new Set([preferredId, active?.id].filter(Boolean));
  await Promise.all(
    [...reinjectIds].map((tabId) => sendToTab(tabId, { type: OVERLAY.HIDE })),
  );
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
  const maxBreaks = getDiscoveryPeriods();
  let art = await ensureDailyArtwork(maxBreaks);

  if (art.breakCount >= maxBreaks) {
    art = await rotateToNextPainting(maxBreaks);
  }

  const breakNumber = getNextBreakNumber(art);
  const paintingBreakNumber = getPaintingBreakNumber(breakNumber, maxBreaks);
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

  const breakReveal = getBreakRevealDisplay(art.artwork, breakNumber, maxBreaks);

  const delivery = await sendOverlayToTargets({
    type: OVERLAY.COMMAND,
    command: 'START_BREAK',
    breakNumber,
    paintingBreakNumber,
    previousCanvas,
    maxBreaks,
    artwork: art.artwork,
    marks: packMarksForBreak(art.marks, paintingBreakNumber),
    breakDurationMs,
    paintDurationMs,
    breakReveal,
  });
  if (delivery.tabId) {
    overlayTabId = delivery.tabId;
  }
  return delivery.delivered;
}

async function clearPaintOutWatchdog() {
  await chrome.alarms.clear(ALARM.PAINT_OUT_WATCHDOG);
}

async function schedulePaintOutWatchdog() {
  await clearPaintOutWatchdog();
  await chrome.alarms.create(ALARM.PAINT_OUT_WATCHDOG, {
    when: Date.now() + PAINT_OUT_WATCHDOG_MS,
  });
}

/**
 * Ask the overlay to finish this break's paint layer and return a canvas snapshot.
 * Resolves with a data URL, or null if the overlay can't export in time.
 */
function waitForCanvasCheckpoint(timeoutMs = 4000) {
  return new Promise((resolve) => {
    let settled = false;

    const finish = (dataUrl) => {
      if (settled) {
        return;
      }
      settled = true;
      chrome.runtime.onMessage.removeListener(onMessage);
      resolve(typeof dataUrl === 'string' && dataUrl.startsWith('data:') ? dataUrl : null);
    };

    const onMessage = (message) => {
      if (message?.type === MESSAGE.CHECKPOINT_DONE) {
        finish(message.dataUrl ?? null);
      }
    };

    chrome.runtime.onMessage.addListener(onMessage);

    sendOverlayCommand('CHECKPOINT')
      .then((delivered) => {
        if (!delivered) {
          finish(null);
        }
      })
      .catch(() => finish(null));

    setTimeout(() => finish(null), timeoutMs);
  });
}

/**
 * End the break, persist paint progression, and start the next focus session.
 * Focus timer does not wait on paint-out animation.
 */
async function endBreakAndResumeFocus() {
  if (
    state.phase !== PHASE.RESTING
    && state.phase !== PHASE.PAINTING_OUT
  ) {
    return;
  }

  const breakNumber = pendingBreakNumber;
  const dataUrl = await waitForCanvasCheckpoint();

  const maxBreaks = getDiscoveryPeriods();
  if (breakNumber != null) {
    pendingBreakNumber = null;
    await completeBreakProgress(breakNumber, dataUrl, maxBreaks);
  } else if (dataUrl) {
    // Paint-in already credited the break; refresh the cumulative canvas.
    const art = await loadDailyArt();
    const credited = art.totalBreakCount ?? art.breakCount ?? 0;
    if (credited > 0) {
      await completeBreakProgress(credited, dataUrl, maxBreaks);
    }
  }

  await startFocus();
}

/** @deprecated Prefer endBreakAndResumeFocus — kept for late overlay PAINT_OUT_DONE. */
async function beginPaintOut() {
  await endBreakAndResumeFocus();
}

async function startFocus() {
  await clearPaintOutWatchdog();
  // Remove the break painting from every tab before the focus timer starts.
  // Do not follow with RESET — that command used to recreate the iframe.
  await hideOverlayOnAllTabs();
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
  const { tasks, tasksDateKey, settings } = state;
  await clearAlarm();
  await clearPaintOutWatchdog();
  await hideOverlayOnAllTabs();
  await setState({
    ...createDefaultState(),
    tasks,
    tasksDateKey,
    settings: normalizeSettings(settings),
  });
}

async function updateSettings(partial = {}) {
  const nextSettings = normalizeSettings(partial, state.settings);
  const unchanged =
    nextSettings.focusMinutes === state.settings.focusMinutes &&
    nextSettings.breakMinutes === state.settings.breakMinutes &&
    nextSettings.discoveryPeriods === state.settings.discoveryPeriods &&
    nextSettings.paintRevealSeconds === state.settings.paintRevealSeconds &&
    nextSettings.paintOutSeconds === state.settings.paintOutSeconds;

  if (unchanged) {
    return;
  }

  const periodsChanged =
    nextSettings.discoveryPeriods !== state.settings.discoveryPeriods;

  // Idle: new focus length shows right away.
  // Active/paused: keep current remaining; next focus/break uses the new lengths.
  await setState({
    ...state,
    settings: nextSettings,
  });

  // Rebuild mark tiers when the period count changes so painting stays aligned.
  if (periodsChanged) {
    try {
      await ensureDailyArtwork(nextSettings.discoveryPeriods);
    } catch (error) {
      console.warn('[BlackHistoryPomodoro] Failed to refresh marks for new period count', error);
    }
  }
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
  await endBreakAndResumeFocus();
}

async function handlePhaseEnd() {
  if (state.pausedAt !== null) {
    return;
  }

  if (state.phase === PHASE.FOCUSING) {
    await beginBreak();
    return;
  }

  if (state.phase === PHASE.RESTING || state.phase === PHASE.PAINTING_OUT) {
    await endBreakAndResumeFocus();
  }
}

async function handlePaintInDone() {
  // Painting finishes during the break; phase stays RESTING until the timer ends.
}

async function handlePaintOutDone() {
  await clearPaintOutWatchdog();
  // Focus already resumed when the break ended; ignore late overlay messages.
  if (state.phase === PHASE.PAINTING_OUT) {
    await startFocus();
  }
}

async function handlePaintOutWatchdog() {
  if (state.phase !== PHASE.PAINTING_OUT) {
    return;
  }
  console.warn('[BlackHistoryPomodoro] Paint-out watchdog fired; forcing return to focus');
  await startFocus();
}

async function handleBreakTimerExpired() {
  if (state.pausedAt !== null) {
    return;
  }

  if (state.phase === PHASE.RESTING || state.phase === PHASE.PAINTING_OUT) {
    await endBreakAndResumeFocus();
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
    return;
  }
  if (alarm.name === ALARM.PAINT_OUT_WATCHDOG) {
    await loadState();
    await handlePaintOutWatchdog();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch((error) => {
      console.error('[BlackHistoryPomodoro]', error);
      sendResponse({ ok: false, error: error.message });
    });
  return true;
});

async function handleMessage(message) {
  await loadState();

  switch (message.type) {
    case MESSAGE.GET_STATE:
      try {
        await ensureDailyArtwork(getDiscoveryPeriods());
      } catch (error) {
        console.warn('[BlackHistoryPomodoro] Failed to load daily artwork', error);
        // ensureDailyArtwork persists discoveryError for the popup.
      }
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

    case MESSAGE.UPDATE_SETTINGS:
      await updateSettings(message.settings ?? message);
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
      if (state.phase !== PHASE.FOCUSING) {
        return { ok: false, error: 'Start break is only available during a focus session.' };
      }
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
        const breakNumber = pendingBreakNumber;
        pendingBreakNumber = null;
        await saveDailyCanvas(message.dataUrl, breakNumber, getDiscoveryPeriods());
        await broadcastState();
      } else if (message.dataUrl) {
        // Break already credited (skip / paint-out); still keep the latest canvas snapshot.
        const art = await loadDailyArt();
        const breakNumber = art.totalBreakCount ?? art.breakCount ?? 0;
        if (breakNumber > 0) {
          await saveDailyCanvas(message.dataUrl, breakNumber, getDiscoveryPeriods());
          await broadcastState();
        }
      }
      return { ok: true, state: await getPublicState() };

    case MESSAGE.CHECKPOINT_DONE:
      // Consumed by waitForCanvasCheckpoint listeners; acknowledge for sendResponse.
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
    await ensureDailyArtwork(getDiscoveryPeriods());
    await broadcastState();
  } catch (error) {
    console.warn('[BlackHistoryPomodoro] Failed to prefetch daily artwork', error);
  }

  await syncPhaseTimer();
}

chrome.runtime.onInstalled.addListener(async () => {
  try {
    await bootServiceWorker();
  } catch (error) {
    console.warn('[BlackHistoryPomodoro] Failed to boot service worker on install', error);
  }

  if (state.phase === PHASE.RESTING) {
    await showOverlayOnAllTabs();
    await sendOverlayCommand('START_BREAK', {
      breakDurationMs: state.settings.breakMinutes * 60 * 1000,
    });
  }
});

bootServiceWorker().catch((error) => {
  console.warn('[BlackHistoryPomodoro] Failed to boot service worker', error);
});
