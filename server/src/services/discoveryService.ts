import fs from 'node:fs/promises';
import { extractFactCandidates, type NormalizedFact } from '../providers/blackHistoryAdapter.js';
import { UpstreamError, type FactSource } from '../providers/blackHistoryClient.js';
import {
  ApiError,
  HistoricalDiscoverySchema,
  ReviewedFallbackFileSchema,
  type HistoricalDiscovery,
} from '../schemas/discovery.js';
import type { ImageMatcher } from './imageMatcher.js';
import type { MediaStore } from './mediaStore.js';

const UPSTREAM_ID_PREFIX = 'bha-';
const UPSTREAM_FETCHES_PER_REQUEST = 3;

// ---- Inline ultimate-backup fallbacks -------------------------------------
// Facts are paraphrased from the cited National Park Service biography pages.
// Images are public-domain files on Wikimedia Commons (960px renditions on upload.wikimedia.org;
// Commons only serves standard thumbnail widths, e.g. 960px, not 800px).
// These mirror data/reviewed-fallbacks.json (same ids); file entries take precedence.

interface InlineSpec {
  key: string;
  fact: string;
  person: string;
  tags: string[];
  eventDate: string;
  source: { label: string; url: string };
  imageUrl: string;
  fileTitle: string;
  creator: string | null;
  filePage: string;
  width: number;
  height: number;
}

const INLINE_SPECS: InlineSpec[] = [
  {
    key: 'douglass',
    fact: 'On September 3, 1838, Frederick Douglass escaped slavery by boarding a northbound train disguised as a sailor.',
    person: 'Frederick Douglass',
    tags: ['Abolition', 'Escape from slavery', '19th century'],
    eventDate: '1838-09-03',
    source: {
      label: 'National Park Service — Frederick Douglass',
      url: 'https://www.nps.gov/people/frederick-douglass.htm',
    },
    imageUrl:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/Frederick_Douglass_%28circa_1879%29.jpg/960px-Frederick_Douglass_%28circa_1879%29.jpg',
    fileTitle: 'Frederick Douglass (circa 1879).jpg',
    creator: 'George Kendall Warren',
    filePage: 'https://commons.wikimedia.org/wiki/File:Frederick_Douglass_(circa_1879).jpg',
    width: 960,
    height: 1379,
  },
  {
    key: 'tubman',
    fact: 'After escaping slavery in 1849, Harriet Tubman spent about ten years making roughly 13 trips into Maryland to rescue her family and friends.',
    person: 'Harriet Tubman',
    tags: ['Underground Railroad', 'Abolition', '19th century'],
    eventDate: '1849',
    source: {
      label: 'National Park Service — Harriet Tubman',
      url: 'https://www.nps.gov/people/harriet-tubman.htm',
    },
    imageUrl:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/9/96/Harriet_Tubman_by_Squyer%2C_NPG%2C_c1885.jpg/960px-Harriet_Tubman_by_Squyer%2C_NPG%2C_c1885.jpg',
    fileTitle: 'Harriet Tubman by Squyer, NPG, c1885.jpg',
    creator: 'Horatio Seymour Squyer',
    filePage: 'https://commons.wikimedia.org/wiki/File:Harriet_Tubman_by_Squyer,_NPG,_c1885.jpg',
    width: 960,
    height: 1280,
  },
  {
    key: 'carver',
    fact: 'George Washington Carver worked at the Tuskegee Institute in Alabama for 47 years, where he taught crop rotation and introduced alternative cash crops.',
    person: 'George Washington Carver',
    tags: ['Agriculture', 'Education', 'Science'],
    eventDate: '1896',
    source: {
      label: 'National Park Service — George Washington Carver',
      url: 'https://www.nps.gov/people/george-washington-carver.htm',
    },
    imageUrl:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2a/George_Washington_Carver_c1910.jpg/960px-George_Washington_Carver_c1910.jpg',
    fileTitle: 'George Washington Carver c1910.jpg',
    creator: null,
    filePage: 'https://commons.wikimedia.org/wiki/File:George_Washington_Carver_c1910.jpg',
    width: 960,
    height: 1201,
  },
  {
    key: 'truth',
    fact: 'In May 1851, Sojourner Truth attended the Ohio Women\'s Rights Convention in Akron, where she delivered her speech "Ain\'t I a Woman?"',
    person: 'Sojourner Truth',
    tags: ["Women's rights", 'Abolition', 'Oratory'],
    eventDate: '1851-05',
    source: {
      label: 'National Park Service — Sojourner Truth',
      url: 'https://www.nps.gov/people/sojourner-truth.htm',
    },
    imageUrl:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0d/Sojourner_Truth_c1864.jpg/960px-Sojourner_Truth_c1864.jpg',
    fileTitle: 'Sojourner Truth c1864.jpg',
    creator: null,
    filePage: 'https://commons.wikimedia.org/wiki/File:Sojourner_Truth_c1864.jpg',
    width: 960,
    height: 1505,
  },
];

