import { z } from 'zod';

export const HistoricalDiscoverySchema = z.object({
  id: z.string().min(1),
  provider: z.enum(['blackhistoryapi', 'curated']),
  providerFactId: z.string().min(1),
  factText: z.string().min(1),
  people: z.array(z.string()),
  tags: z.array(z.string()),
  eventDate: z.string().nullable(),
  source: z.object({
    label: z.string(),
    url: z.string().nullable(),
    providerUrl: z.string().nullable(),
  }),
  visual: z.object({
    assetId: z.string().min(1),
    imageUrl: z.string().url(),
    title: z.string(),
    alt: z.string(),
    creator: z.string().nullable(),
    sourceUrl: z.string(),
    license: z.string(),
    licenseUrl: z.string().nullable(),
    credit: z.string(),
    depictionType: z.enum(['photo', 'document', 'artwork', 'generic']),
    depictsSubject: z.boolean(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    reviewedAt: z.string(),
  }),
  generatedAt: z.string(),
  schemaVersion: z.literal(1),
});

export type HistoricalDiscovery = z.infer<typeof HistoricalDiscoverySchema>;

export type ApiErrorCode =
  | 'NO_ELIGIBLE_DISCOVERY'
  | 'UPSTREAM_UNAVAILABLE'
  | 'VALIDATION_FAILURE'
  | 'NOT_FOUND';

export class ApiError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
