import { createHash } from 'node:crypto';

export type NormalizedFact = {
  providerFactId: string;
  factText: string;
  people: string[];
  tags: string[];
  eventDate: string | null;
  source: {
    label: string;
    url: string | null;
    providerUrl: string | null;
  };
};

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === 'string') return entry.trim();
      if (entry && typeof entry === 'object' && 'name' in entry) {
        return asString((entry as { name: unknown }).name) ?? '';
      }
      return '';
    })
    .filter(Boolean);
}

function extractSource(raw: Record<string, unknown>): NormalizedFact['source'] {
  const source = raw.source;
  if (typeof source === 'string' && source.trim()) {
    return { label: source.trim(), url: null, providerUrl: null };
  }
  if (source && typeof source === 'object') {
    const obj = source as Record<string, unknown>;
    return {
      label: asString(obj.label) ?? asString(obj.name) ?? asString(obj.title) ?? 'Black History API',
      url: asString(obj.url) ?? asString(obj.source_url) ?? null,
      providerUrl: asString(obj.providerUrl) ?? null,
    };
  }
  const refs = raw.source_references;
  if (Array.isArray(refs) && refs[0] && typeof refs[0] === 'object') {
    const first = refs[0] as Record<string, unknown>;
    return {
      label: asString(first.source) ?? asString(first.label) ?? 'Black History API',
      url: asString(first.source_url) ?? asString(first.url) ?? null,
      providerUrl: null,
    };
  }
  return { label: 'Black History API', url: null, providerUrl: null };
}

export function normalizeFactRecord(raw: unknown): NormalizedFact | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const factText =
    asString(record.text) ?? asString(record.factText) ?? asString(record.fact) ?? null;
  if (!factText) return null;

  const providerFactId =
    asString(record._id) ??
    asString(record.id) ??
    asString(record.factId) ??
    createHash('sha256').update(factText).digest('hex').slice(0, 24);

  return {
    providerFactId,
    factText,
    people: asStringArray(record.people ?? record.related_people),
    tags: asStringArray(record.tags),
    eventDate:
      asString(record.eventDate) ??
      asString(record.date_of_event) ??
      asString(record.date) ??
      null,
    source: extractSource(record),
  };
}

export function extractFactCandidates(payload: unknown): NormalizedFact[] {
  if (!payload || typeof payload !== 'object') return [];
  const root = payload as Record<string, unknown>;
  for (const bucket of [root.Results, root.data, root.results, root.facts]) {
    if (Array.isArray(bucket)) {
      return bucket
        .map((entry) => normalizeFactRecord(entry))
        .filter((entry): entry is NormalizedFact => entry !== null);
    }
  }
  const single = normalizeFactRecord(payload);
  return single ? [single] : [];
}
