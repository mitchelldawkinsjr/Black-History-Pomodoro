import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { BlackHistoryClient } from '../src/providers/blackHistoryClient.js';
import { CommonsClient } from '../src/providers/commonsClient.js';
import { DiscoveryService } from '../src/services/discoveryService.js';
import { ImageMatcher } from '../src/services/imageMatcher.js';
import { MediaStore } from '../src/services/mediaStore.js';

test('serves curated fallback when API key is absent', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'bhp-'));
  const fallbacksPath = path.join(tmp, 'fallbacks.json');
  const cacheDir = path.join(tmp, 'cache');

  await writeFile(
    fallbacksPath,
    JSON.stringify([
      {
        id: 'bhf-fallback-test-001',
        provider: 'curated',
        providerFactId: 'curated-test-001',
        factText: 'Test fact for unit coverage.',
        people: ['Test Person'],
        tags: ['Test'],
        eventDate: null,
        source: { label: 'Test Source', url: null, providerUrl: null },
        visual: {
          assetId: 'asset-test-001',
          imageUrl:
            'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/Frederick_Douglass_%28c1879%29.jpg/800px-Frederick_Douglass_%28c1879%29.jpg',
          title: 'Test image',
          alt: 'Test alt',
          creator: null,
          sourceUrl: 'https://commons.wikimedia.org/wiki/File:Frederick_Douglass_(c1879).jpg',
          license: 'Public Domain',
          licenseUrl: null,
          credit: 'Test credit',
          depictionType: 'photo',
          depictsSubject: true,
          width: 800,
          height: 1000,
          reviewedAt: '2026-11-02T00:00:00Z',
        },
        generatedAt: '2026-11-02T00:00:00Z',
        schemaVersion: 1,
      },
    ]),
  );

  const mediaStore = new MediaStore(cacheDir);
  await mediaStore.init();
  const service = new DiscoveryService(
    new BlackHistoryClient({ apiKey: undefined, baseUrl: 'https://example.invalid/v2' }),
    new ImageMatcher(new CommonsClient(), mediaStore, 'https://blackhistory.360web.cloud', 2),
    mediaStore,
    'https://blackhistory.360web.cloud',
    fallbacksPath,
  );
  await service.init();

  const discovery = await service.next([]);
  assert.equal(discovery.id, 'bhf-fallback-test-001');
  assert.match(discovery.visual.imageUrl, /\/v1\/media\/asset-test-001$/);
  assert.equal((await service.getById('bhf-fallback-test-001')).factText, 'Test fact for unit coverage.');
});