/** Raw (file-shaped) inline fallbacks; visual.imageUrl is the approved upstream Commons URL. */
export const INLINE_FALLBACKS: HistoricalDiscovery[] = INLINE_SPECS.map((s) => ({
  id: `bhf-fallback-${s.key}-001`,
  provider: 'curated' as const,
  providerFactId: `curated-${s.key}-001`,
  factText: s.fact,
  people: [s.person],
  tags: s.tags,
  eventDate: s.eventDate,
  source: { label: s.source.label, url: s.source.url, providerUrl: null },
  visual: {
    assetId: `asset-${s.key}-001`,
    imageUrl: s.imageUrl,
    title: s.fileTitle.replace(/\.[a-z]+$/i, ''),
    alt: `Photograph or portrait of ${s.person}`,
    creator: s.creator,
    sourceUrl: s.filePage,
    license: 'Public domain',
    licenseUrl: null,
    licenseKind: 'public-domain' as const,
    credit: `Wikimedia Commons${s.creator ? ` / ${s.creator}` : ''} — public domain`,
    depictionType: 'photo' as const,
    depictsSubject: true,
    width: s.width,
    height: s.height,
    reviewedAt: '2026-11-02T00:00:00Z',
  },
  generatedAt: '2026-11-02T00:00:00Z',
  schemaVersion: 1 as const,
}));

/** Loads data/reviewed-fallbacks.json if present. Invalid entries are skipped; a missing file yields []. */
export async function loadReviewedFallbacks(
  file: string,
  onSkip?: (reason: string) => void,
): Promise<HistoricalDiscovery[]> {
  let parsedFile: unknown;
  try {
    parsedFile = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    onSkip?.(`reviewed fallbacks file not readable: ${file}`);
    return [];
  }
  const shape = ReviewedFallbackFileSchema.safeParse(parsedFile);
  if (!shape.success) {
    onSkip?.('reviewed fallbacks file has an unexpected shape');
    return [];
  }
  const entries = Array.isArray(shape.data) ? shape.data : shape.data.discoveries;
  const out: HistoricalDiscovery[] = [];
  for (const entry of entries) {
    const r = HistoricalDiscoverySchema.safeParse(entry);
    if (r.success) out.push(r.data);
    else onSkip?.('skipped an invalid reviewed fallback entry');
  }
  return out;
}

// ---- Service ----------------------------------------------------------------

export interface DiscoveryServiceOptions {
  source: FactSource | null;
  matcher: ImageMatcher;
  mediaStore: MediaStore;
  publicOrigin: string;
  cacheTtlSeconds: number;
  /** Raw fallbacks (file entries first); the inline set is always appended as the ultimate backup. */
  fallbacks?: HistoricalDiscovery[];
  now?: () => number;
  random?: () => number;
  onWarn?: (msg: string, err?: unknown) => void;
}

export class DiscoveryService {
  private readonly source: FactSource | null;
  private readonly matcher: ImageMatcher;
  private readonly mediaStore: MediaStore;
  private readonly publicOrigin: string;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly warn: (msg: string, err?: unknown) => void;
  private readonly cache = new Map<string, { value: HistoricalDiscovery; expiresAt: number }>();
  private readonly fallbacks = new Map<string, HistoricalDiscovery>();

  constructor(opts: DiscoveryServiceOptions) {
    this.source = opts.source;
    this.matcher = opts.matcher;
    this.mediaStore = opts.mediaStore;
    this.publicOrigin = opts.publicOrigin.replace(/\/+$/, '');
    this.ttlMs = opts.cacheTtlSeconds * 1000;
    this.now = opts.now ?? Date.now;
    this.random = opts.random ?? Math.random;
    this.warn = opts.onWarn ?? (() => undefined);
    for (const raw of [...(opts.fallbacks ?? []), ...INLINE_FALLBACKS]) {
      if (this.fallbacks.has(raw.id)) continue;
      const hydrated = this.hydrateFallback(raw);
      if (hydrated) this.fallbacks.set(hydrated.id, hydrated);
    }
  }

