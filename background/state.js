export const PHASE = {
  IDLE: 'idle',
  FOCUSING: 'focusing',
  RESTING: 'resting',
};

export const ALARM = {
  PHASE_END: 'phase-end',
};

export const MESSAGE = {
  GET_STATE: 'GET_STATE',
  STATE_UPDATED: 'STATE_UPDATED',
  START_FOCUS: 'START_FOCUS',
  START_BREAK: 'START_BREAK',
  PAUSE: 'PAUSE',
  RESUME: 'RESUME',
  RESET: 'RESET',
  SKIP_BREAK: 'SKIP_BREAK',
};

export const DEFAULT_SETTINGS = {
  focusMinutes: 25,
  breakMinutes: 5,
};

export function createDefaultState() {
  return {
    phase: PHASE.IDLE,
    phaseStartedAt: null,
    pausedAt: null,
    remainingMs: null,
    settings: { ...DEFAULT_SETTINGS },
    tasks: [],
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
      return 'Rest break';
    default:
      return 'Ready';
  }
}
