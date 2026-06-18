const HISTORY_KEY = 'paintPomodoroArtworkHistory';
const MAX_SEEN = 400;

export async function loadArtworkHistory() {
  const stored = await chrome.storage.local.get(HISTORY_KEY);
  return stored[HISTORY_KEY] ?? { seenObjectIDs: [] };
}

export async function getSeenObjectIDs() {
  const history = await loadArtworkHistory();
  return history.seenObjectIDs ?? [];
}

export async function recordSeenArtwork(objectID) {
  if (!objectID) {
    return await getSeenObjectIDs();
  }

  const history = await loadArtworkHistory();
  const seen = new Set(history.seenObjectIDs ?? []);
  seen.add(objectID);

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
  if (!seen.includes(objectID)) {
    await recordSeenArtwork(objectID);
  }
}
