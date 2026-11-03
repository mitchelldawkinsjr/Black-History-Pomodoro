import { extractFactCandidates, type NormalizedFact } from '../providers/blackHistoryAdapter.js';
import type { ImageMatcher, MatchedImage } from './imageMatcher.js';

export interface IllustratedFact {
  fact: NormalizedFact;
  image: MatchedImage;
}

export interface PipelineResult {
  /** True when the payload had at least one usable fact, including ones later skipped. */
  hadFacts: boolean;
  illustrated: IllustratedFact | null;
}

/**
 * Filters a Black History API payload, then locates an image for each remaining fact.
 * A verified Commons portrait wins. Otherwise the first fact is returned with the
 * generic project image, so a served fact always has an image.
 */
export async function runFactPipeline(
  payload: unknown,
  matcher: ImageMatcher,
  skip?: (fact: NormalizedFact) => boolean,
): Promise<PipelineResult> {
  const facts = extractFactCandidates(payload);
  let generic: IllustratedFact | null = null;
  for (const fact of facts) {
    if (skip?.(fact)) continue;
    const image = await matcher.match({ text: fact.factText, people: fact.people });
    const illustrated = { fact, image };
    if (image.visual.depictsSubject) return { hadFacts: true, illustrated };
    if (!generic) generic = illustrated;
  }
  return { hadFacts: facts.length > 0, illustrated: generic };
}
