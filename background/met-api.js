const MET_API_BASE = 'https://collectionapi.metmuseum.org/public/collection/v1';

/** Rotate search order — non-European departments first for variety. */
export const PAINTING_DEPARTMENTS = [
  { id: 6, label: 'Asian Art' },
  { id: 14, label: 'Islamic Art' },
  { id: 5, label: 'Arts of Africa, Oceania, and the Americas' },
  { id: 21, label: 'Modern and Contemporary Art' },
  { id: 9, label: 'Drawings and Prints' },
  { id: 11, label: 'European Paintings' },
];

const PAINT_MEDIUM_HINTS = [
  'oil on',
  'watercolor',
  'watercolour',
  'tempera',
  'acrylic',
  'gouache',
  'ink on',
  'gilt on',
  'opaque watercolor',
  'color on',
  'colour on',
  'paint on',
  'silk',
  'paper',
];

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

export function isPaintingArtwork(object) {
  if (!object) {
    return false;
  }

  const classification = (object.classification ?? '').toLowerCase();
  if (classification.includes('painting')) {
    return true;
  }

  const medium = (object.medium ?? '').toLowerCase();
  return PAINT_MEDIUM_HINTS.some((hint) => medium.includes(hint));
}

export function isValidPaintingArtwork(object) {
  return isValidOpenAccessArtwork(object) && isPaintingArtwork(object);
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
    repository: object.repository ?? '',
    objectDescription: object.objectDescription ?? '',
    additionalInformation: object.additionalInformation ?? '',
    classification: object.classification ?? '',
    galleryNumber: object.GalleryNumber ?? object.galleryNumber ?? '',
    objectBeginDate: object.objectBeginDate ?? null,
    objectEndDate: object.objectEndDate ?? null,
    isHighlight: object.isHighlight === true,
    isTimelineWork: object.isTimelineWork === true,
    tags: Array.isArray(object.tags)
      ? object.tags.map((tag) => tag?.term).filter(Boolean)
      : [],
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

function normalizeExcludeSet(options = {}) {
  const exclude = new Set(options.excludeObjectIDs ?? []);
  if (options.excludeObjectID != null) {
    exclude.add(options.excludeObjectID);
  }
  return exclude;
}

function filterUnseenIds(ids, excludeSet) {
  return ids.filter((id) => !excludeSet.has(id));
}

export async function pickFromIdPool(seed, ids, options = {}) {
  const excludeSet = normalizeExcludeSet(options);
  const pool = filterUnseenIds(ids, excludeSet);

  if (!pool.length) {
    return null;
  }

  const startIndex = hashDateKey(String(seed)) % pool.length;
  const ordered = [
    ...pool.slice(startIndex),
    ...pool.slice(0, startIndex),
  ];
  const attempts = Math.min(30, ordered.length);

  for (let i = 0; i < attempts; i += 1) {
    const objectID = ordered[i];
    try {
      const object = await fetchObject(objectID);
      if (isValidPaintingArtwork(object)) {
        return extractArtworkMetadata(object);
      }
    } catch (error) {
      console.warn('[PaintPomodoro] Pool object failed', objectID, error);
    }
  }

  return null;
}

export async function pickFromDepartment(departmentId, seed, options = {}) {
  const excludeSet = normalizeExcludeSet(options);

  let ids;
  try {
    ids = await searchObjectIds({
      departmentId,
      hasImages: true,
      isPublicDomain: true,
      q: 'painting',
    });
  } catch (error) {
    console.warn('[PaintPomodoro] Department search failed', departmentId, error);
    return null;
  }

  const pool = filterUnseenIds(ids, excludeSet);
  if (!pool.length) {
    return null;
  }

  const startIndex = hashDateKey(`${seed}-${departmentId}`) % pool.length;
  const attempts = Math.min(24, pool.length);

  for (let i = 0; i < attempts; i += 1) {
    const objectID = pool[(startIndex + i) % pool.length];
    try {
      const object = await fetchObject(objectID);
      if (isValidPaintingArtwork(object)) {
        return extractArtworkMetadata(object);
      }
    } catch (error) {
      console.warn('[PaintPomodoro] Department candidate failed', objectID, error);
    }
  }

  return null;
}

export async function pickDailyArtwork(seed, options = {}) {
  const excludeSet = normalizeExcludeSet(options);
  const departmentOffset = hashDateKey(String(seed)) % PAINTING_DEPARTMENTS.length;

  for (let i = 0; i < PAINTING_DEPARTMENTS.length; i += 1) {
    const department = PAINTING_DEPARTMENTS[(departmentOffset + i) % PAINTING_DEPARTMENTS.length];
    const artwork = await pickFromDepartment(department.id, seed, {
      excludeObjectIDs: [...excludeSet],
    });
    if (artwork) {
      return artwork;
    }
  }

  try {
    const curatedIds = await loadCuratedIds();
    const curatedPick = await pickFromIdPool(seed, curatedIds, {
      excludeObjectIDs: [...excludeSet],
    });
    if (curatedPick) {
      return curatedPick;
    }
  } catch (error) {
    console.warn('[PaintPomodoro] Curated pick failed', error);
  }

  if (excludeSet.size > 0) {
    console.warn('[PaintPomodoro] Unseen pool exhausted; allowing a repeat');
    return pickDailyArtwork(seed, { excludeObjectIDs: [] });
  }

  throw new Error('Could not pick a valid open-access painting');
}
