import type { FastifyInstance } from 'fastify';
import { ApiError, AssetIdParamSchema } from '../schemas/discovery.js';
import type { MediaStore } from '../services/mediaStore.js';

export function registerMediaRoutes(app: FastifyInstance, store: MediaStore): void {
  app.get('/v1/media/:assetId', async (req, reply) => {
    const { assetId } = AssetIdParamSchema.parse(req.params);
    const media = await store.get(assetId);
    if (!media) throw new ApiError('NOT_FOUND', 'Media asset not found.');
    return reply
      .header('content-type', media.contentType)
      .header('content-length', media.data.length)
      .header('cache-control', 'public, max-age=86400, immutable')
      .header('x-content-type-options', 'nosniff')
      .header('cross-origin-resource-policy', 'cross-origin')
      .send(media.data);
  });
}
