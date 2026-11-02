import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ApiError } from '../schemas/discovery.js';

const ALLOWED_HOSTS = new Set(['upload.wikimedia.org', 'commons.wikimedia.org']);

export type StoredMedia = {
  assetId: string;
  filePath: string;
  contentType: string;
  sourceUrl: string;
};

function assertAllowlistedUrl(urlString: string): URL {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new ApiError('VALIDATION_FAILURE', 'Invalid media URL', 502);
  }
  if (url.protocol !== 'https:') {
    throw new ApiError('VALIDATION_FAILURE', 'Media URL must be HTTPS', 502);
  }
  if (!ALLOWED_HOSTS.has(url.hostname)) {
    throw new ApiError('VALIDATION_FAILURE', 'Media host not allowlisted', 502);
  }
  return url;
}

function guessExt(url: string): string {
  const lower = url.toLowerCase();
  if (lower.includes('.png')) return '.png';
  if (lower.includes('.webp')) return '.webp';
  if (lower.includes('.gif')) return '.gif';
  return '.jpg';
}

function contentTypeForExt(ext: string): string {
  switch (ext) {
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    default:
      return 'image/jpeg';
  }
}

export function assetIdFromSource(sourceUrl: string): string {
  return `asset-${createHash('sha256').update(sourceUrl).digest('hex').slice(0, 16)}`;
}

export class MediaStore {
  private readonly cacheDir: string;
  private readonly index = new Map<string, StoredMedia>();

  constructor(cacheDir: string) {
    this.cacheDir = cacheDir;
  }

  async init(): Promise<void> {
    await mkdir(this.cacheDir, { recursive: true });
  }

  registerCatalogAsset(assetId: string, sourceUrl: string): void {
    assertAllowlistedUrl(sourceUrl);
    const ext = guessExt(sourceUrl);
    this.index.set(assetId, {
      assetId,
      sourceUrl,
      contentType: contentTypeForExt(ext),
      filePath: path.join(this.cacheDir, `${assetId}${ext}`),
    });
  }

  async ensureCached(assetId: string, sourceUrl: string): Promise<StoredMedia> {
    assertAllowlistedUrl(sourceUrl);
    const existing = this.index.get(assetId);
    if (existing) {
      try {
        await access(existing.filePath);
        return existing;
      } catch {
        // refetch
      }
    }

    const ext = guessExt(sourceUrl);
    const filePath = path.join(this.cacheDir, `${assetId}${ext}`);
    const response = await fetch(sourceUrl, {
      headers: { 'User-Agent': 'BlackHistoryPomodoro/1.0 (https://blackhistory.360web.cloud)' },
    });
    if (!response.ok) {
      throw new ApiError('UPSTREAM_UNAVAILABLE', 'Failed to fetch media', 503);
    }
    const contentType = response.headers.get('content-type') ?? contentTypeForExt(ext);
    if (!contentType.startsWith('image/')) {
      throw new ApiError('VALIDATION_FAILURE', 'Upstream media is not an image', 502);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength < 1024 || bytes.byteLength > 8_000_000) {
      throw new ApiError('VALIDATION_FAILURE', 'Image size out of bounds', 502);
    }
    await writeFile(filePath, bytes);
    const stored: StoredMedia = { assetId, filePath, contentType, sourceUrl };
    this.index.set(assetId, stored);
    return stored;
  }

  async read(assetId: string): Promise<{ bytes: Buffer; contentType: string }> {
    const meta = this.index.get(assetId);
    if (!meta) throw new ApiError('NOT_FOUND', 'Media not found', 404);
    try {
      await access(meta.filePath);
    } catch {
      await this.ensureCached(assetId, meta.sourceUrl);
    }
    return { bytes: await readFile(meta.filePath), contentType: meta.contentType };
  }
}
