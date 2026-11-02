import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ApiError, HistoricalDiscoverySchema } from '../src/schemas/discovery.js';
import {
  INLINE_FALLBACKS,
  loadReviewedFallbacks,
} from '../src/services/discoveryService.js';
import { MediaStore } from '../src/services/mediaStore.js';
import { StubCommons, StubSource, commonsImage, makeService } from './helpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataFile = path.resolve(here, '../../data/reviewed-fallbacks.json');

const upstreamResults = (id: string, extra: Record<string, unknown> = {}) => ({
  Results: [{ _id: id, text: 'Test Person founded a school.', people: ['Test Person'], tags: ['Education'], source: 'Test Archive', ...extra }],
});

test('serves a reviewed fallback when no API key / source is configured', async () => {
  const { service } = await makeService({ random: () => 0 });
  const d = await service.next();
  assert.equal(HistoricalDiscoverySchema.safeParse(d).success, true);
  assert.equal(d.schemaVersion, 1);
  assert.equal(d.provider, 'curated');
  assert.equal(d.visual.depictsSubject, true);
  assert.match(d.visual.imageUrl, new RegExp(`^https://api\\.example\\.test/v1/media/${d.visual.assetId}$`));
  assert.ok(!d.visual.imageUrl.includes('wikimedia'), 'clients only ever see our own media URL');
});

test('inline fallbacks: 3-5 entries, valid, allowlisted Commons images, 960px thumbs', () => {
  assert.ok(INLINE_FALLBACKS.length >= 3 && INLINE_FALLBACKS.length <= 5);
  for (const f of INLINE_FALLBACKS) {
    assert.equal(HistoricalDiscoverySchema.safeParse(f).success, true, f.id);
    assert.match(f.visual.imageUrl, /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/thumb\/.+\/960px-/);
    assert.ok(f.source.url?.startsWith('https://www.nps.gov/'));
  }
});

test('data/reviewed-fallbacks.json is valid and servable', async () => {
  const skipped: string[] = [];
  const entries = await loadReviewedFallbacks(dataFile, (m) => skipped.push(m));
  assert.deepEqual(skipped, []);
  assert.equal(entries.length, 4);
  const { service } = await makeService({ fallbacks: entries });
  assert.equal(service.fallbackCount, 4);
  for (const e of entries) {
    const served = service.get(e.id);
    assert.ok(served, e.id);
    assert.equal(served.visual.depictsSubject, true);
    assert.ok(e.visual.imageUrl.startsWith('https://upload.wikimedia.org/'));
  }
});

test('loadReviewedFallbacks skips invalid entries and tolerates a missing file', async () => {
  const { dir } = await makeService();
  const file = path.join(dir, 'f.json');
  await writeFile(file, JSON.stringify([INLINE_FALLBACKS[0], { id: 'bad' }]));
  const skipped: string[] = [];
  const entries = await loadReviewedFallbacks(file, (m) => skipped.push(m));
  assert.equal(entries.length, 1);
  assert.equal(skipped.length, 1);
  assert.deepEqual(await loadReviewedFallbacks(path.join(dir, 'missing.json')), []);
});

test('file fallbacks with non-allowlisted image hosts are skipped (never fetched)', async () => {
  const evil = { ...INLINE_FALLBACKS[0]!, id: 'evil-1', visual: { ...INLINE_FALLBACKS[0]!.visual, assetId: 'evil-asset', imageUrl: 'https://evil.example.com/x.jpg' } };
  const { service } = await makeService({ fallbacks: [evil] });
  assert.equal(service.get('evil-1'), null);
});

test('exclude removes ids; excluding everything yields NO_ELIGIBLE_DISCOVERY', async () => {
  const { service } = await makeService({ random: () => 0 });
  const ids = INLINE_FALLBACKS.map((f) => f.id);
  const d = await service.next(ids.slice(0, 3));
  assert.equal(d.id, ids[3]);
  await assert.rejects(
    service.next(ids),
    (err: unknown) => err instanceof ApiError && err.code === 'NO_ELIGIBLE_DISCOVERY' && err.statusCode === 404,
  );
});

