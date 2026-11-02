import { API_BASE_URL, SEEN_DISCOVERY_LIMIT } from '../shared/config.js';

const DISCOVERY_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;

export function isDiscovery(value) {
  return (
    value &&
    typeof value === 'object' &&
    typeof value.id === 'string' &&
    DISCOVERY_ID_RE.test(value.id) &&
    typeof value.factText === 'string' &&
    value.factText.trim().length > 0 &&
    value.visual &&
    typeof value.visual.imageUrl === 'string' &&
    value.visual.imageUrl.trim().length > 0
  );
}

/** True when stored payload came from The Black History API. */
export function isDiscoveryArtwork(artwork) {
  return Boolean(artwork?.objectID && isDiscovery(artwork.discovery));
}

/**
 * Map a HistoricalDiscovery into the shape the watercolor engine expects,
 * while keeping the full discovery for reveal/UI.
 */
export function toPaintArtwork(discovery) {
  if (!isDiscovery(discovery)) {
    throw new Error('Cannot map invalid discovery to reveal payload');
  }
  return {
    objectID: discovery.id,
    primaryImage: discovery.visual.imageUrl,
    primaryImageSmall: discovery.visual.imageUrl,
    title: discovery.visual.title || discovery.people?.[0] || 'Black history discovery',
    discovery,
  };
}

/** Keep only IDs the project API will accept in ?exclude=. */
export function sanitizeExcludeIds(excludeIds = [], limit = 50) {
  const max = Math.min(limit, SEEN_DISCOVERY_LIMIT);
  const out = [];
  const seen = new Set();
  for (const raw of excludeIds) {
    const id = String(raw ?? '').trim();
    if (!id || !DISCOVERY_ID_RE.test(id) || seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push(id);
    if (out.length >= max) {
      break;
    }
  }
  return out;
}

export async function fetchNextDiscovery(excludeIds = []) {
  const bounded = sanitizeExcludeIds(excludeIds);
  const params = new URLSearchParams();
  if (bounded.length) {
    params.set('exclude', bounded.join(','));
  }
  const url = `${API_BASE_URL}/v1/discoveries/next${params.toString() ? `?${params}` : ''}`;
  const response = await fetch(url);
  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.json();
      detail = body?.error?.message ? `: ${body.error.message}` : '';
    } catch {
      // ignore body parse errors
    }
    throw new Error(`Discovery API error ${response.status}${detail}`);
  }
  const payload = await response.json();
  if (!isDiscovery(payload)) {
    throw new Error('Discovery API returned an invalid payload');
  }
  return payload;
}

export async function fetchDiscoveryById(id) {
  if (!DISCOVERY_ID_RE.test(String(id ?? ''))) {
    return null;
  }
  const response = await fetch(`${API_BASE_URL}/v1/discoveries/${encodeURIComponent(id)}`);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Discovery API error ${response.status}`);
  }
  const payload = await response.json();
  return isDiscovery(payload) ? payload : null;
}
