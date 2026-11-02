export const PHASE = {
  IDLE: 'idle',
  FOCUSING: 'focusing',
  PAINTING_IN: 'painting_in',
  RESTING: 'resting',
  PAINTING_OUT: 'painting_out',
};

export const ALARM = {
  PHASE_END: 'phase-end',
  /** Failsafe if overlay never reports PAINT_OUT_DONE (e.g. tab closed mid-fade). */
  PAINT_OUT_WATCHDOG: 'paint-out-watchdog',
};

/** Max time to wait in PAINTING_OUT before forcing a return to focus. */
export const PAINT_OUT_WATCHDOG_MS = 12_000;

export const MESSAGE = {
  GET_STATE: 'GET_STATE',
  STATE_UPDATED: 'STATE_UPDATED',
  START_FOCUS: 'START_FOCUS',
  START_BREAK: 'START_BREAK',
  PAUSE: 'PAUSE',
  RESUME: 'RESUME',
  RESET: 'RESET',
  SKIP_BREAK: 'SKIP_BREAK',
  ACTIVATE: 'ACTIVATE',
  UPDATE_SETTINGS: 'UPDATE_SETTINGS',
  ADD_TASK: 'ADD_TASK',
  TOGGLE_TASK: 'TOGGLE_TASK',
  REMOVE_TASK: 'REMOVE_TASK',
  CANVAS_SAVED: 'CANVAS_SAVED',
  CHECKPOINT_DONE: 'CHECKPOINT_DONE',
  PAINT_IN_DONE: 'PAINT_IN_DONE',
  PAINT_OUT_DONE: 'PAINT_OUT_DONE',
  BREAK_TIMER_EXPIRED: 'BREAK_TIMER_EXPIRED',
};

export const OVERLAY = {
  SHOW: 'OVERLAY_SHOW',
  HIDE: 'OVERLAY_HIDE',
  COMMAND: 'OVERLAY_COMMAND',
};

export const DEFAULT_SETTINGS = {
  focusMinutes: 25,
  breakMinutes: 5,
  /** Focus/break cycles used to fully reveal one discovery painting. */
  discoveryPeriods: 10,
  paintRevealSeconds: 20,
  paintOutSeconds: 25,
};

export const SETTINGS_LIMITS = {
  focusMinutes: { min: 1, max: 180 },
  breakMinutes: { min: 1, max: 60 },
  discoveryPeriods: { min: 3, max: 20 },
  paintRevealSeconds: { min: 5, max: 120 },
  paintOutSeconds: { min: 5, max: 120 },
};

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, n));
}

/** Merge + clamp user settings against defaults. */
export function normalizeSettings(partial = {}, base = DEFAULT_SETTINGS) {
  const merged = { ...DEFAULT_SETTINGS, ...base, ...partial };
  return {
    focusMinutes: clampInt(
      merged.focusMinutes,
      SETTINGS_LIMITS.focusMinutes.min,
      SETTINGS_LIMITS.focusMinutes.max,
      DEFAULT_SETTINGS.focusMinutes,
    ),
    breakMinutes: clampInt(
      merged.breakMinutes,
      SETTINGS_LIMITS.breakMinutes.min,
      SETTINGS_LIMITS.breakMinutes.max,
      DEFAULT_SETTINGS.breakMinutes,
    ),
    discoveryPeriods: clampInt(
      merged.discoveryPeriods,
      SETTINGS_LIMITS.discoveryPeriods.min,
      SETTINGS_LIMITS.discoveryPeriods.max,
      DEFAULT_SETTINGS.discoveryPeriods,
    ),
    paintRevealSeconds: clampInt(
      merged.paintRevealSeconds,
      SETTINGS_LIMITS.paintRevealSeconds.min,
      SETTINGS_LIMITS.paintRevealSeconds.max,
      DEFAULT_SETTINGS.paintRevealSeconds,
    ),
    paintOutSeconds: clampInt(
      merged.paintOutSeconds,
      SETTINGS_LIMITS.paintOutSeconds.min,
      SETTINGS_LIMITS.paintOutSeconds.max,
      DEFAULT_SETTINGS.paintOutSeconds,
    ),
  };
}

export function createDefaultState() {
  return {
    phase: PHASE.IDLE,
    phaseStartedAt: null,
    pausedAt: null,
    remainingMs: null,
    settings: { ...DEFAULT_SETTINGS },
    tasks: [],
    tasksDateKey: null,
  };
}

export function createTask(text) {
  return {
    id: crypto.randomUUID(),
    text: text.trim(),
    done: false,
  };
}

export function getPhaseDurationMs(state) {
  const { focusMinutes, breakMinutes } = state.settings;
  if (state.phase === PHASE.FOCUSING) {
    return focusMinutes * 60 * 1000;
  }
  if (state.phase === PHASE.RESTING) {
    return breakMinutes * 60 * 1000;
  }
  return 0;
}

export function getRemainingMs(state, now = Date.now()) {
  if (state.phase === PHASE.IDLE) {
    return 0;
  }

  if (
    state.phase === PHASE.PAINTING_IN ||
    state.phase === PHASE.PAINTING_OUT
  ) {
    return 0;
  }

  if (state.pausedAt !== null && state.remainingMs !== null) {
    return state.remainingMs;
  }

  const durationMs = getPhaseDurationMs(state);
  const elapsed = now - state.phaseStartedAt;
  return Math.max(0, durationMs - elapsed);
}

export function getPhaseLabel(phase) {
  switch (phase) {
    case PHASE.FOCUSING:
      return 'Focus session';
    case PHASE.RESTING:
      return 'Rest break — discovery';
    case PHASE.PAINTING_OUT:
      return 'Starting focus…';
    default:
      return 'Ready';
  }
}
