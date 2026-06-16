import {
  MESSAGE,
  PHASE,
  getPhaseLabel,
} from '../background/state.js';

const phaseLabelEl = document.getElementById('phase-label');
const timerEl = document.getElementById('timer');
const timerHintEl = document.getElementById('timer-hint');
const btnPrimary = document.getElementById('btn-primary');
const btnSecondary = document.getElementById('btn-secondary');

let currentState = null;
let tickInterval = null;

function formatTime(ms) {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function getDisplayRemainingMs(state) {
  if (state.phase === PHASE.IDLE) {
    return state.settings.focusMinutes * 60 * 1000;
  }
  if (state.pausedAt !== null && state.remainingMs !== null) {
    return state.remainingMs;
  }
  const durationMs =
    state.phase === PHASE.FOCUSING
      ? state.settings.focusMinutes * 60 * 1000
      : state.settings.breakMinutes * 60 * 1000;
  const elapsed = Date.now() - state.phaseStartedAt;
  return Math.max(0, durationMs - elapsed);
}

function render(state) {
  currentState = state;
  const remainingMs = getDisplayRemainingMs(state);
  const isPaused = state.pausedAt !== null;

  phaseLabelEl.textContent = isPaused
    ? `${getPhaseLabel(state.phase)} (paused)`
    : getPhaseLabel(state.phase);
  timerEl.textContent = formatTime(remainingMs);

  btnSecondary.hidden = state.phase === PHASE.IDLE;

  if (state.phase === PHASE.IDLE) {
    timerHintEl.textContent = "Start a focus session when you're ready.";
    btnPrimary.textContent = 'Start focus';
    btnPrimary.dataset.action = 'start';
    return;
  }

  if (isPaused) {
    timerHintEl.textContent = 'Timer paused.';
    btnPrimary.textContent = 'Resume';
    btnPrimary.dataset.action = 'resume';
    return;
  }

  if (state.phase === PHASE.FOCUSING) {
    timerHintEl.textContent = 'Stay focused — paint is waiting.';
    btnPrimary.textContent = 'Pause';
    btnPrimary.dataset.action = 'pause';
    return;
  }

  if (state.phase === PHASE.RESTING) {
    timerHintEl.textContent = 'Take a real break away from the screen.';
    btnPrimary.textContent = 'Skip break';
    btnPrimary.dataset.action = 'skip';
  }
}

async function sendMessage(type) {
  const response = await chrome.runtime.sendMessage({ type });
  if (response?.ok) {
    render(response.state);
  }
}

function startTicking() {
  stopTicking();
  tickInterval = setInterval(() => {
    if (currentState && currentState.pausedAt === null && currentState.phase !== PHASE.IDLE) {
      render(currentState);
    }
  }, 1000);
}

function stopTicking() {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
}

btnPrimary.addEventListener('click', async () => {
  const action = btnPrimary.dataset.action;
  switch (action) {
    case 'start':
      await sendMessage(MESSAGE.START_FOCUS);
      break;
    case 'pause':
      await sendMessage(MESSAGE.PAUSE);
      break;
    case 'resume':
      await sendMessage(MESSAGE.RESUME);
      break;
    case 'skip':
      await sendMessage(MESSAGE.SKIP_BREAK);
      break;
  }
});

btnSecondary.addEventListener('click', async () => {
  await sendMessage(MESSAGE.RESET);
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === MESSAGE.STATE_UPDATED) {
    render(message.state);
  }
});

async function init() {
  const response = await chrome.runtime.sendMessage({ type: MESSAGE.GET_STATE });
  if (response?.ok) {
    render(response.state);
  }
  startTicking();
}

init();

window.addEventListener('unload', stopTicking);
