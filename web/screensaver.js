import { createPaintSketch } from '/overlay/paint-sketch.js';
import {
  generateMarksFromImageUrl,
  packMarksForBreak,
} from '/background/mark-generator.js';
import { getBreakRevealDisplay } from '/background/reveal-tiers.js';
import {
  fetchNextDiscovery,
  toPaintArtwork,
} from '/background/history-api-client.js';
import { MAX_DISCOVERY_BREAKS, SEEN_DISCOVERY_LIMIT } from '/shared/config.js';

const PAINT_MS = 28_000;
const HOLD_MS = 22_000;
const FULL_REVEAL_HOLD_MS = 75_000;
const BETWEEN_DISCOVERY_MS = 4_000;
const SEEN_STORAGE_KEY = 'bhp.screensaver.seen';

const paintContainer = document.getElementById('paint-container');
const revealHud = document.getElementById('reveal-hud');
const revealHudToggle = document.getElementById('reveal-hud-toggle');
const revealProgress = document.getElementById('reveal-progress');
const revealHeadline = document.getElementById('reveal-headline');
const revealSubtitle = document.getElementById('reveal-subtitle');
const revealFact = document.getElementById('reveal-fact');
const revealAttribution = document.getElementById('reveal-attribution');
const revealClues = document.getElementById('reveal-clues');
const revealTimer = document.getElementById('reveal-timer');
const bootScreen = document.getElementById('boot-screen');
const bootStatus = document.getElementById('boot-status');
const chromeBar = document.getElementById('chrome-bar');
const btnEnter = document.getElementById('btn-enter');
const btnInstall = document.getElementById('btn-install');
const btnFullscreen = document.getElementById('btn-fullscreen');
const btnPause = document.getElementById('btn-pause');
const btnSkip = document.getElementById('btn-skip');
const btnNext = document.getElementById('btn-next');

let paintInResolver = null;
let paintOutResolver = null;
let deferredInstallPrompt = null;
let hudExpanded = true;
let paused = false;
let runToken = 0;
let skipLayer = false;
let skipDiscovery = false;
let chromeHideTimer = null;
let phaseEndsAt = null;
let timerInterval = null;

const sketch = createPaintSketch(paintContainer, {
  onPaintInComplete: (dataUrl) => {
    paintInResolver?.(dataUrl ?? null);
    paintInResolver = null;
  },
  onPaintOutComplete: () => {
    paintOutResolver?.();
    paintOutResolver = null;
  },
});

function sleep(ms, token) {
  return new Promise((resolve) => {
    let remaining = ms;
    let last = Date.now();
    const tick = () => {
      if (token !== runToken) {
        resolve('aborted');
        return;
      }
      if (skipLayer || skipDiscovery) {
        resolve('skipped');
        return;
      }
      const now = Date.now();
      if (!paused) {
        remaining -= now - last;
      }
      last = now;
      if (remaining <= 0) {
        resolve('done');
        return;
      }
      setTimeout(tick, 200);
    };
    tick();
  });
}

