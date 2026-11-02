export type CommonsImageCandidate = {
  title: string;
  pageUrl: string;
  thumbUrl: string;
  fullUrl: string;
  width: number;
  height: number;
  creator: string | null;
  license: string;
  licenseUrl: string | null;
  mime: string;
};

const ALLOWED = ['public domain', 'pd', 'cc0', 'cc-zero', 'cc by', 'cc-by', 'cc by-sa', 'cc-by-sa'];

function licenseAllowed(license: string | null | undefined): boolean {
  if (!license) return false;
  const normalized = license.toLowerCase().replace(/[_]/g, ' ').trim();
  return ALLOWED.some((allowed) => normalized.includes(allowed));
}

export class CommonsClient {
  private readonly endpoint = 'https://commons.wikimedia.org/w/api.php';

  async searchExactSubject(subject: string, limit = 5): Promise<CommonsImageCandidate[]> {
    const query = subject.trim();
    if (!query) return [];

    const searchParams = new URLSearchParams({
      action: 'query',
      format: 'json',
      generator: 'search',
      gsrsearch: `File:${query}`,
      gsrnamespace: '6',
      gsrlimit: String(limit),
      prop: 'imageinfo',
      iiprop: 'url|size|mime|extmetadata',
      iiurlwidth: '1200',
      origin: '*',
    });

    const response = await fetch(`${this.endpoint}?${searchParams}`, {
      headers: { 'User-Agent': 'BlackHistoryPomodoro/1.0 (https://blackhistory.360web.cloud)' },
    });
    if (!response.ok) return [];

    const payload = (await response.json()) as {
      query?: {
        pages?: Record<
          string,
          {
            title?: string;
            imageinfo?: Array<{
              url?: string;
              thumburl?: string;
              width?: number;
              height?: number;
              mime?: string;
              descriptionurl?: string;
              extmetadata?: Record<string, { value?: string }>;
            }>;
          }
        >;
      };
    };

    const results: CommonsImageCandidate[] = [];
    for (const page of Object.values(payload.query?.pages ?? {})) {
      const info = page.imageinfo?.[0];
      if (!info?.url || !info.mime?.startsWith('image/')) continue;
      const licenseRaw =
        info.extmetadata?.LicenseShortName?.value ?? info.extmetadata?.License?.value ?? '';
      if (!licenseAllowed(licenseRaw)) continue;
      const width = info.width ?? 0;
      const height = info.height ?? 0;
      if (Math.min(width, height) < 800) continue;
      const artistHtml = info.extmetadata?.Artist?.value ?? '';
      results.push({
        title: page.title?.replace(/^File:/, '') ?? query,
        pageUrl:
          info.descriptionurl ??
          `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title ?? '')}`,
        thumbUrl: info.thumburl ?? info.url,
        fullUrl: info.url,
        width,
        height,
        creator: artistHtml.replace(/<[^>]+>/g, '').trim() || null,
        license: licenseRaw || 'Unknown',
        licenseUrl: info.extmetadata?.LicenseUrl?.value ?? null,
        mime: info.mime,
      });
    }
    return results;
  }
}
