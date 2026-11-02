import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { CommonsImage, CommonsSearcher } from '../src/providers/commonsClient.js';
import type { FactSource } from '../src/providers/blackHistoryClient.js';
import { DiscoveryService, type DiscoveryServiceOptions } from '../src/services/discoveryService.js';
import { ImageMatcher } from '../src/services/imageMatcher.js';
import { MediaStore } from '../src/services/mediaStore.js';

export const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);

export async function tmpDir(prefix = 'bhp-'): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

export function fakeFetch(
  handler: (url: string) => Response | Promise<Response>,
): typeof fetch & { calls: string[] } {
  const calls: string[] = [];
  const fn = (async (input: unknown) => {
    const url = String(input);
    calls.push(url);
    return handler(url);
  }) as typeof fetch & { calls: string[] };
  fn.calls = calls;
  return fn;
}

export function commonsImage(overrides: Partial<CommonsImage> = {}): CommonsImage {
  return {
    title: 'File:Test Person portrait.jpg',
    pageUrl: 'https://commons.wikimedia.org/wiki/File:Test_Person_portrait.jpg',
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/aa/Test_Person_portrait.jpg/960px-Test_Person_portrait.jpg',
    mime: 'image/jpeg',
    width: 960,
    height: 1200,
    license: { kind: 'public-domain', rank: 0, label: 'Public domain' },
    licenseShortName: 'Public domain',
    licenseUrl: null,
    creator: 'Unknown',
    credit: null,
    description: 'Portrait of Test Person',
    categories: [],
    ...overrides,
  };
}

export class StubCommons implements CommonsSearcher {
  queries: string[] = [];
  constructor(private readonly results: CommonsImage[] | (() => never)) {}
  async search(query: string): Promise<CommonsImage[]> {
    this.queries.push(query);
    if (typeof this.results === 'function') this.results();
    return this.results as CommonsImage[];
  }
}

export class StubSource implements FactSource {
  calls = 0;
  constructor(private readonly responder: (n: number) => unknown) {}
  async fetchRandomFact(): Promise<unknown> {
    return this.responder(this.calls++);
  }
}

export async function makeService(
  overrides: Partial<DiscoveryServiceOptions> & { commons?: CommonsSearcher; attempts?: number } = {},
) {
  const dir = await tmpDir();
  const mediaStore = new MediaStore({ cacheDir: path.join(dir, 'media') });
  const commons = overrides.commons ?? new StubCommons([]);
  const matcher = overrides.matcher ?? new ImageMatcher(commons, overrides.attempts ?? 8);
  const service = new DiscoveryService({
    source: null,
    matcher,
    mediaStore,
    publicOrigin: 'https://api.example.test',
    cacheTtlSeconds: 604800,
    ...overrides,
  });
  return { service, mediaStore, dir };
}
