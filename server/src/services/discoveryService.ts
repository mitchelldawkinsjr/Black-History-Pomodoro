import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BlackHistoryClient } from '../providers/blackHistoryClient.js';
import {
  ApiError,
  HistoricalDiscoverySchema,
  type HistoricalDiscovery,
} from '../schemas/discovery.js';
import type { ImageMatcher } from './imageMatcher.js';
import type { MediaStore } from './mediaStore.js';

export class DiscoveryService {
  private readonly cache = new Map<string, HistoricalDiscovery>();
  private curated: HistoricalDiscovery[] = [];

  constructor(
    private readonly blackHistory: BlackHistoryClient,
    private readonly imageMatcher: ImageMatcher,
    private readonly mediaStore: MediaStore,
    private readonly publicOrigin: string,
    private readonly fallbacksPath: string,
  ) {}

  async init(): Promise<void> {
    this.curated = await this.loadFallbacks();
    for (const discovery of this.curated) {
      const published = await this.publishDiscovery(discovery, discovery.visual.imageUrl);
      this.cache.set(published.id, published);
    }
  }

  async getById(id: string): Promise<HistoricalDiscovery> {
    const cached = this.cache.get(id);
    if (!cached) throw new ApiError('NOT_FOUND', 'Discovery not found', 404);
    return cached;
  }

  async next(exclude: string[]): Promise<HistoricalDiscovery> {
    const excludeSet = new Set(exclude);

    if (this.blackHistory.enabled) {
      try {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const facts = await this.blackHistory.fetchRandomFact();
          for (const fact of facts) {
            const id = `bhf-${fact.providerFactId}`;
            if (excludeSet.has(id)) continue;
            const visual = await this.imageMatcher.matchForFact(fact);
            if (!visual) continue;
            const discovery = HistoricalDiscoverySchema.parse({
              id,
              provider: 'blackhistoryapi',
              providerFactId: fact.providerFactId,
              factText: fact.factText,
              people: fact.people,
              tags: fact.tags,
              eventDate: fact.eventDate,
              source: fact.source,
              visual: {
                assetId: visual.assetId,
                imageUrl: visual.imageUrl,
                title: visual.title,
                alt: visual.alt,
                creator: visual.creator,
                sourceUrl: visual.sourceUrl,
                license: visual.license,
                licenseUrl: visual.licenseUrl,
                credit: visual.credit,
                depictionType: visual.depictionType,
                depictsSubject: visual.depictsSubject,
                width: visual.width,
                height: visual.height,
                reviewedAt: visual.reviewedAt,
              },
              generatedAt: new Date().toISOString(),
              schemaVersion: 1,
            });
            this.cache.set(discovery.id, discovery);
            return discovery;
          }
        }
      } catch {
        // fall through to curated
      }
    }

    const curatedPool = [...this.cache.values()].filter((entry) => !excludeSet.has(entry.id));
    if (!curatedPool.length) {
      const any = this.curated[0];
      if (!any) throw new ApiError('NO_ELIGIBLE_DISCOVERY', 'No eligible discovery available', 503);
      return this.cache.get(any.id) ?? (await this.publishDiscovery(any, any.visual.imageUrl));
    }
    return curatedPool[Math.floor(Math.random() * curatedPool.length)]!;
  }

  private async publishDiscovery(
    discovery: HistoricalDiscovery,
    upstreamUrl: string,
  ): Promise<HistoricalDiscovery> {
    this.mediaStore.registerCatalogAsset(discovery.visual.assetId, upstreamUrl);
    try {
      await this.mediaStore.ensureCached(discovery.visual.assetId, upstreamUrl);
    } catch {
      // lazy fetch on media request
    }
    return {
      ...discovery,
      visual: {
        ...discovery.visual,
        imageUrl: `${this.publicOrigin}/v1/media/${discovery.visual.assetId}`,
      },
    };
  }

  private async loadFallbacks(): Promise<HistoricalDiscovery[]> {
    const candidates = [
      this.fallbacksPath,
      path.resolve(process.cwd(), '../data/reviewed-fallbacks.json'),
      path.resolve(process.cwd(), 'data/reviewed-fallbacks.json'),
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '../../../data/reviewed-fallbacks.json',
      ),
    ];

    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(await readFile(candidate, 'utf8')) as unknown;
        if (!Array.isArray(parsed)) continue;
        return parsed
          .map((entry) => HistoricalDiscoverySchema.safeParse(entry))
          .filter((r): r is { success: true; data: HistoricalDiscovery } => r.success)
          .map((r) => r.data);
      } catch {
        // try next
      }
    }
    return [];
  }
}
