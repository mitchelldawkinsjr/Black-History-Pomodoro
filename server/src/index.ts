import 'dotenv/config';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { BlackHistoryClient } from './providers/blackHistoryClient.js';
import { CommonsClient } from './providers/commonsClient.js';
import { registerDiscoveryRoutes } from './routes/discoveries.js';
import { registerMediaRoutes } from './routes/media.js';
import { DiscoveryService } from './services/discoveryService.js';
import { ImageMatcher } from './services/imageMatcher.js';
import { MediaStore } from './services/mediaStore.js';

const PORT = Number(process.env.PORT ?? 8080);
const PUBLIC_API_ORIGIN = (
  process.env.PUBLIC_API_ORIGIN ?? 'https://blackhistory.360web.cloud'
).replace(/\/$/, '');
const RATE_LIMIT_PER_MINUTE = Number(process.env.RATE_LIMIT_PER_MINUTE ?? 30);
const IMAGE_MATCH_ATTEMPTS = Number(process.env.IMAGE_MATCH_ATTEMPTS ?? 8);
const MEDIA_CACHE_DIR = process.env.MEDIA_CACHE_DIR ?? '/data/cache/media';
const FALLBACKS_PATH = process.env.FALLBACKS_PATH ?? '/app/data/reviewed-fallbacks.json';

async function main(): Promise<void> {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin || origin === PUBLIC_API_ORIGIN || origin.startsWith('chrome-extension://')) {
        cb(null, true);
        return;
      }
      cb(null, false);
    },
  });

  await app.register(rateLimit, {
    max: RATE_LIMIT_PER_MINUTE,
    timeWindow: '1 minute',
  });

  const mediaStore = new MediaStore(MEDIA_CACHE_DIR);
  await mediaStore.init();

  const blackHistory = new BlackHistoryClient({
    apiKey: process.env.BLACK_HISTORY_API_KEY,
    baseUrl: process.env.BLACK_HISTORY_BASE_URL ?? 'https://rest.blackhistoryapi.io/v2',
  });

  const imageMatcher = new ImageMatcher(
    new CommonsClient(),
    mediaStore,
    PUBLIC_API_ORIGIN,
    IMAGE_MATCH_ATTEMPTS,
  );

  const discoveryService = new DiscoveryService(
    blackHistory,
    imageMatcher,
    mediaStore,
    PUBLIC_API_ORIGIN,
    FALLBACKS_PATH,
  );
  await discoveryService.init();

  app.get('/healthz', async () => ({ ok: true }));
  await registerDiscoveryRoutes(app, discoveryService);
  await registerMediaRoutes(app, mediaStore);

  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);
    reply.code(500).send({ error: 'VALIDATION_FAILURE', message: 'Unexpected server error' });
  });

  await app.listen({ port: PORT, host: '0.0.0.0' });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
