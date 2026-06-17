import {
  ALARM,
  MESSAGE,
  OVERLAY,
  PHASE,
  createDefaultState,
  getPhaseDurationMs,
  getRemainingMs,
} from './state.js';
import {
  MAX_DAILY_BREAKS,
  clearDailyCanvas,
  ensureDailyArtReset,
  getNextBreakNumber,
  loadDailyArt,
  saveDailyCanvas,
} from './daily-art.js';

const STORAGE_KEY = 'paintPomodoroState';
const PROMPTS_URL = chrome.runtime.getURL('data/prompts.json');

let state = createDefaultState();
let promptsCache = null;
let pendingBreakNumber = null;

async function loadState() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  state = stored[STORAGE_KEY] ?? createDefaultState();
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

async function getPrompts() {
  if (promptsCache) {
    return promptsCache;
  }
  const response = await fetch(PROMPTS_URL);
  promptsCache = await response.json();
  return promptsCache;
}

async function pickRandomPrompt() {
  const prompts = await getPrompts();
  if (!prompts.length) {
    return { type: 'action', text: 'Step away from the screen and rest your eyes.' };
  }
  return prompts[Math.floor(Math.random() * prompts.length)];
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

async function sendOverlayToTargets(message) {
  const activeTab = await getActiveBrowsableTab();
  if (activeTab?.id && (await sendToTab(activeTab.id, message))) {
    return true;
  }

  const tabs = await chrome.tabs.query({ currentWindow: true });
  for (const tab of tabs) {
    if (tab.id && isBrowsableUrl(tab.url) && (await sendToTab(tab.id, message))) {
      return true;
    }
  }

  await sendToAllTabs(message);
  return false;
}

async function showOverlayOnAllTabs() {
  await sendOverlayToTargets({ type: OVERLAY.SHOW });
}

async function hideOverlayOnAllTabs() {
  await sendOverlayToTargets({ type: OVERLAY.HIDE });
}

async function sendOverlayCommand(command, payload = {}) {
  await sendOverlayToTargets({
    type: OVERLAY.COMMAND,
    command,
    ...payload,
  });
}

async function beginPaintIn(options = {}) {
  await ensureDailyArtReset();
  const art = await loadDailyArt();

  let breakNumber;
  let previousCanvas = art.canvasDataUrl;

  if (options.testBreakNumber != null) {
    breakNumber = options.testBreakNumber;
    if (breakNumber === 1) {
      await clearDailyCanvas();
      previousCanvas = null;
    } else {
      const fresh = await loadDailyArt();
      previousCanvas = fresh.canvasDataUrl ?? null;
    }
  } else {
    breakNumber = getNextBreakNumber(art);
  }

  pendingBreakNumber = breakNumber;

  await setState({
    ...state,
    phase: PHASE.PAINTING_IN,
    phaseStartedAt: Date.now(),
    pausedAt: null,
    remainingMs: null,
  });
  await clearAlarm();

  return sendOverlayToTargets({
    type: OVERLAY.COMMAND,
    command: 'PAINT_IN',
    breakNumber,
    previousCanvas,
    maxBreaks: MAX_DAILY_BREAKS,
  });
}

async function beginRestBreak() {
  const prompt = await pickRandomPrompt();
  await setState({
    ...state,
    phase: PHASE.RESTING,
    phaseStartedAt: Date.now(),
    pausedAt: null,
    remainingMs: null,
  });
  await sendOverlayCommand('SHOW_PROMPT', { prompt });
  await schedulePhaseEndAlarm();
}

async function beginPaintOut() {
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
    state.phase === PHASE.PAINTING_IN ||
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
  await clearAlarm();
  await hideOverlayOnAllTabs();
  await sendOverlayCommand('RESET');
  await setState(createDefaultState());
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
    await beginPaintIn();
    return;
  }

  if (state.phase === PHASE.RESTING) {
    await beginPaintOut();
  }
}

async function handlePaintInDone() {
  if (state.phase !== PHASE.PAINTING_IN) {
    return;
  }
  await beginRestBreak();
}

async function handlePaintOutDone() {
  if (state.phase !== PHASE.PAINTING_OUT) {
    return;
  }
  await startFocus();
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
      return { ok: true, state: await getPublicState() };

    case MESSAGE.START_FOCUS:
      await startFocus();
      return { ok: true, state: await getPublicState() };

    case MESSAGE.START_BREAK:
      await beginRestBreak();
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

    case MESSAGE.ACTIVATE: {
      const delivered = await beginPaintIn();
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

    case MESSAGE.ACTIVATE_BREAK: {
      const breakNumber = message.breakNumber;
      if (!breakNumber || breakNumber < 1 || breakNumber > MAX_DAILY_BREAKS) {
        return { ok: false, error: 'Invalid break number.' };
      }
      const delivered = await beginPaintIn({ testBreakNumber: breakNumber });
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

    default:
      return { ok: false, error: `Unknown message type: ${message.type}` };
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await loadState();
  if (state.phase === PHASE.FOCUSING || state.phase === PHASE.RESTING) {
    if (state.pausedAt === null) {
      await schedulePhaseEndAlarm();
    }
  }
  if (state.phase === PHASE.PAINTING_IN) {
    await showOverlayOnAllTabs();
    await sendOverlayCommand('PAINT_IN');
  }
  if (state.phase === PHASE.RESTING) {
    await showOverlayOnAllTabs();
    const prompt = await pickRandomPrompt();
    await sendOverlayCommand('SHOW_PROMPT', { prompt });
  }
  if (state.phase === PHASE.PAINTING_OUT) {
    await showOverlayOnAllTabs();
    await sendOverlayCommand('PAINT_OUT');
  }
});

loadState().then(async () => {
  await ensureDailyArtReset();
  if (state.phase === PHASE.FOCUSING || state.phase === PHASE.RESTING) {
    if (state.pausedAt === null) {
      await schedulePhaseEndAlarm();
    }
  }
});
