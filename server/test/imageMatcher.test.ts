import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { classifyLicense, parseCommonsResponse, preferLicenses } from '../src/providers/commonsClient.js';
import { ImageMatcher, evaluateCandidate, pickSubject, GENERIC_ASSET } from '../src/services/imageMatcher.js';
import { MediaStore, sniffImage } from '../src/services/mediaStore.js';
import { JPEG_BYTES, StubCommons, commonsImage, fakeFetch, tmpDir } from './helpers.js';

test('classifyLicense accepts PD / CC0 / CC BY / CC BY-SA and rejects NC / ND / unknown', () => {
  assert.equal(classifyLicense('Public domain')?.kind, 'public-domain');
  assert.equal(classifyLicense('PD-US-expired')?.kind, 'public-domain');
  assert.equal(classifyLicense('CC0')?.kind, 'cc0');
  assert.equal(classifyLicense('CC BY 4.0')?.kind, 'cc-by');
  assert.equal(classifyLicense('CC BY-SA 3.0')?.kind, 'cc-by-sa');
  assert.equal(classifyLicense('CC-BY-SA-4.0')?.kind, 'cc-by-sa');
  assert.equal(classifyLicense('CC BY-NC 4.0'), null);
  assert.equal(classifyLicense('CC BY-ND 2.0'), null);
  assert.equal(classifyLicense('Fair use'), null);
  assert.equal(classifyLicense('All rights reserved'), null);
  assert.equal(classifyLicense(null, ''), null);
});

