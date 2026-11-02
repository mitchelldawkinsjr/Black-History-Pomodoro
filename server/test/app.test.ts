import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { BlackHistoryClient } from '../src/providers/blackHistoryClient.js';
import { DiscoveryService, INLINE_FALLBACKS } from '../src/services/discoveryService.js';
import { ImageMatcher } from '../src/services/imageMatcher.js';
import { MediaStore } from '../src/services/mediaStore.js';
import { JPEG_BYTES, StubCommons, commonsImage, fakeFetch, tmpDir } from './helpers.js';

const SECRET = 'sk-super-secret-key-123';

async function makeApp(
  env: Record<string, string> = {},
  opts: { withKey?: boolean; upstream?: typeof fetch; withCommons?: boolean } = {},
) {
  const dir = await tmpDir();
  const config = loadConfig({
    PUBLIC_API_ORIGIN: 'https://api.example.test',
    MEDIA_CACHE_DIR: path.join(dir, 'media'),
    ...(opts.withKey ? { BLACK_HISTORY_API_KEY: SECRET } : {}),
    ...env,
  });
  const mediaStore = new MediaStore({
    cacheDir: config.mediaCacheDir,
    fetchImpl: fakeFetch(() => new Response(JPEG_BYTES, { status: 200 })),
  });
  const source = config.apiKey
    ? new BlackHistoryClient({ apiKey: config.apiKey, baseUrl: config.baseUrl, factPath: config.factPath, fetchImpl: opts.upstream })
    : null;
  const commons = opts.withCommons ? new StubCommons([commonsImage()]) : new StubCommons([]);
  const service = new DiscoveryService({
    source,
    matcher: new ImageMatcher(commons, config.imageMatchAttempts),
    mediaStore,
    publicOrigin: config.publicOrigin,
    cacheTtlSeconds: config.cacheTtlSeconds,
    random: () => 0,
  });
  const app = await buildApp({ config, service, mediaStore });
  return { app, service, config };
}

test('config defaults match the spec', () => {
  const c = loadConfig({});
  assert.equal(c.baseUrl, 'https://rest.blackhistoryapi.io/v2');
  assert.equal(c.cacheTtlSeconds, 604800);
  assert.equal(c.imageMatchAttempts, 8);
  assert.equal(c.rateLimitPerMinute, 30);
  assert.equal(c.port, 8080);
  assert.equal(c.apiKey, undefined);
  assert.equal(loadConfig({ BLACK_HISTORY_API_KEY: '' }).apiKey, undefined);
});

test('GET /healthz -> { ok: true }', async () => {
  const { app } = await makeApp();
  const res = await app.inject('/healthz');
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true });
});

test('GET / serves the Live Reveal PWA shell', async () => {
  const { app } = await makeApp();
  const res = await app.inject('/');
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'] ?? '', /text\/html/);
  assert.match(res.body, /Black History — Live Reveal/);
  assert.match(res.body, /manifest\.webmanifest/);

  const manifest = await app.inject('/manifest.webmanifest');
  assert.equal(manifest.statusCode, 200);
  assert.match(manifest.body, /Black History Live Reveal/);

  const sw = await app.inject('/sw.js');
  assert.equal(sw.statusCode, 200);
  assert.match(sw.body, /bhp-screensaver/);

  const paint = await app.inject('/overlay/paint-sketch.js');
  assert.equal(paint.statusCode, 200);
});

test('GET /v1/discoveries/next -> schemaVersion 1 discovery; honors exclude', async () => {
  const { app } = await makeApp();
  const res = await app.inject('/v1/discoveries/next');
  assert.equal(res.statusCode, 200);
  const d = res.json();
  assert.equal(d.schemaVersion, 1);
  assert.equal(d.id, INLINE_FALLBACKS[0]!.id);

  const ex = INLINE_FALLBACKS.slice(0, 2).map((f) => f.id).join(',');
  const res2 = await app.inject(`/v1/discoveries/next?exclude=${encodeURIComponent(ex)}`);
  assert.equal(res2.json().id, INLINE_FALLBACKS[2]!.id);
});

test('GET /v1/discoveries/next with everything excluded -> NO_ELIGIBLE_DISCOVERY', async () => {
  const { app } = await makeApp();
  const all = INLINE_FALLBACKS.map((f) => f.id).join(',');
  const res = await app.inject(`/v1/discoveries/next?exclude=${all}`);
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error.code, 'NO_ELIGIBLE_DISCOVERY');
});

test('invalid exclude ids -> 400 VALIDATION_FAILURE', async () => {
  const { app } = await makeApp();
  const res = await app.inject('/v1/discoveries/next?exclude=ok,bad%20id%3Cscript%3E');
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, 'VALIDATION_FAILURE');
});

