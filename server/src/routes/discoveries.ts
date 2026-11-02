import type { FastifyInstance } from 'fastify';
import { ApiError, IdSchema, NextQuerySchema, parseExclude } from '../schemas/discovery.js';
import type { DiscoveryService } from '../services/discoveryService.js';

export function registerDiscoveryRoutes(app: FastifyInstance, service: DiscoveryService): void {
  app.get('/v1/discoveries/next', async (req, reply) => {
    const { exclude } = NextQuerySchema.parse(req.query);
    const discovery = await service.next(parseExclude(exclude));
    reply.header('cache-control', 'no-store');
    return discovery;
  });

  app.get('/v1/discoveries/:id', async (req, reply) => {
    const { id } = (req.params ?? {}) as { id?: string };
    const discovery = service.get(IdSchema.parse(id));
    if (!discovery) throw new ApiError('NOT_FOUND', 'Discovery not found or expired.');
    reply.header('cache-control', 'public, max-age=3600');
    return discovery;
  });
}
