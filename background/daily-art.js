import {
  fetchNextDiscovery,
  isDiscoveryArtwork,
  toPaintArtwork,
} from './history-api-client.js';
import {
  ensureCurrentArtworkRecorded,
  getSeenObjectIDs,
  recordSeenArtwork,
} from './artwork-history.js';
import { MARKS_VERSION, generateMarksFromImageUrl } from './mark-generator.js';
import { MAX_DISCOVERY_BREAKS } from '../shared/config.js';

export const DAILY_ART_KEY = 'blackHistoryDailyArt';
const LEGACY_DAILY_ART_KEY = 'paintPomodoroDailyArt';
export const MAX_DAILY_BREAKS = MAX_DISCOVERY_BREAKS;

export function getTodayKey() {
  return new Date().toLocaleDateString('en-CA');
}

export function getArtworkImageUrl(artwork) {
  if (!artwork) {
    return null;
  }
  return (
    artwork.primaryImage ||
    artwork.primaryImageSmall ||
    artwork.discovery?.visual?.imageUrl ||
    null
  );
}

export function createDefaultDailyArt() {
  return {
    dateKey: getTodayKey(),
    breakCount: 0,
    totalBreakCount: 0,
    canvasDataUrl: null,
    canvasArtworkId: null,
    artwork: null,
    marks: null,
    selectionSeed: getTodayKey(),
    extensionSeed: null,
  };
}

export async function loadDailyArt() {
  const stored = await chrome.storage.local.get([DAILY_ART_KEY, LEGACY_DAILY_ART_KEY]);
  let raw = stored[DAILY_ART_KEY];
  if (!raw && stored[LEGACY_DAILY_ART_KEY]) {
    raw = stored[LEGACY_DAILY_ART_KEY];
    await chrome.storage.local.set({ [DAILY_ART_KEY]: raw });
    await chrome.storage.local.remove(LEGACY_DAILY_ART_KEY);
  }
  const art = raw ?? createDefaultDailyArt();
  return ensureDailyArtCurrent(art);
}

export async function saveDailyArt(art) {
  await chrome.storage.local.set({ [DAILY_ART_KEY]: art });
  return art;
}

/**
 * Calendar day resets tasks elsewhere. Discovery progress persists across days.
 */
export function ensureDailyArtCurrent(art) {
  const today = getTodayKey();
  const totalBreakCount = art.totalBreakCount ?? art.breakCount ?? 0;
  if (art.dateKey !== today) {
    return {
      ...art,
      dateKey: today,
      totalBreakCount,
    };
  }
  if (art.totalBreakCount == null) {
    return { ...art, totalBreakCount };
  }
  return art;
}

export function getPaintingBreakNumber(breakNumber, maxBreaks = MAX_DAILY_BREAKS) {
  if (breakNumber < 1) {
    return 1;
  }
  return ((breakNumber - 1) % maxBreaks) + 1;
}

export async function ensureDailyArtReset() {
  const art = await loadDailyArt();
  const current = ensureDailyArtCurrent(art);
  if (current !== art) {
    await saveDailyArt(current);
  }
  return current;
}

let artworkFetchPromise = null;

async function pickFreshArtwork(_seed, extraExcludeIds = []) {
  const seen = await getSeenObjectIDs();
  const exclude = [...new Set([...seen, ...extraExcludeIds].map(String))];
  const discovery = await fetchNextDiscovery(exclude);
  await recordSeenArtwork(discovery.id);
  return toPaintArtwork(discovery);
}

function hasUsableDiscovery(art) {
  return isDiscoveryArtwork(art?.artwork);
}

function marksNeedRegeneration(art, maxBreaks = MAX_DAILY_BREAKS) {
  if (!hasUsableDiscovery(art)) {
    return false;
  }
  if (!art.marks?.marks?.length) {
    return true;
  }
  return (
    String(art.marks.objectID) !== String(art.artwork.objectID) ||
    art.marks.version !== MARKS_VERSION ||
    Number(art.marks.maxBreaks) !== Number(maxBreaks)
  );
}

function canvasMatchesArtwork(art) {
  if (!art.canvasDataUrl) {
    return true;
  }
  if (!art.artwork?.objectID) {
    return false;
  }
  return String(art.canvasArtworkId) === String(art.artwork.objectID);
}

async function ensureDailyMarks(art, maxBreaks = MAX_DAILY_BREAKS) {
  const periods = Math.max(1, Number(maxBreaks) || MAX_DAILY_BREAKS);
  if (!hasUsableDiscovery(art) || !marksNeedRegeneration(art, periods)) {
    return art;
  }

  const imageUrl = getArtworkImageUrl(art.artwork);
  if (!imageUrl) {
    console.warn('[BlackHistoryPomodoro] Discovery is missing an image URL');
    return art;
  }

  try {
    const marks = await generateMarksFromImageUrl(
      imageUrl,
      art.artwork.objectID,
      periods,
    );

    const canvasChanged =
      art.canvasArtworkId && String(art.canvasArtworkId) !== String(art.artwork.objectID);
    const updated = {
      ...art,
      marks,
      ...(canvasChanged
        ? { canvasDataUrl: null, canvasArtworkId: null, breakCount: 0 }
        : {}),
    };
    await saveDailyArt(updated);
    return updated;
  } catch (error) {
    // Discovery UI should still work even if mark sampling fails.
    console.warn('[BlackHistoryPomodoro] Mark generation failed; keeping discovery', error);
    return art;
  }
}

const SW_SESSION_KEY = 'blackHistorySwSession';
const LEGACY_SW_SESSION_KEY = 'paintPomodoroSwSession';

