import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import type { Config } from './config.js';
import { BlackHistoryClient } from './providers/blackHistoryClient.js';
import { CommonsClient } from './providers/commonsClient.js';
import { registerDiscoveryRoutes } from './routes/discoveries.js';
import { registerMediaRoutes } from './routes/media.js';
import { ApiError, redactSecret, type ApiErrorCode, type ErrorBody } from './schemas/discovery.js';
import { DiscoveryService, loadReviewedFallbacks } from './services/discoveryService.js';
import { ImageMatcher } from './services/imageMatcher.js';
import { MediaStore } from './services/mediaStore.js';

export interface AppDeps {
  config: Config;
  service: DiscoveryService;
  mediaStore: MediaStore;
  logger?: boolean;
}

export function isAllowedOrigin(origin: string | undefined, publicOrigin: string): boolean {
  if (!origin) return true; // non-browser / same-origin requests
  return origin.startsWith('chrome-extension://') || origin === publicOrigin;
}

export async function createServices(config: Config, warn: (m: string, e?: unknown) => void = () => undefined) {
  const mediaStore = new MediaStore({ cacheDir: config.mediaCacheDir });
  const source = config.apiKey
    ? new BlackHistoryClient({ apiKey: config.apiKey, baseUrl: config.baseUrl, factPath: config.factPath })
    : null;
  const matcher = new ImageMatcher(new CommonsClient(), config.imageMatchAttempts);
  const fallbacks = await loadReviewedFallbacks(config.fallbacksPath, (m) => warn(m));
  const service = new DiscoveryService({
    source,
    matcher,
    mediaStore,
    publicOrigin: config.publicOrigin,
    cacheTtlSeconds: config.cacheTtlSeconds,
    fallbacks,
    onWarn: warn,
  });
  return { service, mediaStore };
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config, service, mediaStore } = deps;
  const app = Fastify({ logger: deps.logger ?? false, trustProxy: config.trustProxy });

  await app.register(cors, {
    origin: (origin, cb) => cb(null, isAllowedOrigin(origin, config.publicOrigin)),
    methods: ['GET', 'OPTIONS'],
    maxAge: 86400,
  });

  // Plain in-memory store, keyed by client IP (the default key generator).
  await app.register(rateLimit, {
    max: config.rateLimitPerMinute,
    timeWindow: '1 minute',
    errorResponseBuilder: () => new ApiError('RATE_LIMITED', 'Too many requests. Please slow down.'),
  });

  app.setErrorHandler((error, req, reply) => {
    let code: ApiErrorCode;
    let message: string;
    let status: number;
    if (error instanceof ApiError) {
      ({ code, message } = error);
      status = error.statusCode;
    } else if (error instanceof ZodError) {
      code = 'VALIDATION_FAILURE';
      status = 400;
      message = `Invalid request: ${error.issues.map((i) => i.path.join('.') || 'value').join(', ')}`;
    } else if ((error as { statusCode?: number }).statusCode === 429) {
      code = 'RATE_LIMITED';
      status = 429;
      message = 'Too many requests. Please slow down.';
    } else if ((error as { validation?: unknown }).validation !== undefined) {
      code = 'VALIDATION_FAILURE';
      status = 400;
      message = 'Invalid request.';
    } else {
      req.log.error({ err: redactSecret(String(error), config.apiKey) }, 'unhandled error');
      code = 'INTERNAL_ERROR';
      status = 500;
      message = 'Internal server error.';
    }
    const body: ErrorBody = { error: { code, message: redactSecret(message, config.apiKey) } };
    return reply.status(status).send(body);
  });

  app.setNotFoundHandler((_req, reply) => {
    const body: ErrorBody = { error: { code: 'NOT_FOUND', message: 'Route not found.' } };
    return reply.status(404).send(body);
  });

  app.get('/healthz', { config: { rateLimit: false } }, async () => ({ ok: true }));
  registerDiscoveryRoutes(app, service);
  registerMediaRoutes(app, mediaStore);

  return app;
}
