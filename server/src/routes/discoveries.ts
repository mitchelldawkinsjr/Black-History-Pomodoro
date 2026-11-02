import type { FastifyInstance } from 'fastify';
import { ApiError } from '../schemas/discovery.js';
import type { DiscoveryService } from '../services/discoveryService.js';

const MAX_EXCLUDE = 50;
const MAX_ID_LENGTH = 128;

function parseExclude(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part.length <= MAX_ID_LENGTH)
    .slice(0, MAX_EXCLUDE);
}

export async function registerDiscoveryRoutes(
  app: FastifyInstance,
  discoveryService: DiscoveryService,
): Promise<void> {
  app.get('/v1/discoveries/next', async (request, reply) => {
    const exclude = parseExclude((request.query as { exclude?: string }).exclude);
    try {
      return await discoveryService.next(exclude);
    } catch (error) {
      if (error instanceof ApiError) {
        return reply.code(error.statusCode).send({ error: error.code, message: error.message });
      }
      request.log.error(error);
      return reply
        .code(503)
        .send({ error: 'NO_ELIGIBLE_DISCOVERY', message: 'No eligible discovery available' });
    }
  });

  app.get('/v1/discoveries/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!id || id.length > MAX_ID_LENGTH) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Discovery not found' });
    }
    try {
      return await discoveryService.getById(id);
    } catch (error) {
      if (error instanceof ApiError) {
        return reply.code(error.statusCode).send({ error: error.code, message: error.message });
      }
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Discovery not found' });
    }
  });
}