test('parseCommonsResponse maps API pages, rewrites thumb host, drops disallowed licenses', () => {
  const page = (title: string, license: string, index: number) => ({
    title,
    index,
    imageinfo: [
      {
        thumburl: `https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/X.jpg/960px-X.jpg?utm_source=commons`,
        thumbwidth: 960,
        thumbheight: 1200,
        mime: 'image/jpeg',
        descriptionurl: 'https://commons.wikimedia.org/wiki/File:X.jpg',
        extmetadata: {
          LicenseShortName: { value: license },
          Artist: { value: '<a href="x">Jane Doe</a>' },
          ImageDescription: { value: '<p>Portrait of Test Person</p>' },
        },
      },
    ],
  });
  const out = parseCommonsResponse({
    query: { pages: [page('File:B.jpg', 'CC BY 4.0', 2), page('File:A.jpg', 'Public domain', 1), page('File:C.jpg', 'CC BY-NC 4.0', 3)] },
  });
  assert.deepEqual(out.map((o) => o.title), ['File:A.jpg', 'File:B.jpg']);
  assert.equal(out[0]?.imageUrl, 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/X.jpg/960px-X.jpg');
  assert.equal(out[0]?.creator, 'Jane Doe');
  assert.equal(out[0]?.description, 'Portrait of Test Person');
  assert.deepEqual(parseCommonsResponse({}), []);
});

test('preferLicenses ranks PD/CC0 before CC BY before CC BY-SA', () => {
  const ranked = preferLicenses([
    commonsImage({ title: 'File:sa.jpg', license: { kind: 'cc-by-sa', rank: 2, label: 'CC BY-SA' } }),
    commonsImage({ title: 'File:by.jpg', license: { kind: 'cc-by', rank: 1, label: 'CC BY' } }),
    commonsImage({ title: 'File:pd.jpg' }),
  ]);
  assert.deepEqual(ranked.map((r) => r.title), ['File:pd.jpg', 'File:by.jpg', 'File:sa.jpg']);
});

test('pickSubject: none, single, and ambiguous multi-person facts', () => {
  assert.equal(pickSubject({ text: 'x', people: [] }), null);
  assert.equal(pickSubject({ text: 'x', people: ['A B'] }), 'A B');
  assert.equal(pickSubject({ text: 'Ada Byron wrote notes with Charles Babbage.', people: ['Ada Byron', 'Charles Babbage'] }), null);
  assert.equal(pickSubject({ text: 'Ada Byron wrote notes.', people: ['Ada Byron', 'Charles Babbage'] }), 'Ada Byron');
});

test('evaluateCandidate rejects wrong name, group photos, wrong mime and tiny images', () => {
  assert.equal(evaluateCandidate(commonsImage(), 'Test Person').ok, true);
  assert.equal(evaluateCandidate(commonsImage({ title: 'File:Someone Else.jpg', description: 'A building' }), 'Test Person').ok, false);
  assert.equal(evaluateCandidate(commonsImage({ title: 'File:Test Person and Other Person.jpg' }), 'Test Person').reason, 'ambiguous-title');
  assert.equal(evaluateCandidate(commonsImage({ mime: 'image/tiff' }), 'Test Person').reason, 'mime');
  assert.equal(evaluateCandidate(commonsImage({ width: 80 }), 'Test Person').reason, 'too-small');
  // Name present only in the description is accepted; diacritics/case are normalised.
  assert.equal(evaluateCandidate(commonsImage({ title: 'File:IMG_001.jpg', description: 'Portrait of TEST PERSON' }), 'Test Person').ok, true);
});

test('matcher returns a depictsSubject:true image with attribution for a clear match', async () => {
  const matcher = new ImageMatcher(new StubCommons([commonsImage()]), 8);
  const m = await matcher.match({ text: 'Test Person did a thing.', people: ['Test Person'] });
  assert.equal(m.visual.depictsSubject, true);
  assert.equal(m.subject, 'Test Person');
  assert.equal(m.visual.license, 'Public domain');
  assert.equal(m.visual.sourceUrl, 'https://commons.wikimedia.org/wiki/File:Test_Person_portrait.jpg');
  assert.ok(m.sourceUrl.startsWith('https://upload.wikimedia.org/'));
});

test('matcher rejects ambiguous subjects (no people / multiple people) with the generic visual', async () => {
  const commons = new StubCommons([commonsImage()]);
  const matcher = new ImageMatcher(commons, 8);
  for (const people of [[], ['Test Person', 'Other Person']]) {
    const m = await matcher.match({ text: 'Both Test Person and Other Person met.', people });
    assert.equal(m.visual.depictsSubject, false);
    assert.equal(m.sourceUrl, GENERIC_ASSET);
  }
  assert.equal(commons.queries.length, 0);
});

test('matcher stops after IMAGE_MATCH_ATTEMPTS and returns the generic visual', async () => {
  const bad = Array.from({ length: 20 }, (_, i) => commonsImage({ title: `File:Unrelated ${i}.jpg`, description: 'A landscape' }));
  const commons = new StubCommons(bad);
  const matcher = new ImageMatcher(commons, 4);
  const m = await matcher.match({ text: 'Test Person did a thing.', people: ['Test Person'] });
  assert.equal(m.visual.depictsSubject, false);
  assert.equal(m.visual.depictionType, 'generic');
  assert.equal(m.attemptsUsed, 4);
  assert.equal(commons.queries.length, 1, 'budget exhausted before a second search');
});

test('a matching candidate beyond the attempt budget is not used', async () => {
  const list = [
    ...Array.from({ length: 5 }, (_, i) => commonsImage({ title: `File:Nope ${i}.jpg`, description: 'x' })),
    commonsImage({ title: 'File:Test Person.jpg' }),
  ];
  const m = await new ImageMatcher(new StubCommons(list), 4).match({ text: 't', people: ['Test Person'] });
  assert.equal(m.visual.depictsSubject, false);
});

test('matcher survives Commons errors', async () => {
  const commons = new StubCommons(() => {
    throw new Error('commons down');
  });
  const m = await new ImageMatcher(commons, 8).match({ text: 't', people: ['Test Person'] });
  assert.equal(m.visual.depictsSubject, false);
});

test('matcher prefers PD over CC BY-SA candidates', async () => {
  const list = [
    commonsImage({ title: 'File:Test Person sa.jpg', license: { kind: 'cc-by-sa', rank: 2, label: 'CC BY-SA' }, licenseShortName: 'CC BY-SA 4.0' }),
    commonsImage({ title: 'File:Test Person pd.jpg' }),
  ];
  const m = await new ImageMatcher(new StubCommons(list), 8).match({ text: 't', people: ['Test Person'] });
  assert.equal(m.visual.title, 'Test Person pd.jpg');
});

// ---- MediaStore -----------------------------------------------------------

const GOOD_URL = 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/aa/X.jpg/960px-X.jpg';

test('MediaStore only registers allowlisted https hosts and local assets', async () => {
  const store = new MediaStore({ cacheDir: path.join(await tmpDir(), 'm') });
  assert.ok(store.register(GOOD_URL));
  assert.ok(store.register('https://commons.wikimedia.org/wiki/Special:FilePath/X.jpg'));
  assert.ok(store.register(GENERIC_ASSET));
  for (const bad of [
    'http://upload.wikimedia.org/x.jpg',
    'https://evil.example.com/x.jpg',
    'https://upload.wikimedia.org.evil.com/x.jpg',
    'https://user:pw@upload.wikimedia.org/x.jpg',
    'https://upload.wikimedia.org:8443/x.jpg',
    'file:///etc/passwd',
    'local:../secret.png',
    'local:notes.txt',
    '/etc/passwd',
    'javascript:alert(1)',
  ]) {
    assert.throws(() => store.register(bad), (e: unknown) => (e as { code?: string }).code === 'VALIDATION_FAILURE', bad);
  }
});

test('MediaStore downloads once, caches to disk, and survives a restart', async () => {
  const dir = path.join(await tmpDir(), 'm');
  const f = fakeFetch(() => new Response(JPEG_BYTES, { status: 200, headers: { 'content-type': 'image/jpeg' } }));
  const store = new MediaStore({ cacheDir: dir, fetchImpl: f });
  const id = store.register(GOOD_URL);
  const [a, b] = await Promise.all([store.get(id), store.get(id)]);
  assert.equal(a?.contentType, 'image/jpeg');
  assert.ok(a?.data.equals(JPEG_BYTES) && b?.data.equals(JPEG_BYTES));
  await store.get(id);
  assert.equal(f.calls.length, 1, 'downloaded exactly once');

  await new Promise((r) => setTimeout(r, 50)); // let meta persist
  const f2 = fakeFetch(() => new Response('should not be called', { status: 500 }));
  const restarted = new MediaStore({ cacheDir: dir, fetchImpl: f2 });
  const again = await restarted.get(id);
  assert.ok(again?.data.equals(JPEG_BYTES));
  assert.equal(f2.calls.length, 0);
});

test('MediaStore: unknown/invalid ids -> null; non-image and failed downloads -> UPSTREAM_UNAVAILABLE', async () => {
  const dir = path.join(await tmpDir(), 'm');
  const store = new MediaStore({ cacheDir: dir, fetchImpl: fakeFetch(() => new Response('<html>nope</html>', { status: 200 })) });
  assert.equal(await store.get('does-not-exist'), null);
  assert.equal(await store.get('../../etc/passwd'), null);
  const id = store.register(GOOD_URL);
  await assert.rejects(store.get(id), (e: unknown) => (e as { code?: string }).code === 'UPSTREAM_UNAVAILABLE');

  const failing = new MediaStore({ cacheDir: dir + '2', fetchImpl: fakeFetch(() => new Response('', { status: 404 })) });
  await assert.rejects(failing.get(failing.register(GOOD_URL)), (e: unknown) => (e as { code?: string }).code === 'UPSTREAM_UNAVAILABLE');
});

test('MediaStore refuses redirects to non-allowlisted hosts', async () => {
  const f = fakeFetch(() => new Response(null, { status: 302, headers: { location: 'https://evil.example.com/x.jpg' } }));
  const store = new MediaStore({ cacheDir: path.join(await tmpDir(), 'm'), fetchImpl: f });
  await assert.rejects(store.get(store.register(GOOD_URL)), (e: unknown) => (e as { code?: string }).code === 'UPSTREAM_UNAVAILABLE');
  assert.equal(f.calls.length, 1, 'the evil host is never contacted');
});

test('MediaStore enforces a max download size', async () => {
  const big = Buffer.concat([JPEG_BYTES, Buffer.alloc(2048)]);
  const store = new MediaStore({ cacheDir: path.join(await tmpDir(), 'm'), maxBytes: 1024, fetchImpl: fakeFetch(() => new Response(big)) });
  await assert.rejects(store.get(store.register(GOOD_URL)), (e: unknown) => (e as { code?: string }).code === 'UPSTREAM_UNAVAILABLE');
});

test('MediaStore serves the built-in generic PNG', async () => {
  const store = new MediaStore({ cacheDir: path.join(await tmpDir(), 'm') });
  const media = await store.get(store.register(GENERIC_ASSET));
  assert.equal(media?.contentType, 'image/png');
  assert.equal(sniffImage(media!.data), 'image/png');
});

test('sniffImage detects JPEG, PNG, WebP only', () => {
  assert.equal(sniffImage(JPEG_BYTES), 'image/jpeg');
  assert.equal(sniffImage(Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'binary')), 'image/webp');
  assert.equal(sniffImage(Buffer.from('GIF89a......')), null);
  assert.equal(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), null);
});
