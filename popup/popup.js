import {
  MESSAGE,
  PHASE,
  getPhaseLabel,
} from '../background/state.js';

const phaseLabelEl = document.getElementById('phase-label');
const timerEl = document.getElementById('timer');
const timerHintEl = document.getElementById('timer-hint');
const durationSettingsEl = document.getElementById('duration-settings');
const focusMinutesEl = document.getElementById('focus-minutes');
const breakMinutesEl = document.getElementById('break-minutes');
const discoveryPeriodsEl = document.getElementById('discovery-periods');
const btnPrimary = document.getElementById('btn-primary');
const btnSecondary = document.getElementById('btn-secondary');
const btnActivate = document.getElementById('btn-activate');
const controlsSecondaryEl = document.getElementById('controls-secondary');
const discoveryProgressEl = document.getElementById('discovery-progress');
const discoveryTitleEl = document.getElementById('discovery-title');
const discoveryFactEl = document.getElementById('discovery-fact');
const discoveryCluesEl = document.getElementById('discovery-clues');
const discoveryBadgeEl = document.getElementById('discovery-badge');
const discoveryToggleEl = document.getElementById('discovery-toggle');
const discoveryBodyEl = document.getElementById('discovery-body');
const taskFormEl = document.getElementById('task-form');
const taskInputEl = document.getElementById('task-input');
const taskListEl = document.getElementById('task-list');
const taskBadgeEl = document.getElementById('task-badge');

const FOCUS_MIN = 1;
const FOCUS_MAX = 180;
const BREAK_MIN = 1;
const BREAK_MAX = 60;
const PERIODS_MIN = 3;
const PERIODS_MAX = 20;

let currentState = null;
let tickInterval = null;
let discoveryExpanded = true;
let settingsSaveTimer = null;

function clampMinutes(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, n));
}

function settingsEditable(_state) {
  // Durations can always be changed; an active session keeps its current remaining time.
  return true;
}

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

