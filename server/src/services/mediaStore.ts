import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_USER_AGENT } from '../providers/commonsClient.js';
import { ASSET_ID_PATTERN, ApiError } from '../schemas/discovery.js';
import { GENERIC_HISTORY_PNG } from './genericAsset.js';

export const ALLOWED_IMAGE_HOSTS = ['upload.wikimedia.org', 'commons.wikimedia.org'] as const;
export const LOCAL_PREFIX = 'local:';
const LOCAL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(png|jpe?g|webp)$/i;
const MAX_REDIRECTS = 3;

export type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

export interface StoredMedia {
  data: Buffer;
  contentType: ImageMime;
}

export interface MediaStoreOptions {
  cacheDir: string;
  localAssetsDir?: string;
  fetchImpl?: typeof fetch;
  allowedHosts?: readonly string[];
  maxBytes?: number;
  timeoutMs?: number;
  userAgent?: string;
}

/** Detects JPEG / PNG / WebP from magic bytes. Anything else is rejected. */
export function sniffImage(buf: Buffer): ImageMime | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

/** Deterministic assetId for a source (used for live-matched images). */
export function assetIdFor(source: string): string {
  return `a${createHash('sha256').update(source).digest('hex').slice(0, 31)}`;
}

const BUILTIN_ASSETS: Record<string, Buffer> = { 'generic-history.png': GENERIC_HISTORY_PNG };
const defaultAssetsDir = fileURLToPath(new URL('../../assets', import.meta.url));

/**
 * Downloads approved images once, caches them on disk and serves them by assetId.
 * Clients can never supply a URL: sources are registered server-side and must pass the allowlist.
 */
export class MediaStore {
  private readonly cacheDir: string;
  private readonly localAssetsDir: string;
  private readonly fetchImpl: typeof fetch;
  private readonly allowedHosts: Set<string>;
  private readonly maxBytes: number;
  private readonly timeoutMs: number;
  private readonly userAgent: string;
  private readonly sources = new Map<string, string>();
  private readonly inflight = new Map<string, Promise<StoredMedia>>();

  constructor(opts: MediaStoreOptions) {
    this.cacheDir = opts.cacheDir;
    this.localAssetsDir = opts.localAssetsDir ?? defaultAssetsDir;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.allowedHosts = new Set((opts.allowedHosts ?? ALLOWED_IMAGE_HOSTS).map((h) => h.toLowerCase()));
    this.maxBytes = opts.maxBytes ?? 8 * 1024 * 1024;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;
  }

  /** True for `local:<file>` assets or https URLs on an allowlisted host (no credentials / custom port). */
  isAllowedSource(source: string): boolean {
    if (source.startsWith(LOCAL_PREFIX)) return LOCAL_NAME.test(source.slice(LOCAL_PREFIX.length));
    try {
      const u = new URL(source);
      return (
        u.protocol === 'https:' &&
        !u.username &&
        !u.password &&
        (u.port === '' || u.port === '443') &&
        this.allowedHosts.has(u.hostname.toLowerCase())
      );
    } catch {
      return false;
    }
  }

  /**
   * Registers a server-approved source and returns its assetId (derived from the source unless a
   * reviewed id is supplied). Throws VALIDATION_FAILURE if the source is not allowlisted or the id is taken.
   */
  register(source: string, preferredId?: string): string {
    if (!this.isAllowedSource(source)) {
      throw new ApiError('VALIDATION_FAILURE', 'Image source is not on the approved allowlist.');
    }
    const id = preferredId ?? assetIdFor(source);
    if (!ASSET_ID_PATTERN.test(id)) throw new ApiError('VALIDATION_FAILURE', 'Invalid asset id.');
    const existing = this.sources.get(id);
    if (existing && existing !== source) throw new ApiError('VALIDATION_FAILURE', 'Asset id already in use.');
    if (!existing) {
      this.sources.set(id, source);
      // Persist so assets remain resolvable after a restart. Best effort.
      void this.persistMeta(id, source).catch(() => undefined);
    }
    return id;
  }

