import type { NormalizedFact } from '../providers/blackHistoryAdapter.js';
import type { CommonsClient, CommonsImageCandidate } from '../providers/commonsClient.js';
import { assetIdFromSource, type MediaStore } from './mediaStore.js';

export type MatchedVisual = {
  assetId: string;
  imageUrl: string;
  title: string;
  alt: string;
  creator: string | null;
  sourceUrl: string;
  license: string;
  licenseUrl: string | null;
  credit: string;
  depictionType: 'photo' | 'document' | 'artwork' | 'generic';
  depictsSubject: boolean;
  width: number;
  height: number;
  reviewedAt: string;
  upstreamUrl: string;
};

function titleMatchesSubject(candidateTitle: string, subject: string): boolean {
  const title = candidateTitle.toLowerCase();
  const parts = subject
    .toLowerCase()
    .split(/\s+/)
    .filter((part) => part.length > 2);
  return parts.length > 0 && parts.every((part) => title.includes(part));
}

export class ImageMatcher {
  constructor(
    private readonly commons: CommonsClient,
    private readonly mediaStore: MediaStore,
    private readonly publicOrigin: string,
    private readonly maxAttempts: number,
  ) {}

  async matchForFact(fact: NormalizedFact): Promise<MatchedVisual | null> {
    let attempts = 0;
    for (const subject of fact.people) {
      if (attempts >= this.maxAttempts) break;
      attempts += 1;
      let candidates: CommonsImageCandidate[] = [];
      try {
        candidates = await this.commons.searchExactSubject(subject, 5);
      } catch {
        continue;
      }
      const chosen = candidates.find((c) => titleMatchesSubject(c.title, subject)) ?? null;
      if (!chosen) continue;

      const assetId = assetIdFromSource(chosen.fullUrl);
      await this.mediaStore.ensureCached(assetId, chosen.fullUrl);
      return {
        assetId,
        imageUrl: `${this.publicOrigin}/v1/media/${assetId}`,
        title: chosen.title,
        alt: `Historical image identified as ${subject}: ${chosen.title}`,
        creator: chosen.creator,
        sourceUrl: chosen.pageUrl,
        license: chosen.license,
        licenseUrl: chosen.licenseUrl,
        credit: `${chosen.creator ? `${chosen.creator} — ` : ''}${chosen.license} via Wikimedia Commons`,
        depictionType: 'photo',
        depictsSubject: true,
        width: chosen.width,
        height: chosen.height,
        reviewedAt: new Date().toISOString(),
        upstreamUrl: chosen.fullUrl,
      };
    }
    return null;
  }
}
