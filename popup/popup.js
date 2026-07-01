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
const controlsSecondaryEl = document.getElementById('controls-secondary');
const artworkProgressEl = document.getElementById('artwork-progress');
const artworkTitleEl = document.getElementById('artwork-title');
const artworkCluesEl = document.getElementById('artwork-clues');
const artworkBadgeEl = document.getElementById('artwork-badge');
const artworkToggleEl = document.getElementById('artwork-toggle');
const artworkBodyEl = document.getElementById('artwork-body');
const taskFormEl = document.getElementById('task-form');
const taskInputEl = document.getElementById('task-input');
const taskListEl = document.getElementById('task-list');
const taskBadgeEl = document.getElementById('task-badge');

let currentState = null;
let tickInterval = null;
let artworkExpanded = true;

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
  const daily = state.dailyArt ?? { breakCount: 0, totalBreakCount: 0, maxBreaks: 10 };
  const display = daily.artworkDisplay ?? {
    headline: daily.artworkReady ? 'Today\'s painting' : 'Loading today\'s painting…',
    latestClue: null,
    titleUnlocked: false,
  };

  const totalBreakCount = daily.totalBreakCount ?? daily.breakCount ?? 0;
  const currentBreak = state.phase === PHASE.RESTING ? totalBreakCount + 1 : totalBreakCount;
  if (currentBreak > 0) {
    artworkProgressEl.textContent = `Break ${currentBreak}`;
    artworkProgressEl.hidden = false;
  } else {
    artworkProgressEl.hidden = true;
  }

  artworkTitleEl.textContent = display.headline;

  artworkCluesEl.replaceChildren();
  if (display.clues?.length) {
    artworkCluesEl.hidden = false;
    for (const clue of display.clues) {
      const entry = document.createElement('div');
      entry.className = 'artwork-clue-entry';

      const label = document.createElement('span');
      label.className = 'artwork-clue-label';
      label.textContent = clue.label;

      const value = document.createElement('p');
      value.className = 'artwork-clue-value';
      value.textContent = clue.value;

      entry.append(label, value);

      if (clue.detail && clue.detail !== clue.value) {
        const detail = document.createElement('p');
        detail.className = 'artwork-clue-detail';
        detail.textContent = clue.detail;
        entry.appendChild(detail);
      }

      artworkCluesEl.appendChild(entry);
    }
  } else if (daily.breakCount === 0 && daily.artworkReady) {
    artworkCluesEl.hidden = false;
    const hint = document.createElement('p');
    hint.className = 'artwork-clue-empty';
    hint.textContent = 'Take a break to start revealing it.';
    artworkCluesEl.appendChild(hint);
  } else {
    artworkCluesEl.hidden = true;
  }

  artworkBadgeEl.textContent = display.titleUnlocked ? 'Revealed' : 'The Met';
}

function renderTasks(state) {
  const tasks = state.tasks ?? [];
  const remaining = tasks.filter((task) => !task.done).length;

  if (tasks.length === 0) {
    taskBadgeEl.hidden = true;
  } else if (remaining === 0) {
    taskBadgeEl.hidden = false;
    taskBadgeEl.textContent = 'All done';
  } else {
    taskBadgeEl.hidden = false;
    taskBadgeEl.textContent = `${remaining} left`;
  }

  taskListEl.replaceChildren();

  if (tasks.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'task-empty';
    empty.textContent = 'Add tasks for this focus day.';
    taskListEl.appendChild(empty);
    return;
  }

  for (const task of tasks) {
    const item = document.createElement('li');
    item.className = 'task-item';
    if (task.done) {
      item.classList.add('is-done');
    }

    const label = document.createElement('label');
    label.className = 'task-label';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'task-checkbox';
    checkbox.checked = task.done;
    checkbox.addEventListener('change', () => {
      sendMessage(MESSAGE.TOGGLE_TASK, { taskId: task.id });
    });

    const text = document.createElement('span');
    text.className = 'task-text';
    text.textContent = task.text;

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'task-remove';
    removeBtn.setAttribute('aria-label', `Remove task: ${task.text}`);
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => {
      sendMessage(MESSAGE.REMOVE_TASK, { taskId: task.id });
    });

    label.append(checkbox, text);
    item.append(label, removeBtn);
    taskListEl.appendChild(item);
  }
}

function setArtworkExpanded(expanded) {
  artworkExpanded = expanded;
  artworkToggleEl.setAttribute('aria-expanded', String(expanded));
  artworkBodyEl.hidden = !expanded;
  artworkToggleEl.classList.toggle('is-collapsed', !expanded);
}

artworkToggleEl.addEventListener('click', () => {
  setArtworkExpanded(!artworkExpanded);
});

function renderPhaseControls(state, isPaused) {
  controlsSecondaryEl.hidden = true;
  btnActivate.hidden = true;

  if (state.phase === PHASE.IDLE) {
    timerHintEl.textContent = "Start a focus session when you're ready.";
    btnPrimary.textContent = 'Start focus';
    btnPrimary.dataset.action = 'start';
    return;
  }

  if (state.phase === PHASE.PAINTING_OUT) {
    timerHintEl.textContent = 'Returning to your screen…';
    btnPrimary.hidden = true;
    return;
  }

  if (isPaused) {
    timerHintEl.textContent = 'Timer paused.';
    btnPrimary.textContent = 'Resume';
    btnPrimary.dataset.action = 'resume';
  } else if (state.phase === PHASE.FOCUSING) {
    timerHintEl.textContent = 'Stay focused — paint is waiting.';
    btnPrimary.textContent = 'Pause';
    btnPrimary.dataset.action = 'pause';
  } else if (state.phase === PHASE.RESTING) {
    timerHintEl.textContent = 'Break — today\'s painting is revealing.';
    btnPrimary.textContent = 'Pause';
    btnPrimary.dataset.action = 'pause';
  }

  if (state.phase === PHASE.FOCUSING) {
    controlsSecondaryEl.hidden = false;
    btnActivate.hidden = false;
    btnActivate.textContent = 'Start break';
    btnActivate.dataset.action = 'activate';
  } else if (state.phase === PHASE.RESTING) {
    controlsSecondaryEl.hidden = false;
    btnActivate.hidden = false;
    btnActivate.textContent = 'Skip break';
    btnActivate.dataset.action = 'skip';
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
  renderTasks(state);

  btnSecondary.hidden = state.phase === PHASE.IDLE;

  if (state.phase === PHASE.PAINTING_OUT) {
    timerEl.textContent = '…';
  }

  renderPhaseControls(state, isPaused);
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
  const action = btnActivate.dataset.action;
  if (action === 'skip') {
    await sendMessage(MESSAGE.SKIP_BREAK);
    return;
  }

  const response = await sendMessage(MESSAGE.ACTIVATE);
  if (response?.error) {
    timerHintEl.textContent = response.error;
  }
});

taskFormEl.addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = taskInputEl.value;
  if (!text.trim()) {
    return;
  }
  await sendMessage(MESSAGE.ADD_TASK, { text });
  taskInputEl.value = '';
  taskInputEl.focus();
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === MESSAGE.STATE_UPDATED) {
    render(message.state);
  }
});

async function init() {
  setArtworkExpanded(true);
  const response = await chrome.runtime.sendMessage({ type: MESSAGE.GET_STATE });
  if (response?.ok) {
    render(response.state);
  }
  startTicking();
}

init();

window.addEventListener('unload', stopTicking);
