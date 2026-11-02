import { createHash } from 'node:crypto';

export interface NormalizedFact {
  /** Upstream id when present, otherwise a stable hash of the text. */
  providerFactId: string;
  factText: string;
  people: string[];
  tags: string[];
  eventDate: string | null;
  source: { label: string; url: string | null; providerUrl: string | null };
  /** True when upstream gave no usable source; the label is then only the provider name. */
  sourceMissing: boolean;
}

export const UPSTREAM_PROVIDER_LABEL = 'Black History API';

type Rec = Record<string, unknown>;

function isRecord(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function clean(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v !== 'string') return null;
  const s = v
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length ? s : null;
}

function pick(obj: Rec, keys: string[]): unknown {
  for (const k of keys) if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  return undefined;
}

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function stringList(v: unknown, nameKeys: string[]): string[] {
  const out: string[] = [];
  const push = (x: unknown) => {
    const s = isRecord(x) ? clean(pick(x, nameKeys)) : clean(x);
    if (s && !out.some((o) => o.toLowerCase() === s.toLowerCase())) out.push(s);
  };
  if (Array.isArray(v)) v.forEach(push);
  else if (v !== undefined && v !== null) push(v);
  return out;
}

type Source = NormalizedFact['source'];

function parseSourceEntry(entry: unknown): Source | null {
  if (isRecord(entry)) {
    const url = clean(pick(entry, ['url', 'source_url', 'link', 'href', 'uri']));
    const label = clean(pick(entry, ['label', 'title', 'name', 'publisher', 'source', 'citation']));
    const validUrl = url && isHttpUrl(url) ? url : null;
    if (label) return { label, url: validUrl, providerUrl: null };
    if (validUrl) return { label: new URL(validUrl).hostname.replace(/^www\./, ''), url: validUrl, providerUrl: null };
    return null;
  }
  const s = clean(entry);
  if (!s) return null;
  if (isHttpUrl(s)) return { label: new URL(s).hostname.replace(/^www\./, ''), url: s, providerUrl: null };
  return { label: s, url: null, providerUrl: null };
}

function parseSource(item: Rec): Source | null {
  // Newer shape: source_references (array); older shape: source (string or object).
  for (const key of ['source_references', 'sourceReferences', 'source', 'sources']) {
    const v = item[key];
    const entries = Array.isArray(v) ? v : v === undefined || v === null ? [] : [v];
    for (const e of entries) {
      const parsed = parseSourceEntry(e);
      if (parsed) return parsed;
    }
  }
  return null;
}

function sanitizeId(raw: unknown): string | null {
  const s = clean(raw);
  if (!s) return null;
  const safe = s.replace(/[^A-Za-z0-9._-]/g, '');
  return safe.length >= 1 && safe.length <= 100 ? safe : null;
}

/** Normalizes a single upstream item. Returns null when the item has no usable (non-empty) text. */
export function normalizeFactRecord(item: unknown): NormalizedFact | null {
  if (!isRecord(item)) return null;
  const factText = clean(pick(item, ['text', 'factText', 'fact', 'description', 'summary']));
  if (!factText) return null;

  const providerFactId =
    sanitizeId(pick(item, ['_id', 'id', 'factId', 'uuid'])) ??
    `h${createHash('sha256').update(factText).digest('hex').slice(0, 24)}`;
  // Upstream v2 uses related_people/tags as `{ type, value }` objects (not name/title).
  let people = stringList(
    pick(item, ['people', 'related_people', 'relatedPeople', 'person', 'persons']),
    ['value', 'name', 'full_name', 'title', 'label'],
  );
  if (people.length === 0) {
    people = inferPeopleFromText(factText);
  }
  const tags = stringList(
    pick(item, ['tags', 'tag', 'categories', 'category']),
    ['value', 'name', 'title', 'label'],
  );
  const eventDate = clean(pick(item, ['date_of_event', 'eventDate', 'dateOfEvent', 'date', 'event_date']));
  const parsedSource = parseSource(item);

  return {
    providerFactId,
    factText,
    people,
    tags,
    eventDate,
    source: parsedSource ?? { label: UPSTREAM_PROVIDER_LABEL, url: null, providerUrl: null },
    sourceMissing: parsedSource === null,
  };
}

/**
 * Best-effort subject when upstream omits related_people.
 * Only accepts a leading multi-word proper name (e.g. "Langston Hughes was…").
 */
export function inferPeopleFromText(text: string): string[] {
  const trimmed = text.trim();
  const match = trimmed.match(
    /^([A-Z][A-Za-z.'’\-]+(?:\s+[A-Z][A-Za-z.'’\-]+){1,3})\b/,
  );
  if (!match?.[1]) return [];
  const name = match[1].trim();
  if (/^(In|On|At|The|A|An|During|After|Before|When|While|From|For|By)\b/.test(name)) {
    return [];
  }
  return [name];
}

function extractItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!isRecord(payload)) return [];
  for (const key of ['Results', 'results', 'data', 'Data', 'facts']) {
    const v = payload[key];
    if (Array.isArray(v)) return v;
    if (isRecord(v)) {
      // `{ data: { text, ... } }` or nested `{ data: { results: [...] } }`
      return Array.isArray(v.results) ? v.results : Array.isArray(v.Results) ? v.Results : [v];
    }
  }
  // A bare single fact object.
  return 'text' in payload ? [payload] : [];
}

/**
 * Normalizes a Black History API v2 response. Supports:
 *  - older:  { Results: [{ _id, text, people, tags, source }] }
 *  - newer:  { data: [{ text, date_of_event, source_references, ... }] }
 * Items without non-empty text are dropped. No field is ever invented: missing
 * people/tags become empty arrays and a missing source is flagged via `sourceMissing`.
 */
export function extractFactCandidates(payload: unknown): NormalizedFact[] {
  const seen = new Set<string>();
  const out: NormalizedFact[] = [];
  for (const raw of extractItems(payload)) {
    const fact = normalizeFactRecord(raw);
    if (!fact || seen.has(fact.providerFactId)) continue;
    seen.add(fact.providerFactId);
    out.push(fact);
  }
  return out;
}
