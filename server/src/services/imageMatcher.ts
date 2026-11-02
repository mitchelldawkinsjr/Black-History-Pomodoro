import { preferLicenses, type CommonsImage, type CommonsSearcher } from '../providers/commonsClient.js';
import type { DiscoveryVisual } from '../schemas/discovery.js';
import { LOCAL_PREFIX } from './mediaStore.js';

export const GENERIC_ASSET = `${LOCAL_PREFIX}generic-history.png`;

/** Visual metadata minus the fields assigned when the image is registered with the MediaStore. */
export type MatchedVisual = Omit<DiscoveryVisual, 'assetId' | 'imageUrl'>;

export interface MatchedImage {
  /** Server-approved source (allowlisted URL or `local:` asset) to register with the MediaStore. */
  sourceUrl: string;
  visual: MatchedVisual;
  subject: string | null;
  attemptsUsed: number;
}

export interface MatchInput {
  text: string;
  people: string[];
}

const ACCEPTED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
/** Titles with these words usually show more than one person, or no person at all. */
const AMBIGUOUS_TITLE =
  /\b(and|with|group|family|meeting|delegation|convention|statue|monument|memorial|grave|stamp|house|school|bridge|street|cover|signature|autograph)\b|&/i;
/** Filenames that are almost never a portrait of the named person. */
const NON_PERSON_TITLE =
  /\b(route|map|diagram|chart|graph|logo|flag|medal|coin|plaque|poster|flyer|ticket|concert|festival|performed|performance|homecoming|tour|editathon|wikipedia|mars|perseverance|ingenuity|rover|satellite|telescope)\b/i;
/** Noise stripped before testing whether the subject leads the filename. */
const TITLE_PREFIX_NOISE =
  /\b(circa|c|portrait|photo|photograph|bust|painting|of|by|cropped|restored|restoration|unknown|photographer|the)\b/gi;
const MIN_WIDTH = 200;

