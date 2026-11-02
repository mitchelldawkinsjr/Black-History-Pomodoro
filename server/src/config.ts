import path from 'node:path';
import { z } from 'zod';

const boolish = z
  .string()
  .optional()
  .transform((v) => v !== undefined && ['1', 'true', 'yes'].includes(v.toLowerCase()));

const EnvSchema = z.object({
  BLACK_HISTORY_API_KEY: z.string().optional(),
  BLACK_HISTORY_BASE_URL: z.string().url().default('https://rest.blackhistoryapi.io/v2'),
  BLACK_HISTORY_FACT_PATH: z.string().default('/fact/random'),
  PUBLIC_API_ORIGIN: z.string().url().optional(),
  DISCOVERY_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(604800),
  IMAGE_MATCH_ATTEMPTS: z.coerce.number().int().positive().max(50).default(16),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(30),
  PORT: z.coerce.number().int().min(0).max(65535).default(8080),
  REVIEWED_FALLBACKS_PATH: z.string().optional(),
  FALLBACKS_PATH: z.string().optional(), // alias used by the deployment Dockerfile / compose file
  MEDIA_CACHE_DIR: z.string().optional(),
  TRUST_PROXY: boolish,
});

export interface Config {
  apiKey: string | undefined;
  baseUrl: string;
  factPath: string;
  publicOrigin: string;
  cacheTtlSeconds: number;
  imageMatchAttempts: number;
  rateLimitPerMinute: number;
  port: number;
  fallbacksPath: string;
  mediaCacheDir: string;
  trustProxy: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Treat empty strings (e.g. `KEY=` in .env) as unset.
  const cleaned: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) cleaned[k] = v === '' ? undefined : v;
  const e = EnvSchema.parse(cleaned);
  const origin = (e.PUBLIC_API_ORIGIN ?? `http://localhost:${e.PORT}`).replace(/\/+$/, '');
  return {
    apiKey: e.BLACK_HISTORY_API_KEY,
    baseUrl: e.BLACK_HISTORY_BASE_URL.replace(/\/+$/, ''),
    factPath: e.BLACK_HISTORY_FACT_PATH.startsWith('/')
      ? e.BLACK_HISTORY_FACT_PATH
      : `/${e.BLACK_HISTORY_FACT_PATH}`,
    publicOrigin: origin,
    cacheTtlSeconds: e.DISCOVERY_CACHE_TTL_SECONDS,
    imageMatchAttempts: e.IMAGE_MATCH_ATTEMPTS,
    rateLimitPerMinute: e.RATE_LIMIT_PER_MINUTE,
    port: e.PORT,
    fallbacksPath: path.resolve(e.REVIEWED_FALLBACKS_PATH ?? e.FALLBACKS_PATH ?? '../data/reviewed-fallbacks.json'),
    mediaCacheDir: path.resolve(e.MEDIA_CACHE_DIR ?? './data/cache/media'),
    trustProxy: e.TRUST_PROXY,
  };
}
