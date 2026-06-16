import {
  ALARM,
  MESSAGE,
  PHASE,
  createDefaultState,
  getPhaseDurationMs,
  getRemainingMs,
} from './state.js';

const STORAGE_KEY = 'paintPomodoroState';

let state = createDefaultState();

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
    state: getPublicState(),
  };

  try {
    await chrome.runtime.sendMessage(payload);
  } catch {
    // No listeners open (popup closed) — expected.
  }
}

function getPublicState() {
  return {
    ...state,
    remainingMs: getRemainingMs(state),
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

async function startFocus() {
  await setState({
    ...state,
    phase: PHASE.FOCUSING,
    phaseStartedAt: Date.now(),
    pausedAt: null,
    remainingMs: null,
  });
  await schedulePhaseEndAlarm();
}

async function startBreak() {
  await setState({
    ...state,
    phase: PHASE.RESTING,
    phaseStartedAt: Date.now(),
    pausedAt: null,
    remainingMs: null,
  });
  await schedulePhaseEndAlarm();
}

async function pauseTimer() {
  if (state.phase === PHASE.IDLE || state.pausedAt !== null) {
    return;
  }

  const remainingMs = getRemainingMs(state);
  await clearAlarm();
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
  await schedulePhaseEndAlarm();
}

async function resetTimer() {
  await clearAlarm();
  await setState(createDefaultState());
}

async function skipBreak() {
  if (state.phase !== PHASE.RESTING) {
    return;
  }
  await startFocus();
}

async function handlePhaseEnd() {
  if (state.pausedAt !== null) {
    return;
  }

  if (state.phase === PHASE.FOCUSING) {
    // Paint overlay will hook in here in a later phase.
    console.log('[PaintPomodoro] Focus complete — break starting');
    await startBreak();
    return;
  }

  if (state.phase === PHASE.RESTING) {
    console.log('[PaintPomodoro] Break complete — focus starting');
    await startFocus();
  }
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM.PHASE_END) {
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
      return { ok: true, state: getPublicState() };

    case MESSAGE.START_FOCUS:
      await startFocus();
      return { ok: true, state: getPublicState() };

    case MESSAGE.START_BREAK:
      await startBreak();
      return { ok: true, state: getPublicState() };

    case MESSAGE.PAUSE:
      await pauseTimer();
      return { ok: true, state: getPublicState() };

    case MESSAGE.RESUME:
      await resumeTimer();
      return { ok: true, state: getPublicState() };

    case MESSAGE.RESET:
      await resetTimer();
      return { ok: true, state: getPublicState() };

    case MESSAGE.SKIP_BREAK:
      await skipBreak();
      return { ok: true, state: getPublicState() };

    default:
      return { ok: false, error: `Unknown message type: ${message.type}` };
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await loadState();
  if (state.phase !== PHASE.IDLE && state.pausedAt === null) {
    await schedulePhaseEndAlarm();
  }
});

loadState().then(async () => {
  if (state.phase !== PHASE.IDLE && state.pausedAt === null) {
    await schedulePhaseEndAlarm();
  }
});
