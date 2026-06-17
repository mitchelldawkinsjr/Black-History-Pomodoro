import { pickDailyArtwork } from './met-api.js';
import { MARKS_VERSION, generateMarksFromImageUrl } from './mark-generator.js';

export const DAILY_ART_KEY = 'paintPomodoroDailyArt';
export const MAX_DAILY_BREAKS = 10;

export function getTodayKey() {
  return new Date().toLocaleDateString('en-CA');
}

export function getArtworkImageUrl(artwork) {
  if (!artwork) {
    return null;
  }
  return artwork.primaryImage || artwork.primaryImageSmall || null;
}

export function createDefaultDailyArt() {
  return {
    dateKey: getTodayKey(),
    breakCount: 0,
    canvasDataUrl: null,
    canvasArtworkId: null,
    artwork: null,
    marks: null,
    selectionSeed: getTodayKey(),
    extensionSeed: null,
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

function marksNeedRegeneration(art) {
  if (!art.artwork?.objectID) {
    return false;
  }
  if (!art.marks?.marks?.length) {
    return true;
  }
  return (
    art.marks.objectID !== art.artwork.objectID ||
    art.marks.version !== MARKS_VERSION
  );
}

function canvasMatchesArtwork(art) {
  if (!art.canvasDataUrl) {
    return true;
  }
  if (!art.artwork?.objectID) {
    return false;
  }
  return art.canvasArtworkId === art.artwork.objectID;
}

async function ensureDailyMarks(art) {
  if (!art.artwork?.objectID || !marksNeedRegeneration(art)) {
    return art;
  }

  const imageUrl = getArtworkImageUrl(art.artwork);
  if (!imageUrl) {
    throw new Error('Artwork is missing an image URL');
  }

  const marks = await generateMarksFromImageUrl(
    imageUrl,
    art.artwork.objectID,
    MAX_DAILY_BREAKS,
  );

  const canvasChanged = art.canvasArtworkId && art.canvasArtworkId !== art.artwork.objectID;
  const updated = {
    ...art,
    marks,
    ...(canvasChanged
      ? { canvasDataUrl: null, canvasArtworkId: null, breakCount: 0 }
      : {}),
  };
  await saveDailyArt(updated);
  return updated;
}

/** Pick a fresh artwork — used on extension install/reload. Daily rotation comes later. */
export async function rotateForExtensionLoad(seed, previousObjectID = null) {
  artworkFetchPromise = null;

  const artwork = await pickDailyArtwork(String(seed), {
    excludeObjectID: previousObjectID,
  });

  const fresh = {
    ...createDefaultDailyArt(),
    dateKey: getTodayKey(),
    artwork,
    selectionSeed: String(seed),
    extensionSeed: String(seed),
    breakCount: 0,
    canvasDataUrl: null,
    canvasArtworkId: null,
    marks: null,
  };

  await saveDailyArt(fresh);
  return ensureDailyMarks(fresh);
}

export async function ensureDailyArtwork() {
  const art = await ensureDailyArtReset();
  if (art.artwork?.objectID && art.marks?.marks?.length && !marksNeedRegeneration(art)) {
    return art;
  }

  if (!artworkFetchPromise) {
    artworkFetchPromise = (async () => {
      try {
        let current = await ensureDailyArtReset();

        if (!current.artwork?.objectID) {
          const seed = current.extensionSeed ?? current.selectionSeed ?? current.dateKey;
          const artwork = await pickDailyArtwork(String(seed));
          current = await ensureDailyArtReset();
          if (!current.artwork?.objectID) {
            current = {
              ...current,
              artwork,
              selectionSeed: String(seed),
            };
            await saveDailyArt(current);
          } else {
            current = await loadDailyArt();
          }
        }

        return ensureDailyMarks(current);
      } finally {
        artworkFetchPromise = null;
      }
    })();
  }

  return artworkFetchPromise;
}

export async function clearDailyCanvas() {
  const art = await ensureDailyArtReset();
  const cleared = {
    ...art,
    breakCount: 0,
    canvasDataUrl: null,
    canvasArtworkId: null,
  };
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
    canvasArtworkId: art.artwork?.objectID ?? null,
  };
  await saveDailyArt(updated);
  return updated;
}

export function getCanvasForBreak(art) {
  if (!canvasMatchesArtwork(art)) {
    return null;
  }
  return art.canvasDataUrl ?? null;
}

export function getNextBreakNumber(art) {
  return Math.min(art.breakCount + 1, MAX_DAILY_BREAKS);
}