export function normalizeName(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function containsPhrase(haystack: string, phrase: string): boolean {
  return ` ${normalizeName(haystack)} `.includes(` ${phrase} `);
}

/**
 * Name forms to try when matching Commons titles/descriptions.
 * "Octavia E. Butler" → also "octavia butler" (drop single-letter initials).
 */
export function subjectNameVariants(subject: string): string[] {
  const full = normalizeName(subject);
  if (!full) return [];
  const out = [full];
  const withoutInitials = full
    .split(' ')
    .filter((token) => token.length > 1)
    .join(' ')
    .trim();
  if (withoutInitials && withoutInitials !== full && withoutInitials.includes(' ')) {
    out.push(withoutInitials);
  }
  return out;
}

function anyVariantIn(haystack: string, variants: string[]): boolean {
  return variants.some((variant) => containsPhrase(haystack, variant));
}

/** True when a subject variant is the leading name in the filename (not buried mid-phrase). */
export function subjectLeadsTitle(fileName: string, subject: string): boolean {
  const variants = subjectNameVariants(subject);
  if (!variants.length) return false;
  let norm = normalizeName(fileName);
  if (!norm) return false;
  // Drop trailing camera/id noise like "5817516530" while keeping years near the name.
  norm = norm.replace(TITLE_PREFIX_NOISE, ' ').replace(/\s+/g, ' ').trim();
  for (const variant of variants) {
    if (norm === variant) return true;
    if (norm.startsWith(`${variant} `)) return true;
  }
  return false;
}

export function visualFromCommons(img: CommonsImage, subject: string, now: string): MatchedVisual {
  const title = img.title.replace(/^File:/i, '');
  return {
    title,
    alt: `Photograph or portrait of ${subject} (${title})`,
    creator: img.creator,
    sourceUrl: img.pageUrl,
    license: img.licenseShortName,
    licenseUrl: img.licenseUrl && /^https?:\/\//.test(img.licenseUrl) ? img.licenseUrl : null,
    licenseKind: img.license.kind,
    credit: `Wikimedia Commons${img.creator ? ` / ${img.creator}` : ''} — ${img.licenseShortName}`,
    depictionType: 'photo',
    depictsSubject: true,
    width: img.width ?? 960,
    height: img.height ?? 960,
    reviewedAt: now,
  };
}

/**
 * Picks the single person the fact is about, or null when that is ambiguous.
 * - no people → null
 * - one person → that person
 * - several → only if exactly one of them is named in the fact text
 */
export function pickSubject({ text, people }: MatchInput): string | null {
  const names = people.map((p) => p.trim()).filter(Boolean);
  if (names.length === 0) return null;
  if (names.length === 1) return names[0] ?? null;
  const mentioned = names.filter((n) => anyVariantIn(text, subjectNameVariants(n)));
  return mentioned.length === 1 ? (mentioned[0] ?? null) : null;
}

export function evaluateCandidate(img: CommonsImage, subject: string): { ok: boolean; reason?: string } {
  const variants = subjectNameVariants(subject);
  if (!variants.length) return { ok: false, reason: 'empty-subject' };
  if (!ACCEPTED_MIME.has(img.mime)) return { ok: false, reason: 'mime' };
  if (img.width !== null && img.width < MIN_WIDTH) return { ok: false, reason: 'too-small' };
  const fileName = img.title.replace(/^File:/i, '').replace(/\.[A-Za-z0-9]+$/, '');
  if (AMBIGUOUS_TITLE.test(fileName) || NON_PERSON_TITLE.test(fileName)) {
    return { ok: false, reason: 'ambiguous-title' };
  }

  // Strong path: subject is the leading name in the filename.
  if (subjectLeadsTitle(fileName, subject)) {
    return { ok: true };
  }

  const core = variants[variants.length - 1]!;
  const coreTokens = core.split(' ').filter(Boolean);
  const descriptionHit = !!img.description && anyVariantIn(img.description, variants);
  const lastName = coreTokens[coreTokens.length - 1] ?? '';

  // Medium path: filename led by the surname + description confirms the full subject
  // (e.g. "Butler signing.jpg" with "Octavia Butler" in the caption).
  if (descriptionHit && lastName.length >= 4 && subjectLeadsTitle(fileName, lastName)) {
    return { ok: true };
  }

  return { ok: false, reason: 'name-mismatch' };
}

/** "Octavia E. Butler" → "Octavia Butler" for Commons search. */
export function subjectWithoutMiddleInitials(subject: string): string | null {
  const parts = subject.trim().split(/\s+/).filter(Boolean);
  const kept = parts.filter((part) => !/^[A-Za-z]\.?$/.test(part));
  if (kept.length < 2 || kept.length === parts.length) return null;
  return kept.join(' ');
}

export class ImageMatcher {
  constructor(
    private readonly commons: CommonsSearcher,
    private readonly maxAttempts: number,
  ) {}

  genericFallback(attemptsUsed = 0): MatchedImage {
    return {
      sourceUrl: GENERIC_ASSET,
      subject: null,
      attemptsUsed,
      visual: {
        title: 'Generic historical visual',
        alt: 'Abstract background used when no verified image of the subject is available',
        creator: null,
        sourceUrl: GENERIC_ASSET,
        license: 'Project asset',
        licenseUrl: null,
        licenseKind: 'project-asset',
        credit: 'The Black History API',
        depictionType: 'generic',
        depictsSubject: false,
        width: 640,
        height: 360,
        reviewedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Finds an image that verifiably depicts the fact's subject. Each Commons search and each candidate
   * inspected counts as one attempt; after `maxAttempts` (or on any ambiguity/failure) a generic visual
   * with depictsSubject:false is returned. It never throws.
   */
  async match(input: MatchInput): Promise<MatchedImage> {
    const subject = pickSubject(input);
    if (!subject) return this.genericFallback();

    let attempts = 0;
    const queryNames = [subject];
    const withoutInitials = subjectWithoutMiddleInitials(subject);
    if (withoutInitials) queryNames.push(withoutInitials);
    // Exact subject, then without middle initials; each with a portrait pass.
    const queries: string[] = [];
    for (const name of queryNames) {
      for (const q of [`"${name}"`, `"${name}" portrait`]) {
        if (!queries.includes(q)) queries.push(q);
      }
    }
    const seen = new Set<string>();

    for (const query of queries) {
      if (attempts >= this.maxAttempts) break;
      attempts++;
      let results: CommonsImage[];
      try {
        results = await this.commons.search(query);
      } catch {
        continue;
      }
      for (const candidate of preferLicenses(results)) {
        if (attempts >= this.maxAttempts) break;
        if (seen.has(candidate.title)) continue;
        seen.add(candidate.title);
        attempts++;
        if (!evaluateCandidate(candidate, subject).ok) continue;
        return {
          sourceUrl: candidate.imageUrl,
          subject,
          attemptsUsed: attempts,
          visual: visualFromCommons(candidate, subject, new Date().toISOString()),
        };
      }
    }
    return this.genericFallback(attempts);
  }
}