  /** Number of servable reviewed fallbacks (file + inline). */
  get fallbackCount(): number {
    return this.fallbacks.size;
  }

  publicMediaUrl(assetId: string): string {
    return `${this.publicOrigin}/v1/media/${assetId}`;
  }

  /** Registers the approved image with the MediaStore and rewrites imageUrl to our own media route. */
  private hydrateFallback(raw: HistoricalDiscovery): HistoricalDiscovery | null {
    try {
      const assetId = this.mediaStore.register(raw.visual.imageUrl, raw.visual.assetId);
      return { ...raw, visual: { ...raw.visual, assetId, imageUrl: this.publicMediaUrl(assetId) } };
    } catch {
      this.warn(`reviewed fallback ${raw.id} skipped: image source not allowlisted or asset id conflict`);
      return null;
    }
  }

  /** Cached discovery (live or reviewed fallback) or null. Expired entries are evicted. */
  get(id: string): HistoricalDiscovery | null {
    const hit = this.cache.get(id);
    if (hit) {
      if (hit.expiresAt > this.now()) return hit.value;
      this.cache.delete(id);
    }
    return this.fallbacks.get(id) ?? null;
  }

  async next(exclude: string[] = []): Promise<HistoricalDiscovery> {
    const excluded = new Set(exclude);
    let upstreamFailed = false;

    if (this.source) {
      try {
        const live = await this.nextFromUpstream(excluded);
        if (live) return live;
      } catch (err) {
        upstreamFailed = true;
        this.warn('Black History API unavailable; using reviewed fallbacks', err);
      }
    }

    const pool = [...this.fallbacks.values()].filter((d) => !excluded.has(d.id));
    if (pool.length > 0) {
      const pick = pool[Math.min(pool.length - 1, Math.floor(this.random() * pool.length))]!;
      return { ...pick, generatedAt: new Date(this.now()).toISOString() };
    }
    if (upstreamFailed) {
      throw new ApiError('UPSTREAM_UNAVAILABLE', 'Discovery provider is unavailable and no fallback is eligible.');
    }
    throw new ApiError('NO_ELIGIBLE_DISCOVERY', 'No eligible discovery is available.');
  }

  private async nextFromUpstream(excluded: Set<string>): Promise<HistoricalDiscovery | null> {
    const source = this.source!;
    let anyValid = false;
    let lastError: unknown;
    for (let i = 0; i < UPSTREAM_FETCHES_PER_REQUEST; i++) {
      let facts: NormalizedFact[];
      try {
        facts = extractFactCandidates(await source.fetchRandomFact());
      } catch (err) {
        lastError = err;
        continue;
      }
      if (facts.length > 0) anyValid = true;
      for (const fact of facts) {
        if (excluded.has(`${UPSTREAM_ID_PREFIX}${fact.providerFactId}`)) continue;
        const discovery = await this.buildDiscovery(fact);
        if (!discovery) continue;
        this.cache.set(discovery.id, { value: discovery, expiresAt: this.now() + this.ttlMs });
        return discovery;
      }
      // Repeats of excluded ids are expected occasionally with a random endpoint; try again.
    }
    if (!anyValid) {
      throw lastError instanceof Error ? lastError : new UpstreamError('Upstream returned no usable facts');
    }
    return null;
  }

  private async buildDiscovery(fact: NormalizedFact): Promise<HistoricalDiscovery | null> {
    try {
      const match = await this.matcher.match({ text: fact.factText, people: fact.people });
      const assetId = this.mediaStore.register(match.sourceUrl);
      const candidate: HistoricalDiscovery = {
        id: `${UPSTREAM_ID_PREFIX}${fact.providerFactId}`,
        provider: 'blackhistoryapi',
        providerFactId: fact.providerFactId,
        factText: fact.factText,
        people: fact.people,
        tags: fact.tags,
        eventDate: fact.eventDate,
        source: fact.source,
        visual: { ...match.visual, assetId, imageUrl: this.publicMediaUrl(assetId) },
        generatedAt: new Date(this.now()).toISOString(),
        schemaVersion: 1,
      };
      return HistoricalDiscoverySchema.parse(candidate);
    } catch (err) {
      this.warn(`discovery ${fact.providerFactId} rejected`, err);
      return null;
    }
  }
}