function renderDailyDiscovery(state) {
  const daily = state.dailyArt ?? { breakCount: 0, totalBreakCount: 0, maxBreaks: 10 };
  const display = daily.artworkDisplay ?? {
    headline: daily.artworkReady ? 'Today\'s discovery' : 'Loading today\'s discovery…',
    latestClue: null,
    titleUnlocked: false,
  };

  const totalBreakCount = daily.totalBreakCount ?? daily.breakCount ?? 0;
  const maxBreaks = daily.maxBreaks ?? 10;
  const currentBreak = state.phase === PHASE.RESTING ? totalBreakCount + 1 : totalBreakCount;
  if (currentBreak > 0) {
    discoveryProgressEl.textContent = `Discovery ${Math.min(currentBreak, maxBreaks)}/${maxBreaks}`;
    discoveryProgressEl.hidden = false;
  } else if (daily.artworkReady) {
    discoveryProgressEl.textContent = `Ready · ${maxBreaks} clues`;
    discoveryProgressEl.hidden = false;
  } else {
    discoveryProgressEl.hidden = true;
  }

  if (daily.discoveryError && !daily.artworkReady) {
    discoveryTitleEl.textContent = 'Couldn’t load today’s discovery';
  } else if (daily.discoveryLoading && !daily.artworkReady) {
    discoveryTitleEl.textContent = 'Loading today’s discovery…';
  } else {
    discoveryTitleEl.textContent = display.headline;
  }

  const factClues = (display.clues ?? []).filter(
    (clue) => clue.kind === 'fact' || clue.label === 'Fact' || clue.label === 'Excerpt',
  );
  const metaClues = (display.clues ?? []).filter(
    (clue) => !(clue.kind === 'fact' || clue.label === 'Fact' || clue.label === 'Excerpt'),
  );
  const factText = display.factText
    || (factClues.length ? factClues[factClues.length - 1].value : '');

  if (discoveryFactEl) {
    if (factText) {
      discoveryFactEl.hidden = false;
      discoveryFactEl.textContent = factText;
      discoveryFactEl.classList.toggle('is-complete', Boolean(display.factComplete));
    } else {
      discoveryFactEl.hidden = true;
      discoveryFactEl.textContent = '';
      discoveryFactEl.classList.remove('is-complete');
    }
  }

  discoveryCluesEl.replaceChildren();
  if (metaClues.length) {
    discoveryCluesEl.hidden = false;
    for (const clue of metaClues) {
      const entry = document.createElement('div');
      entry.className = 'discovery-clue-entry';

      const label = document.createElement('span');
      label.className = 'discovery-clue-label';
      label.textContent = clue.label;

      const value = document.createElement('p');
      value.className = 'discovery-clue-value';
      value.textContent = clue.value;

      entry.append(label, value);

      if (clue.detail && clue.detail !== clue.value) {
        const detail = document.createElement('p');
        detail.className = 'discovery-clue-detail';
        detail.textContent = clue.detail;
        entry.appendChild(detail);
      }

      discoveryCluesEl.appendChild(entry);
    }
  } else if (daily.discoveryError && !daily.artworkReady) {
    discoveryCluesEl.hidden = false;
    const hint = document.createElement('p');
    hint.className = 'discovery-clue-empty';
    hint.textContent = daily.discoveryError;
    discoveryCluesEl.appendChild(hint);
  } else if (daily.breakCount === 0 && daily.artworkReady) {
    discoveryCluesEl.hidden = false;
    const hint = document.createElement('p');
    hint.className = 'discovery-clue-empty';
    hint.textContent = 'Finish a focus session to start uncovering the fact.';
    discoveryCluesEl.appendChild(hint);
  } else if (!daily.artworkReady) {
    discoveryCluesEl.hidden = false;
    const hint = document.createElement('p');
    hint.className = 'discovery-clue-empty';
    hint.textContent = 'Fetching a sourced Black history fact…';
    discoveryCluesEl.appendChild(hint);
  } else {
    discoveryCluesEl.hidden = true;
  }

  discoveryBadgeEl.textContent = display.factComplete
    ? 'Revealed'
    : daily.artworkReady
      ? 'Ready'
      : 'Black History';
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

function setDiscoveryExpanded(expanded) {
  discoveryExpanded = expanded;
  discoveryToggleEl.setAttribute('aria-expanded', String(expanded));
  discoveryBodyEl.hidden = !expanded;
  discoveryToggleEl.classList.toggle('is-collapsed', !expanded);
}

discoveryToggleEl.addEventListener('click', () => {
  setDiscoveryExpanded(!discoveryExpanded);
});

function renderDurationSettings(state) {
  const settings = state.settings ?? {};
  const editable = settingsEditable(state);
  const focusValue = clampMinutes(
    settings.focusMinutes,
    FOCUS_MIN,
    FOCUS_MAX,
    25,
  );
  const breakValue = clampMinutes(
    settings.breakMinutes,
    BREAK_MIN,
    BREAK_MAX,
    5,
  );
  const periodsValue = clampMinutes(
    settings.discoveryPeriods,
    PERIODS_MIN,
    PERIODS_MAX,
    10,
  );

  if (document.activeElement !== focusMinutesEl) {
    focusMinutesEl.value = String(focusValue);
  }
  if (document.activeElement !== breakMinutesEl) {
    breakMinutesEl.value = String(breakValue);
  }
  if (document.activeElement !== discoveryPeriodsEl) {
    discoveryPeriodsEl.value = String(periodsValue);
  }

  focusMinutesEl.disabled = !editable;
  breakMinutesEl.disabled = !editable;
  discoveryPeriodsEl.disabled = !editable;
  durationSettingsEl.classList.toggle('is-locked', !editable);
  for (const button of durationSettingsEl.querySelectorAll('.duration-step')) {
    button.disabled = !editable;
  }
}

function queueDurationSettings(partial) {
  clearTimeout(settingsSaveTimer);
  settingsSaveTimer = setTimeout(() => {
    sendMessage(MESSAGE.UPDATE_SETTINGS, { settings: partial });
  }, 200);
}

function readSettingsFromInputs() {
  return {
    focusMinutes: clampMinutes(
      focusMinutesEl.value,
      FOCUS_MIN,
      FOCUS_MAX,
      currentState?.settings?.focusMinutes ?? 25,
    ),
    breakMinutes: clampMinutes(
      breakMinutesEl.value,
      BREAK_MIN,
      BREAK_MAX,
      currentState?.settings?.breakMinutes ?? 5,
    ),
    discoveryPeriods: clampMinutes(
      discoveryPeriodsEl.value,
      PERIODS_MIN,
      PERIODS_MAX,
      currentState?.settings?.discoveryPeriods ?? 10,
    ),
  };
}

function commitDurationInputs() {
  if (!currentState || !settingsEditable(currentState)) {
    return;
  }
  const next = readSettingsFromInputs();
  focusMinutesEl.value = String(next.focusMinutes);
  breakMinutesEl.value = String(next.breakMinutes);
  discoveryPeriodsEl.value = String(next.discoveryPeriods);
  queueDurationSettings(next);
}

function renderPhaseControls(state, isPaused) {
  controlsSecondaryEl.hidden = true;
  btnActivate.hidden = true;

  if (state.phase === PHASE.IDLE) {
    timerHintEl.textContent = 'Adjust focus, break, and periods below, then start.';
    btnPrimary.textContent = 'Start focus';
    btnPrimary.dataset.action = 'start';
    return;
  }

  if (state.phase === PHASE.PAINTING_OUT) {
    // Transitional only — next focus starts automatically; no Continue needed.
    timerHintEl.textContent = 'Starting next focus session…';
    btnPrimary.hidden = true;
    return;
  }

  if (isPaused) {
    timerHintEl.textContent = 'Timer paused.';
    btnPrimary.textContent = 'Resume';
    btnPrimary.dataset.action = 'resume';
  } else if (state.phase === PHASE.FOCUSING) {
    timerHintEl.textContent = 'Stay focused — a discovery is waiting.';
    btnPrimary.textContent = 'Pause';
    btnPrimary.dataset.action = 'pause';
  } else if (state.phase === PHASE.RESTING) {
    timerHintEl.textContent = 'Break — today\'s discovery is revealing.';
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
  renderDurationSettings(state);
  renderDailyDiscovery(state);
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

focusMinutesEl.addEventListener('change', commitDurationInputs);
breakMinutesEl.addEventListener('change', commitDurationInputs);
discoveryPeriodsEl.addEventListener('change', commitDurationInputs);
for (const input of [focusMinutesEl, breakMinutesEl, discoveryPeriodsEl]) {
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitDurationInputs();
      input.blur();
    }
  });
}

