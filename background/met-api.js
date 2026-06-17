const MET_API_BASE = 'https://collectionapi.metmuseum.org/public/collection/v1';

export function hashDateKey(dateKey) {
  let hash = 0;
  for (let i = 0; i < dateKey.length; i += 1) {
    hash = (hash * 31 + dateKey.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function isValidOpenAccessArtwork(object) {
  return (
    object &&
    object.isPublicDomain === true &&
    typeof object.primaryImage === 'string' &&
    object.primaryImage.length > 0
  );
}

export function extractArtworkMetadata(object) {
  return {
    objectID: object.objectID,
    title: object.title ?? '',
    artistDisplayName: object.artistDisplayName ?? '',
    artistDisplayBio: object.artistDisplayBio ?? '',
    objectDate: object.objectDate ?? '',
    medium: object.medium ?? '',
    culture: object.culture ?? '',
    period: object.period ?? '',
    department: object.department ?? '',
    country: object.country ?? '',
    dimensions: object.dimensions ?? '',
    creditLine: object.creditLine ?? '',
    primaryImage: object.primaryImage,
    primaryImageSmall: object.primaryImageSmall ?? object.primaryImage,
    objectURL: object.objectURL ?? '',
    isHighlight: object.isHighlight === true,
    tags: object.tags ?? '',
  };
}

export async function fetchObject(objectID) {
  const response = await fetch(`${MET_API_BASE}/objects/${objectID}`);
  if (!response.ok) {
    throw new Error(`Met API error ${response.status} for object ${objectID}`);
  }
  return response.json();
}

export async function searchObjectIds(params = {}) {
  const url = new URL(`${MET_API_BASE}/search`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Met search error ${response.status}`);
  }
  const data = await response.json();
  return data.objectIDs ?? [];
}

export async function loadCuratedIds() {
  const url = chrome.runtime.getURL('data/met-curated-ids.json');
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not load curated IDs (${response.status})`);
  }
  const data = await response.json();
  return data.objectIDs ?? [];
}

export async function pickFromCuratedList(dateKey, curatedIds) {
  if (!curatedIds.length) {
    throw new Error('No curated artwork IDs available');
  }

  const startIndex = hashDateKey(dateKey) % curatedIds.length;
  for (let offset = 0; offset < curatedIds.length; offset += 1) {
    const objectID = curatedIds[(startIndex + offset) % curatedIds.length];
    try {
      const object = await fetchObject(objectID);
      if (isValidOpenAccessArtwork(object)) {
        return extractArtworkMetadata(object);
      }
    } catch (error) {
      console.warn('[PaintPomodoro] Curated object failed', objectID, error);
    }
  }

  throw new Error('Could not load any curated artwork');
}

export async function pickFromSearch(dateKey) {
  const ids = await searchObjectIds({
    isHighlight: true,
    hasImages: true,
    q: 'painting',
  });

  if (!ids.length) {
    throw new Error('Met search returned no results');
  }

  const startIndex = hashDateKey(dateKey) % ids.length;
  const attempts = Math.min(20, ids.length);

  for (let i = 0; i < attempts; i += 1) {
    const objectID = ids[(startIndex + i) % ids.length];
    try {
      const object = await fetchObject(objectID);
      if (isValidOpenAccessArtwork(object)) {
        return extractArtworkMetadata(object);
      }
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error('Search did not yield a valid open-access painting');
}

export async function pickDailyArtwork(dateKey) {
  const curatedIds = await loadCuratedIds();
  try {
    return await pickFromCuratedList(dateKey, curatedIds);
  } catch (error) {
    console.warn('[PaintPomodoro] Curated pick failed, falling back to search', error);
    return pickFromSearch(dateKey);
  }
}
