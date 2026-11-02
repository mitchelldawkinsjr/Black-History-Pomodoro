import type { FastifyInstance } from 'fastify';
import { ApiError } from '../schemas/discovery.js';
import type { MediaStore } from '../services/mediaStore.js';

const ASSET_ID_RE = /^[a-zA-Z0-9_-]{3,128}$/;

export async function registerMediaRoutes(
  app: FastifyInstance,
  mediaStore: MediaStore,
): Promise<void> {
  app.get('/v1/media/:assetId', async (request, reply) => {
    const { assetId } = request.params as { assetId: string };
    if (!ASSET_ID_RE.test(assetId)) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Media not found' });
    }
    try {
      const media = await mediaStore.read(assetId);
      reply.header('Content-Type', media.contentType);
      reply.header('Cache-Control', 'public, max-age=86400');
      return reply.send(media.bytes);
    } catch (error) {
      if (error instanceof ApiError) {
        return reply.code(error.statusCode).send({ error: error.code, message: error.message });
      }
      request.log.error(error);
      return reply.code(503).send({ error: 'UPSTREAM_UNAVAILABLE', message: 'Media unavailable' });
    }
  });
}