durationSettingsEl.addEventListener('click', (event) => {
  const button = event.target.closest('.duration-step');
  if (!button || !currentState || !settingsEditable(currentState)) {
    return;
  }
  const field = button.dataset.field;
  const delta = Number.parseInt(button.dataset.delta, 10) || 0;
  const current = readSettingsFromInputs();

  if (field === 'focusMinutes') {
    current.focusMinutes = clampMinutes(
      current.focusMinutes + delta,
      FOCUS_MIN,
      FOCUS_MAX,
      25,
    );
  } else if (field === 'breakMinutes') {
    current.breakMinutes = clampMinutes(
      current.breakMinutes + delta,
      BREAK_MIN,
      BREAK_MAX,
      5,
    );
  } else if (field === 'discoveryPeriods') {
    current.discoveryPeriods = clampMinutes(
      current.discoveryPeriods + delta,
      PERIODS_MIN,
      PERIODS_MAX,
      10,
    );
  } else {
    return;
  }

  focusMinutesEl.value = String(current.focusMinutes);
  breakMinutesEl.value = String(current.breakMinutes);
  discoveryPeriodsEl.value = String(current.discoveryPeriods);
  queueDurationSettings(current);
});

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
  setDiscoveryExpanded(true);
  const response = await chrome.runtime.sendMessage({ type: MESSAGE.GET_STATE });
  if (response?.ok) {
    render(response.state);
  }
  startTicking();
}

init();

window.addEventListener('unload', stopTicking);
