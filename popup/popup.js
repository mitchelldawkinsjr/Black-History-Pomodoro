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
const btnActivate = document.getElementById('btn-activate');
const dailyBreakCountEl = document.getElementById('daily-break-count');
const artworkTitleEl = document.getElementById('artwork-title');
const artworkClueEl = document.getElementById('artwork-clue');
const artworkBadgeEl = document.getElementById('artwork-badge');
const breakGridEl = document.getElementById('break-grid');

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
  if (
    state.phase === PHASE.PAINTING_OUT
  ) {
    return 0;
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

function renderDailyArt(state) {
  const daily = state.dailyArt ?? { breakCount: 0, maxBreaks: 10 };
  const display = daily.artworkDisplay ?? {
    headline: daily.artworkReady ? 'Today\'s painting' : 'Loading today\'s painting…',
    latestClue: null,
    titleUnlocked: false,
  };

  dailyBreakCountEl.textContent = String(daily.breakCount);
  artworkTitleEl.textContent = display.headline;

  if (display.latestClue) {
    artworkClueEl.hidden = false;
    artworkClueEl.textContent = `${display.latestClue.label}: ${display.latestClue.value}`;
  } else if (daily.breakCount === 0 && daily.artworkReady) {
    artworkClueEl.hidden = false;
    artworkClueEl.textContent = 'Take a break to start revealing it.';
  } else {
    artworkClueEl.hidden = true;
    artworkClueEl.textContent = '';
  }

  artworkBadgeEl.textContent = display.titleUnlocked ? 'Revealed' : 'The Met';

  breakGridEl.querySelectorAll('.btn-break').forEach((btn) => {
    const n = Number(btn.dataset.break);
    btn.classList.toggle('is-done', n <= daily.breakCount);
  });
}

function buildBreakButtons() {
  breakGridEl.innerHTML = '';
  for (let i = 1; i <= 10; i += 1) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-break';
    btn.dataset.break = String(i);
    btn.textContent = String(i);
    btn.addEventListener('click', async () => {
      timerHintEl.textContent = i === 1
        ? 'Painting break 1… wait for it to finish before break 2.'
        : `Painting break ${i} on today's canvas…`;
      const response = await chrome.runtime.sendMessage({
        type: MESSAGE.ACTIVATE_BREAK,
        breakNumber: i,
      });
      if (response?.ok) {
        render(response.state);
      }
      if (response?.error) {
        timerHintEl.textContent = response.error;
      }
    });
    breakGridEl.appendChild(btn);
  }
}

function render(state) {
  currentState = state;
  const remainingMs = getDisplayRemainingMs(state);
  const isPaused = state.pausedAt !== null;

  phaseLabelEl.textContent = isPaused
    ? `${getPhaseLabel(state.phase)} (paused)`
    : getPhaseLabel(state.phase);

  btnPrimary.hidden = false;
  timerEl.textContent = formatTime(remainingMs);
  renderDailyArt(state);

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
    timerHintEl.textContent = 'Break — today\'s painting is revealing.';
    btnPrimary.textContent = 'Skip break';
    btnPrimary.dataset.action = 'skip';
    return;
  }

  if (state.phase === PHASE.PAINTING_OUT) {
    timerEl.textContent = '…';
    timerHintEl.textContent = 'Paint is lifting — your screen returns soon.';
    btnPrimary.hidden = true;
    return;
  }

  btnPrimary.hidden = false;
}

async function sendMessage(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (response?.ok) {
    render(response.state);
  }
  return response;
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

btnActivate.addEventListener('click', async () => {
  const response = await sendMessage(MESSAGE.ACTIVATE);
  if (response?.error) {
    timerHintEl.textContent = response.error;
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === MESSAGE.STATE_UPDATED) {
    render(message.state);
  }
});

async function init() {
  buildBreakButtons();
  const response = await chrome.runtime.sendMessage({ type: MESSAGE.GET_STATE });
  if (response?.ok) {
    render(response.state);
  }
  startTicking();
}

init();

window.addEventListener('unload', stopTicking);