  /** Returns image bytes for a known assetId, or null when unknown. Throws UPSTREAM_UNAVAILABLE if download fails. */
  async get(assetId: string): Promise<StoredMedia | null> {
    if (!ASSET_ID_PATTERN.test(assetId)) return null;
    const source = this.sources.get(assetId) ?? (await this.loadMeta(assetId));
    if (!source) return null;
    this.sources.set(assetId, source);

    if (source.startsWith(LOCAL_PREFIX)) return this.readLocal(source.slice(LOCAL_PREFIX.length));

    const cached = await this.readCached(assetId);
    if (cached) return cached;

    let pending = this.inflight.get(assetId);
    if (!pending) {
      pending = this.download(assetId, source).finally(() => this.inflight.delete(assetId));
      this.inflight.set(assetId, pending);
    }
    return pending;
  }

  private binPath(id: string): string {
    return path.join(this.cacheDir, `${id}.bin`);
  }
  private metaPath(id: string): string {
    return path.join(this.cacheDir, `${id}.json`);
  }

  private async persistMeta(id: string, source: string): Promise<void> {
    await fs.mkdir(this.cacheDir, { recursive: true });
    await this.atomicWrite(this.metaPath(id), Buffer.from(JSON.stringify({ source })));
  }

  private async loadMeta(id: string): Promise<string | null> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.metaPath(id), 'utf8')) as { source?: unknown };
      // Re-validate against the allowlist: never trust on-disk data blindly.
      return typeof parsed.source === 'string' && this.isAllowedSource(parsed.source) ? parsed.source : null;
    } catch {
      return null;
    }
  }

  private async atomicWrite(file: string, data: Buffer): Promise<void> {
    const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, file);
  }

  private async readCached(id: string): Promise<StoredMedia | null> {
    try {
      const data = await fs.readFile(this.binPath(id));
      const contentType = sniffImage(data);
      return contentType ? { data, contentType } : null;
    } catch {
      return null;
    }
  }

  private async readLocal(name: string): Promise<StoredMedia | null> {
    if (!LOCAL_NAME.test(name)) return null;
    const builtin = BUILTIN_ASSETS[name];
    if (builtin) return { data: builtin, contentType: 'image/png' };
    try {
      const data = await fs.readFile(path.join(this.localAssetsDir, path.basename(name)));
      const contentType = sniffImage(data);
      return contentType ? { data, contentType } : null;
    } catch {
      return null;
    }
  }

  private async download(id: string, source: string): Promise<StoredMedia> {
    const fail = (msg: string): never => {
      throw new ApiError('UPSTREAM_UNAVAILABLE', msg);
    };
    let url = source;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!this.isAllowedSource(url)) fail('Image redirect target is not on the approved allowlist.');
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          redirect: 'manual',
          headers: { 'user-agent': this.userAgent, accept: 'image/jpeg,image/png,image/webp' },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch {
        return fail('Image could not be downloaded.');
      }
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc) return fail('Image download failed.');
        url = new URL(loc, url).toString();
        continue;
      }
      if (!res.ok) return fail(`Image download failed with HTTP ${res.status}.`);
      const declared = Number(res.headers.get('content-length') ?? 0);
      if (declared > this.maxBytes) return fail('Image is too large.');
      const data = Buffer.from(await res.arrayBuffer());
      if (data.length > this.maxBytes) return fail('Image is too large.');
      const contentType = sniffImage(data);
      if (!contentType) return fail('Upstream asset is not a JPEG, PNG or WebP image.');
      // MVP: stored as-is (no resize); upstream already serves a ~960px rendition.
      await fs.mkdir(this.cacheDir, { recursive: true });
      await this.atomicWrite(this.binPath(id), data);
      return { data, contentType };
    }
    return fail('Too many redirects while downloading image.');
  }
}
