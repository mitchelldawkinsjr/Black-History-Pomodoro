import type { LicenseKind } from '../schemas/discovery.js';

export const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (compatible; BlackHistoryPomodoroAPI/1.0; +https://github.com/black-history-pomodoro)';

export interface LicenseInfo {
  kind: Exclude<LicenseKind, 'project-asset'>;
  /** Lower is better: PD/CC0 (0) < CC BY (1) < CC BY-SA (2). */
  rank: number;
  label: string;
}

/**
 * Classifies a Commons license string. Only Public Domain, CC0, CC BY and CC BY-SA are accepted;
 * NonCommercial / NoDerivatives / fair-use / unknown licenses return null.
 */
export function classifyLicense(...texts: Array<string | null | undefined>): LicenseInfo | null {
  const raw = texts.filter((t): t is string => !!t && t.trim().length > 0).join(' | ');
  if (!raw) return null;
  const s = raw.toLowerCase();
  if (/(by[- ]nc|[- ]nc[- ]|non-?commercial|by[- ]nd|[- ]nd[- ]|no[- ]?derivs?|fair use|all rights reserved|copyrighted)/.test(s)) {
    return null;
  }
  if (/\bcc0\b|cc[- ]zero|cc-0/.test(s)) return { kind: 'cc0', rank: 0, label: 'CC0' };
  if (/public domain|\bpd\b|\bpd-|pdm|no known copyright/.test(s)) {
    return { kind: 'public-domain', rank: 0, label: 'Public domain' };
  }
  if (/cc[- ]by[- ]sa/.test(s)) return { kind: 'cc-by-sa', rank: 2, label: 'CC BY-SA' };
  if (/cc[- ]by\b/.test(s)) return { kind: 'cc-by', rank: 1, label: 'CC BY' };
  return null;
}

export interface CommonsImage {
  title: string; // e.g. "File:Frederick Douglass (circa 1879).jpg"
  pageUrl: string;
  /** Download URL on upload.wikimedia.org (a ~960px rendition when available). */
  imageUrl: string;
  mime: string;
  width: number | null;
  height: number | null;
  license: LicenseInfo;
  licenseShortName: string;
  licenseUrl: string | null;
  creator: string | null;
  credit: string | null;
  description: string | null;
  categories: string[];
}

export interface CommonsSearcher {
  search(query: string, limit?: number): Promise<CommonsImage[]>;
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function meta(ext: Rec, key: string): string | null {
  const entry = ext[key];
  if (!isRec(entry) || typeof entry.value !== 'string') return null;
  const v = stripHtml(entry.value);
  return v.length ? v : null;
}

/** Commons thumbnails are returned from thumb.wikimedia.org; the same path is served by upload.wikimedia.org. */
export function normalizeCommonsUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.hostname === 'thumb.wikimedia.org') u.hostname = 'upload.wikimedia.org';
    u.search = '';
    u.hash = '';
    return u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

export function parseCommonsResponse(json: unknown): CommonsImage[] {
  if (!isRec(json) || !isRec(json.query) || !Array.isArray(json.query.pages)) return [];
  const pages = (json.query.pages as unknown[]).filter(isRec);
  pages.sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0));
  const out: CommonsImage[] = [];
  for (const page of pages) {
    const info = Array.isArray(page.imageinfo) ? page.imageinfo[0] : undefined;
    if (!isRec(info) || typeof page.title !== 'string') continue;
    const ext = isRec(info.extmetadata) ? info.extmetadata : {};
    const licenseShortName = meta(ext, 'LicenseShortName');
    const license = classifyLicense(licenseShortName, meta(ext, 'UsageTerms'), meta(ext, 'License'));
    if (!license) continue;
    const imageUrl = normalizeCommonsUrl(
      typeof info.thumburl === 'string' ? info.thumburl : typeof info.url === 'string' ? info.url : '',
    );
    if (!imageUrl || typeof info.mime !== 'string') continue;
    const categories = (meta(ext, 'Categories') ?? '')
      .split('|')
      .map((c) => c.trim())
      .filter(Boolean);
    out.push({
      title: page.title,
      pageUrl:
        typeof info.descriptionurl === 'string'
          ? info.descriptionurl
          : `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`,
      imageUrl,
      mime: info.mime,
      width: typeof info.thumbwidth === 'number' ? info.thumbwidth : typeof info.width === 'number' ? info.width : null,
      height: typeof info.thumbheight === 'number' ? info.thumbheight : typeof info.height === 'number' ? info.height : null,
      license,
      licenseShortName: licenseShortName ?? license.label,
      licenseUrl: meta(ext, 'LicenseUrl'),
      creator: meta(ext, 'Artist'),
      credit: meta(ext, 'Credit'),
      description: meta(ext, 'ImageDescription'),
      categories,
    });
  }
  return out;
}

/** Orders candidates by license preference (PD/CC0, then CC BY, then CC BY-SA), keeping search order within a tier. */
export function preferLicenses(images: CommonsImage[]): CommonsImage[] {
  return images
    .map((img, i) => ({ img, i }))
    .sort((a, b) => a.img.license.rank - b.img.license.rank || a.i - b.i)
    .map((x) => x.img);
}

export class CommonsClient implements CommonsSearcher {
  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly userAgent: string = DEFAULT_USER_AGENT,
    private readonly timeoutMs: number = 8000,
  ) {}

  async search(query: string, limit = 10): Promise<CommonsImage[]> {
    const params = new URLSearchParams({
      action: 'query',
      generator: 'search',
      gsrsearch: `${query} filetype:bitmap`,
      gsrnamespace: '6',
      gsrlimit: String(Math.min(Math.max(limit, 1), 20)),
      prop: 'imageinfo',
      iiprop: 'url|mime|size|extmetadata',
      iiurlwidth: '960',
      iiextmetadatafilter: 'LicenseShortName|UsageTerms|License|LicenseUrl|Artist|Credit|ImageDescription|Categories',
      format: 'json',
      formatversion: '2',
    });
    const res = await this.fetchImpl(`${COMMONS_API}?${params}`, {
      headers: { 'user-agent': this.userAgent, accept: 'application/json' },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`Wikimedia Commons responded with HTTP ${res.status}`);
    return parseCommonsResponse(await res.json());
  }
}