function loadSeenIds() {
  try {
    const raw = localStorage.getItem(SEEN_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function saveSeenIds(ids) {
  const bounded = ids.slice(-SEEN_DISCOVERY_LIMIT);
  localStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify(bounded));
}

function rememberSeen(id) {
  const next = loadSeenIds().filter((value) => value !== id);
  next.push(id);
  saveSeenIds(next);
  return next;
}

async function waitForApi(maxAttempts = 180) {
  for (let i = 0; i < maxAttempts; i += 1) {
    const api = sketch.getApi();
    if (api?.startPaintIn) {
      return api;
    }
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  return null;
}

function waitForPaintIn() {
  return new Promise((resolve) => {
    paintInResolver = resolve;
  });
}

function waitForPaintOut() {
  return new Promise((resolve) => {
    paintOutResolver = resolve;
  });
}

function latestFactText(unlockedClues = []) {
  const facts = unlockedClues.filter(
    (clue) => clue.kind === 'fact' || clue.label === 'Fact' || clue.label === 'Excerpt',
  );
  return facts.length ? facts[facts.length - 1].value : '';
}

function renderRevealClues(unlockedClues, paintingBreakNumber) {
  revealClues.replaceChildren();
  const metaClues = (unlockedClues ?? []).filter(
    (clue) => !(clue.kind === 'fact' || clue.label === 'Fact' || clue.label === 'Excerpt'),
  );

  if (!metaClues.length && !latestFactText(unlockedClues)) {
    const placeholder = document.createElement('p');
    placeholder.className = 'reveal-clue-placeholder';
    placeholder.textContent = 'The watercolor is just getting started…';
    revealClues.appendChild(placeholder);
    return;
  }

  for (const clue of metaClues) {
    const entry = document.createElement('article');
    entry.className = 'reveal-clue-entry';
    if (clue.breakNumber === paintingBreakNumber) {
      entry.classList.add('is-new');
    }

    const label = document.createElement('h3');
    label.className = 'reveal-clue-label';
    label.textContent = clue.label;

    const value = document.createElement('p');
    value.className = 'reveal-clue-value';
    value.textContent = clue.value;
    entry.append(label, value);

    if (clue.detail && clue.detail !== clue.value) {
      const detail = document.createElement('p');
      detail.className = 'reveal-clue-detail';
      detail.textContent = clue.detail;
      entry.appendChild(detail);
    }

    revealClues.appendChild(entry);
  }
}

function showRevealHud(reveal) {
  const unlocked = reveal.unlockedClues ?? [];
  const paintingBreakNumber = reveal.paintingBreakNumber ?? 1;
  const factText = latestFactText(unlocked);

  revealProgress.textContent = reveal.progressLabel ?? `Discovery ${paintingBreakNumber}/10`;
  revealHeadline.textContent = reveal.headline ?? 'Black history discovery';
  revealSubtitle.textContent =
    paintingBreakNumber >= MAX_DISCOVERY_BREAKS
      ? 'Full Black history fact revealed'
      : 'Facts uncover slowly — sit back and watch';

  if (factText) {
    revealFact.hidden = false;
    revealFact.textContent = factText;
    revealFact.classList.toggle('is-complete', paintingBreakNumber >= MAX_DISCOVERY_BREAKS);
  } else {
    revealFact.hidden = true;
    revealFact.textContent = '';
    revealFact.classList.remove('is-complete');
  }

  if (reveal.attribution) {
    revealAttribution.textContent = reveal.attribution;
  }

  renderRevealClues(unlocked, paintingBreakNumber);
  revealHud.hidden = false;
  revealHud.style.opacity = '1';
  setHudExpanded(true);
}

function setHudExpanded(expanded) {
  hudExpanded = expanded;
  revealHud.classList.toggle('is-collapsed', !expanded);
  revealHudToggle.setAttribute('aria-expanded', String(expanded));
}

function formatTime(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function setPhaseTimer(label, durationMs) {
  phaseEndsAt = Date.now() + durationMs;
  revealTimer.textContent = label === 'paint' ? formatTime(durationMs) : formatTime(durationMs);
  if (timerInterval) {
    clearInterval(timerInterval);
  }
  timerInterval = setInterval(() => {
    if (!phaseEndsAt || paused) {
      return;
    }
    const remaining = phaseEndsAt - Date.now();
    revealTimer.textContent = remaining <= 0 ? '00:00' : formatTime(remaining);
  }, 1000);
}

function clearPhaseTimer(label = 'LIVE') {
  phaseEndsAt = null;
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  revealTimer.textContent = label;
}

async function requestFullscreen() {
  const root = document.documentElement;
  if (document.fullscreenElement) {
    return;
  }
  try {
    await root.requestFullscreen?.({ navigationUI: 'hide' });
  } catch {
    try {
      await root.requestFullscreen?.();
    } catch {
      // Wall tablets may block fullscreen until installed as PWA.
    }
  }
}

function showChromeTemporarily() {
  document.body.classList.add('show-chrome');
  chromeBar.hidden = false;
  clearTimeout(chromeHideTimer);
  chromeHideTimer = setTimeout(() => {
    if (!paused) {
      document.body.classList.remove('show-chrome');
    }
  }, 5000);
}

function setBootStatus(text) {
  bootStatus.textContent = text;
}

function dismissBoot() {
  bootScreen.classList.add('is-gone');
  chromeBar.hidden = false;
}

revealHudToggle.addEventListener('click', () => setHudExpanded(!hudExpanded));

btnEnter.addEventListener('click', async () => {
  await requestFullscreen();
  dismissBoot();
});

btnFullscreen.addEventListener('click', () => requestFullscreen());

btnPause.addEventListener('click', async () => {
  const api = await waitForApi();
  paused = !paused;
  btnPause.textContent = paused ? 'Resume' : 'Pause';
  if (!api) {
    return;
  }
  if (paused) {
    api.pause?.();
    document.body.classList.add('show-chrome');
  } else {
    api.resume?.();
    showChromeTemporarily();
  }
});

btnSkip.addEventListener('click', () => {
  skipLayer = true;
});

btnNext.addEventListener('click', () => {
  skipDiscovery = true;
  skipLayer = true;
});

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  btnInstall.hidden = false;
});

btnInstall.addEventListener('click', async () => {
  if (!deferredInstallPrompt) {
    return;
  }
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice.catch(() => null);
  deferredInstallPrompt = null;
  btnInstall.hidden = true;
});

document.addEventListener('pointerdown', (event) => {
  if (event.target.closest('#boot-screen, #chrome-bar, #reveal-hud')) {
    return;
  }
  showChromeTemporarily();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'f' || event.key === 'F') {
    requestFullscreen();
  }
  if (event.key === ' ') {
    event.preventDefault();
    btnPause.click();
  }
  if (event.key === 'ArrowRight') {
    skipLayer = true;
  }
  if (event.key === 'n' || event.key === 'N') {
    skipDiscovery = true;
    skipLayer = true;
  }
  showChromeTemporarily();
});

async function runLayer(api, {
  artwork,
  marks,
  tier,
  maxBreaks,
  previousCanvas,
  token,
}) {
  skipLayer = false;
  const reveal = getBreakRevealDisplay(artwork, tier, maxBreaks);
  showRevealHud(reveal);
  setPhaseTimer('paint', PAINT_MS);

  const paintDone = waitForPaintIn();
  await api.startPaintIn({
    breakNumber: tier,
    previousCanvas,
    maxBreaks,
    artwork,
    marks: packMarksForBreak(marks, tier),
    paintDurationMs: PAINT_MS,
  });

  const dataUrl = await paintDone;
  if (token !== runToken) {
    return { canvas: dataUrl, aborted: true };
  }

  const holdMs = tier >= maxBreaks ? FULL_REVEAL_HOLD_MS : HOLD_MS;
  setPhaseTimer('hold', holdMs);
  const holdResult = await sleep(holdMs, token);
  clearPhaseTimer(tier >= maxBreaks ? 'DONE' : 'LIVE');

  return {
    canvas: dataUrl || api.checkpointProgress?.() || previousCanvas,
    aborted: holdResult === 'aborted',
    skippedDiscovery: skipDiscovery,
  };
}

async function fetchDiscoveryWithTimeout(excludeIds, ms = 15000) {
  let timer;
  try {
    return await Promise.race([
      fetchNextDiscovery(excludeIds),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Discovery request timed out')), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function runDiscovery(api, token) {
  setBootStatus('Fetching the next discovery…');
  let seen = loadSeenIds();
  let discovery;
  try {
    discovery = await fetchDiscoveryWithTimeout(seen);
  } catch (error) {
    const message = error?.message || 'Could not load a discovery. Retrying…';
    setBootStatus(message);
    // If we've excluded too much, clear history and try a fresh pool.
    if (/NO_ELIGIBLE|404|timed out|RATE_LIMITED|429/i.test(message) && seen.length) {
      saveSeenIds([]);
      seen = [];
    }
    await sleep(5000, token);
    return;
  }

  rememberSeen(discovery.id);
  const artwork = toPaintArtwork(discovery);
  const label = discovery.people?.[0] || discovery.tags?.[0] || 'a new story';
  setBootStatus(`Preparing watercolor for ${label}…`);
  dismissBoot();
  skipDiscovery = false;

  let marks = null;
  try {
    marks = await Promise.race([
      generateMarksFromImageUrl(
        discovery.visual.imageUrl,
        discovery.id,
        MAX_DISCOVERY_BREAKS,
      ),
      sleep(20000, token).then(() => {
        throw new Error('Timed out preparing watercolor marks');
      }),
    ]);
  } catch (error) {
    console.warn('[screensaver] mark generation failed', error);
    marks = null;
  }

  let canvas = null;

  for (let tier = 1; tier <= MAX_DISCOVERY_BREAKS; tier += 1) {
    if (token !== runToken) {
      return;
    }
    const result = await runLayer(api, {
      artwork,
      marks,
      tier,
      maxBreaks: MAX_DISCOVERY_BREAKS,
      previousCanvas: canvas,
      token,
    });
    canvas = result.canvas;
    if (result.aborted || result.skippedDiscovery || skipDiscovery) {
      break;
    }
  }

  if (token !== runToken) {
    return;
  }

  setPhaseTimer('fade', BETWEEN_DISCOVERY_MS);
  const outDone = waitForPaintOut();
  api.startPaintOut?.();
  await Promise.race([outDone, sleep(7000, token)]);
  api.reset?.();
  revealHud.hidden = true;
  clearPhaseTimer('NEXT');
  await sleep(BETWEEN_DISCOVERY_MS, token);
}

async function mainLoop() {
  const api = await waitForApi();
  if (!api) {
    setBootStatus('Paint engine failed to start. Reload the page.');
    return;
  }

  while (true) {
    const token = runToken;
    try {
      await runDiscovery(api, token);
    } catch (error) {
      console.error('[screensaver]', error);
      setBootStatus(error?.message || 'Something went wrong. Retrying…');
      bootScreen.classList.remove('is-gone');
      await sleep(4000, token);
    }
  }
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    return;
  }
  try {
    await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch (error) {
    console.warn('[screensaver] service worker registration failed', error);
  }
}

registerServiceWorker();
mainLoop();

// Auto-dismiss boot once the first discovery is ready enough, without forcing
// fullscreen (browsers block that without a gesture). Wall PWAs already open fullscreen.
if (window.matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches
  || new URLSearchParams(location.search).has('source')) {
  // Keep boot until first discovery paints; enter is optional.
}