/**
 * Spec: do NOT rotate discovery on extension reload.
 * Only record a session marker so we can detect restarts without replacing progress.
 */
export async function rotateArtworkIfNewSession() {
  const stored = await chrome.storage.session.get([SW_SESSION_KEY, LEGACY_SW_SESSION_KEY]);
  if (stored[SW_SESSION_KEY] || stored[LEGACY_SW_SESSION_KEY]) {
    if (!stored[SW_SESSION_KEY] && stored[LEGACY_SW_SESSION_KEY]) {
      await chrome.storage.session.set({ [SW_SESSION_KEY]: stored[LEGACY_SW_SESSION_KEY] });
      await chrome.storage.session.remove(LEGACY_SW_SESSION_KEY);
    }
    return false;
  }
  const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await chrome.storage.session.set({ [SW_SESSION_KEY]: sessionId });
  return false;
}

export async function rotateToNextPainting(maxBreaks = MAX_DAILY_BREAKS) {
  artworkFetchPromise = null;
  const previous = await loadDailyArt();
  const seed = `${getTodayKey()}-${Date.now()}`;
  const artwork = await pickFreshArtwork(
    seed,
    previous.artwork?.objectID ? [String(previous.artwork.objectID)] : [],
  );

  const fresh = {
    ...createDefaultDailyArt(),
    dateKey: getTodayKey(),
    artwork,
    selectionSeed: String(seed),
    extensionSeed: previous.extensionSeed ?? String(seed),
    totalBreakCount: previous.totalBreakCount ?? previous.breakCount ?? 0,
    breakCount: 0,
    canvasDataUrl: null,
    canvasArtworkId: null,
    marks: null,
  };

  await saveDailyArt(fresh);
  return ensureDailyMarks(fresh, maxBreaks);
}

export async function rotateForExtensionLoad(seed, previousObjectID = null) {
  // Kept for compatibility; active lifecycle no longer auto-rotates on load.
  return rotateToNextPainting();
}

export async function ensureDailyArtwork(maxBreaks = MAX_DAILY_BREAKS) {
  const periods = Math.max(1, Number(maxBreaks) || MAX_DAILY_BREAKS);
  const art = await ensureDailyArtReset();
  if (hasUsableDiscovery(art)) {
    await ensureCurrentArtworkRecorded(art.artwork.objectID);
  }
  if (
    hasUsableDiscovery(art) &&
    art.marks?.marks?.length &&
    !marksNeedRegeneration(art, periods)
  ) {
    if (art.discoveryLoading || art.discoveryError) {
      const cleared = {
        ...art,
        discoveryLoading: false,
        discoveryError: null,
      };
      await saveDailyArt(cleared);
      return cleared;
    }
    return art;
  }

  if (!artworkFetchPromise) {
    artworkFetchPromise = (async () => {
      try {
        let current = await ensureDailyArtReset();
        current = {
          ...current,
          discoveryLoading: true,
          discoveryError: null,
        };
        await saveDailyArt(current);

        // Drop legacy Met Museum payloads that block Black History discovery fetches.
        if (current.artwork && !hasUsableDiscovery(current)) {
          current = {
            ...current,
            artwork: null,
            marks: null,
            canvasDataUrl: null,
            canvasArtworkId: null,
            breakCount: 0,
          };
          await saveDailyArt(current);
        }

        if (!hasUsableDiscovery(current)) {
          const seed =
            current.extensionSeed ?? current.selectionSeed ?? `${getTodayKey()}-${Date.now()}`;
          const artwork = await pickFreshArtwork(seed);
          current = await ensureDailyArtReset();
          if (!hasUsableDiscovery(current)) {
            current = {
              ...current,
              artwork,
              selectionSeed: String(seed),
              marks: null,
              canvasDataUrl: null,
              canvasArtworkId: null,
              breakCount: 0,
            };
            await saveDailyArt(current);
          } else {
            current = await loadDailyArt();
          }
        }

        const withMarks = await ensureDailyMarks(current, periods);
        const ready = {
          ...withMarks,
          discoveryLoading: false,
          discoveryError: null,
        };
        await saveDailyArt(ready);
        return ready;
      } catch (error) {
        const failed = await loadDailyArt();
        await saveDailyArt({
          ...failed,
          discoveryLoading: false,
          discoveryError: error?.message || 'Could not load today’s discovery',
        });
        throw error;
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

export async function saveDailyCanvas(dataUrl, breakNumber, maxBreaks = MAX_DAILY_BREAKS) {
  return completeBreakProgress(breakNumber, dataUrl, maxBreaks);
}

/**
 * Advance discovery progress for a completed/skipped break.
 * Canvas data is optional — skips still count so clue unlocks keep moving.
 */
export async function completeBreakProgress(
  breakNumber,
  dataUrl = null,
  maxBreaks = MAX_DAILY_BREAKS,
) {
  if (!breakNumber || breakNumber < 1) {
    return ensureDailyArtReset();
  }

  const art = await ensureDailyArtReset();
  const updated = {
    ...art,
    dateKey: getTodayKey(),
    totalBreakCount: Math.max(breakNumber, art.totalBreakCount ?? art.breakCount ?? 0),
    breakCount: getPaintingBreakNumber(breakNumber, maxBreaks),
  };

  if (typeof dataUrl === 'string' && dataUrl.startsWith('data:')) {
    updated.canvasDataUrl = dataUrl;
    updated.canvasArtworkId = art.artwork?.objectID ?? null;
  }

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
  const totalBreakCount = art.totalBreakCount ?? art.breakCount ?? 0;
  return totalBreakCount + 1;
}
