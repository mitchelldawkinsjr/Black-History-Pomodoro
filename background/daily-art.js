import { pickDailyArtwork } from './met-api.js';

export const DAILY_ART_KEY = 'paintPomodoroDailyArt';
export const MAX_DAILY_BREAKS = 10;

export function getTodayKey() {
  return new Date().toLocaleDateString('en-CA');
}

export function createDefaultDailyArt() {
  return {
    dateKey: getTodayKey(),
    breakCount: 0,
    canvasDataUrl: null,
    artwork: null,
    selectionSeed: getTodayKey(),
  };
}

export async function loadDailyArt() {
  const stored = await chrome.storage.local.get(DAILY_ART_KEY);
  const art = stored[DAILY_ART_KEY] ?? createDefaultDailyArt();
  return ensureDailyArtCurrent(art);
}

export async function saveDailyArt(art) {
  await chrome.storage.local.set({ [DAILY_ART_KEY]: art });
  return art;
}

export function ensureDailyArtCurrent(art) {
  const today = getTodayKey();
  if (art.dateKey !== today) {
    return createDefaultDailyArt();
  }
  return art;
}

export async function ensureDailyArtReset() {
  const art = await loadDailyArt();
  if (art.dateKey === getTodayKey()) {
    return art;
  }
  const fresh = createDefaultDailyArt();
  await saveDailyArt(fresh);
  return fresh;
}

let artworkFetchPromise = null;

export async function ensureDailyArtwork() {
  const art = await ensureDailyArtReset();
  if (art.artwork?.objectID) {
    return art;
  }

  if (!artworkFetchPromise) {
    artworkFetchPromise = (async () => {
      try {
        const artwork = await pickDailyArtwork(art.selectionSeed ?? art.dateKey);
        const current = await ensureDailyArtReset();
        if (current.artwork?.objectID) {
          return current;
        }
        const updated = { ...current, artwork, selectionSeed: current.dateKey };
        await saveDailyArt(updated);
        return updated;
      } finally {
        artworkFetchPromise = null;
      }
    })();
  }

  return artworkFetchPromise;
}

export async function clearDailyCanvas() {
  const art = await ensureDailyArtReset();
  const cleared = { ...art, breakCount: 0, canvasDataUrl: null };
  await saveDailyArt(cleared);
  return cleared;
}

export async function saveDailyCanvas(dataUrl, breakCount) {
  const art = await ensureDailyArtReset();
  const updated = {
    ...art,
    dateKey: getTodayKey(),
    breakCount,
    canvasDataUrl: dataUrl,
  };
  await saveDailyArt(updated);
  return updated;
}

export function getNextBreakNumber(art) {
  return Math.min(art.breakCount + 1, MAX_DAILY_BREAKS);
}