test('upstream failure falls back to reviewed entries; UPSTREAM_UNAVAILABLE when none are eligible', async () => {
  const source = new StubSource(() => {
    throw new Error('boom');
  });
  const { service } = await makeService({ source, random: () => 0 });
  const d = await service.next();
  assert.equal(d.provider, 'curated');
  await assert.rejects(
    service.next(INLINE_FALLBACKS.map((f) => f.id)),
    (err: unknown) => err instanceof ApiError && err.code === 'UPSTREAM_UNAVAILABLE',
  );
});

test('upstream returning only invalid facts is treated as unavailable (fallback served)', async () => {
  const source = new StubSource(() => ({ Results: [{ text: '' }] }));
  const { service } = await makeService({ source });
  const d = await service.next();
  assert.equal(d.provider, 'curated');
  assert.equal(source.calls, 3);
});

test('live discovery: matched image, cached by id, expires after TTL', async () => {
  let now = 1_000_000;
  const commons = new StubCommons([commonsImage()]);
  const source = new StubSource(() => upstreamResults('f1'));
  const { service } = await makeService({ source, commons, now: () => now, cacheTtlSeconds: 60 });
  const d = await service.next();
  assert.equal(d.id, 'bha-f1');
  assert.equal(d.provider, 'blackhistoryapi');
  assert.equal(d.factText, 'Test Person founded a school.');
  assert.deepEqual(d.people, ['Test Person']);
  assert.equal(d.source.label, 'Test Archive');
  assert.equal(d.visual.depictsSubject, true);
  assert.equal(d.visual.license, 'Public domain');
  assert.equal(service.get('bha-f1')?.id, 'bha-f1');
  now += 61_000;
  assert.equal(service.get('bha-f1'), null);
});

test('live discovery without a known subject skips generic and uses a reviewed fallback image', async () => {
  const source = new StubSource(() => ({
    Results: [
      {
        _id: 'f2',
        text: 'In 1961 a new institute for the arts was founded.',
        people: undefined,
        tags: ['Arts'],
        source: 'Test Archive',
      },
    ],
  }));
  const commons = new StubCommons([commonsImage()]);
  const { service } = await makeService({ source, commons });
  const d = await service.next();
  assert.equal(d.provider, 'curated');
  assert.equal(d.visual.depictsSubject, true);
  assert.equal(commons.queries.length, 0, 'no Commons search when subject is unknown');
});

test('live discovery honors exclude and moves on to a different fact', async () => {
  const source = new StubSource((n) => upstreamResults(n === 0 ? 'dup' : 'fresh'));
  const { service } = await makeService({ source, commons: new StubCommons([commonsImage()]) });
  const d = await service.next(['bha-dup']);
  assert.equal(d.id, 'bha-fresh');
});

test('missing source on a live fact is surfaced as the provider label, never invented', async () => {
  const source = new StubSource(() => ({
    data: [{ text: 'Test Person founded a school.', people: ['Test Person'] }],
  }));
  const { service } = await makeService({
    source,
    commons: new StubCommons([commonsImage()]),
  });
  const d = await service.next();
  assert.equal(d.provider, 'blackhistoryapi');
  assert.equal(d.source.label, 'Black History API');
  assert.equal(d.source.url, null);
  assert.deepEqual(d.people, ['Test Person']);
  assert.deepEqual(d.tags, []);
});

test('get() returns null for unknown ids and serves reviewed fallbacks by id', async () => {
  const { service } = await makeService();
  assert.equal(service.get('nope'), null);
  assert.equal(service.get(INLINE_FALLBACKS[0]!.id)?.id, INLINE_FALLBACKS[0]!.id);
});

test('fallback images are registered so /v1/media can serve them', async () => {
  const { service, mediaStore } = await makeService();
  for (const f of INLINE_FALLBACKS) {
    const d = service.get(f.id)!;
    assert.ok(mediaStore instanceof MediaStore);
    assert.ok(mediaStore.isAllowedSource(f.visual.imageUrl));
    assert.ok(d.visual.imageUrl.endsWith(`/v1/media/${f.visual.assetId}`));
  }
});