test('GET /v1/discoveries/:id -> cached discovery or 404 NOT_FOUND', async () => {
  const { app } = await makeApp();
  const ok = await app.inject(`/v1/discoveries/${INLINE_FALLBACKS[1]!.id}`);
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().id, INLINE_FALLBACKS[1]!.id);
  const missing = await app.inject('/v1/discoveries/bha-unknown');
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.json().error.code, 'NOT_FOUND');
  const invalid = await app.inject('/v1/discoveries/%3Cbad%3E');
  assert.equal(invalid.statusCode, 400);
});

test('unknown routes -> NOT_FOUND typed error', async () => {
  const { app } = await makeApp();
  const res = await app.inject('/nope');
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error.code, 'NOT_FOUND');
});

test('GET /v1/media/:assetId serves image bytes with safe headers; unknown -> 404; bad id -> 400', async () => {
  const { app } = await makeApp();
  const d = (await app.inject('/v1/discoveries/next')).json();
  const url = new URL(d.visual.imageUrl);
  const res = await app.inject(url.pathname);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'image/jpeg');
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.ok(res.rawPayload.equals(JPEG_BYTES));

  assert.equal((await app.inject('/v1/media/unknownasset')).statusCode, 404);
  assert.equal((await app.inject('/v1/media/..%2F..%2Fetc%2Fpasswd')).statusCode, 400);
});

test('clients cannot request arbitrary URLs through the media route', async () => {
  const { app } = await makeApp();
  const res = await app.inject({ url: '/v1/media/x?url=https://evil.example.com/a.jpg' });
  assert.equal(res.statusCode, 404);
  const res2 = await app.inject('/v1/media/https%3A%2F%2Fevil.example.com%2Fa.jpg');
  assert.equal(res2.statusCode, 400);
});

test('CORS allows chrome-extension://* and PUBLIC_API_ORIGIN only', async () => {
  const { app } = await makeApp();
  const get = (origin: string) => app.inject({ url: '/healthz', headers: { origin } });
  assert.equal((await get('chrome-extension://abcdefghijklmnop')).headers['access-control-allow-origin'], 'chrome-extension://abcdefghijklmnop');
  assert.equal((await get('https://api.example.test')).headers['access-control-allow-origin'], 'https://api.example.test');
  assert.equal((await get('https://evil.example.com')).headers['access-control-allow-origin'], undefined);
  const pre = await app.inject({
    method: 'OPTIONS',
    url: '/v1/discoveries/next',
    headers: { origin: 'chrome-extension://abc', 'access-control-request-method': 'GET' },
  });
  assert.equal(pre.statusCode, 204);
  assert.equal(pre.headers['access-control-allow-origin'], 'chrome-extension://abc');
});

test('per-IP in-memory rate limit returns typed RATE_LIMITED (healthz exempt)', async () => {
  const { app } = await makeApp({ RATE_LIMIT_PER_MINUTE: '3' });
  const codes: number[] = [];
  for (let i = 0; i < 5; i++) codes.push((await app.inject('/v1/discoveries/next')).statusCode);
  assert.deepEqual(codes, [200, 200, 200, 429, 429]);
  const limited = await app.inject('/v1/discoveries/next');
  assert.equal(limited.json().error.code, 'RATE_LIMITED');
  assert.equal((await app.inject('/healthz')).statusCode, 200);
});

test('upstream auth failure falls back and never leaks the API key', async () => {
  const upstream = fakeFetch(() => new Response(`denied for ${SECRET}`, { status: 401 }));
  const { app } = await makeApp({}, { withKey: true, upstream });
  const res = await app.inject('/v1/discoveries/next');
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().provider, 'curated');
  assert.ok(!res.body.includes(SECRET));
  assert.equal(upstream.calls.length, 3);

  const all = INLINE_FALLBACKS.map((f) => f.id).join(',');
  const err = await app.inject(`/v1/discoveries/next?exclude=${all}`);
  assert.equal(err.statusCode, 502);
  assert.equal(err.json().error.code, 'UPSTREAM_UNAVAILABLE');
  assert.ok(!err.body.includes(SECRET));
});

test('API key is sent only as a request header, never in the URL', async () => {
  const upstream = fakeFetch(() =>
    Response.json({
      data: [
        {
          text: 'Test Person did a thing.',
          related_people: [{ type: 'person', value: 'Test Person' }],
          source_references: ['Archive'],
        },
      ],
    }),
  );
  const seen: Array<{ url: string; headers: unknown }> = [];
  const wrapped = (async (url: string, init?: RequestInit) => {
    seen.push({ url, headers: init?.headers });
    return upstream(url);
  }) as unknown as typeof fetch;
  const { app } = await makeApp({}, { withKey: true, upstream: wrapped, withCommons: true });
  const res = await app.inject('/v1/discoveries/next');
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().provider, 'blackhistoryapi');
  assert.equal(res.json().visual.depictsSubject, true);
  assert.ok(seen.length >= 1);
  assert.ok(!seen[0]!.url.includes(SECRET));
  assert.equal((seen[0]!.headers as Record<string, string>)['x-api-key'], SECRET);
  assert.ok(!res.body.includes(SECRET));
});
