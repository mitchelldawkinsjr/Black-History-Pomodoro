const HISTORY_KEY = 'blackHistoryDiscoveryHistory';
const LEGACY_HISTORY_KEY = 'paintPomodoroArtworkHistory';
const MAX_SEEN = 400;

export async function loadArtworkHistory() {
  const stored = await chrome.storage.local.get([HISTORY_KEY, LEGACY_HISTORY_KEY]);
  let history = stored[HISTORY_KEY];
  if (!history && stored[LEGACY_HISTORY_KEY]) {
    history = stored[LEGACY_HISTORY_KEY];
    await chrome.storage.local.set({ [HISTORY_KEY]: history });
    await chrome.storage.local.remove(LEGACY_HISTORY_KEY);
  }
  return history ?? { seenObjectIDs: [] };
}

export async function getSeenObjectIDs() {
  const history = await loadArtworkHistory();
  return (history.seenObjectIDs ?? []).map(String);
}

export async function recordSeenArtwork(objectID) {
  if (!objectID) {
    return await getSeenObjectIDs();
  }

  const history = await loadArtworkHistory();
  const seen = new Set((history.seenObjectIDs ?? []).map(String));
  seen.add(String(objectID));

  let seenObjectIDs = [...seen];
  if (seenObjectIDs.length > MAX_SEEN) {
    seenObjectIDs = seenObjectIDs.slice(seenObjectIDs.length - MAX_SEEN);
  }

  await chrome.storage.local.set({ [HISTORY_KEY]: { seenObjectIDs } });
  return seenObjectIDs;
}

export async function ensureCurrentArtworkRecorded(objectID) {
  if (!objectID) {
    return;
  }
  const seen = await getSeenObjectIDs();
  if (!seen.includes(String(objectID))) {
    await recordSeenArtwork(objectID);
  }
}
