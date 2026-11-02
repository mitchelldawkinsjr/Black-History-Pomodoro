import { z } from 'zod';

export const ASSET_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const DISCOVERY_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export const LicenseKindSchema = z.enum(['public-domain', 'cc0', 'cc-by', 'cc-by-sa', 'project-asset']);
export type LicenseKind = z.infer<typeof LicenseKindSchema>;

export const DiscoveryVisualSchema = z.object({
  assetId: z.string().regex(ASSET_ID_PATTERN),
  /** Public URL (…/v1/media/:assetId) when served; the approved upstream URL inside reviewed-fallbacks.json. */
  imageUrl: z.string().url(),
  title: z.string(),
  alt: z.string().min(1),
  creator: z.string().nullable(),
  sourceUrl: z.string(),
  license: z.string().min(1),
  licenseUrl: z.string().nullable(),
  credit: z.string(),
  depictionType: z.enum(['photo', 'document', 'artwork', 'generic']),
  /** True only when the image was matched to the specific person the fact is about. */
  depictsSubject: z.boolean(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  reviewedAt: z.string(),
  /** Machine-readable license class (optional; absent in older reviewed files). */
  licenseKind: LicenseKindSchema.optional(),
});
export type DiscoveryVisual = z.infer<typeof DiscoveryVisualSchema>;

export const HistoricalDiscoverySchema = z.object({
  id: z.string().regex(DISCOVERY_ID_PATTERN),
  provider: z.enum(['blackhistoryapi', 'curated']),
  providerFactId: z.string().min(1),
  factText: z.string().trim().min(1),
  people: z.array(z.string()),
  tags: z.array(z.string()),
  eventDate: z.string().nullable(),
  source: z.object({
    label: z.string().min(1),
    url: z.string().nullable(),
    providerUrl: z.string().nullable(),
  }),
  visual: DiscoveryVisualSchema,
  generatedAt: z.string(),
  schemaVersion: z.literal(1),
});
export type HistoricalDiscovery = z.infer<typeof HistoricalDiscoverySchema>;

/** Shape of data/reviewed-fallbacks.json: an array, or { discoveries: [...] }. */
export const ReviewedFallbackFileSchema = z.union([
  z.array(z.unknown()),
  z.object({ discoveries: z.array(z.unknown()) }),
]);

export const IdSchema = z.string().regex(DISCOVERY_ID_PATTERN);

export const NextQuerySchema = z.object({
  exclude: z.string().max(4000).optional(),
});

export const AssetIdParamSchema = z.object({
  assetId: z.string().regex(ASSET_ID_PATTERN),
});

export const MAX_EXCLUDE_IDS = 300;

/** Parses `?exclude=a,b,c` into validated, de-duplicated ids. Throws ZodError on bad ids. */
export function parseExclude(raw: string | undefined): string[] {
  if (!raw) return [];
  const ids = [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))];
  return z.array(IdSchema).max(MAX_EXCLUDE_IDS).parse(ids);
}

// ---- Typed errors ---------------------------------------------------------

export type ApiErrorCode =
  | 'NO_ELIGIBLE_DISCOVERY'
  | 'UPSTREAM_UNAVAILABLE'
  | 'VALIDATION_FAILURE'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

export const ERROR_STATUS: Record<ApiErrorCode, number> = {
  NO_ELIGIBLE_DISCOVERY: 404,
  UPSTREAM_UNAVAILABLE: 502,
  VALIDATION_FAILURE: 400,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

export class ApiError extends Error {
  readonly statusCode: number;

  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    statusCode: number = ERROR_STATUS[code],
  ) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
  }
}

export interface ErrorBody {
  error: { code: ApiErrorCode; message: string };
}

/** Removes any occurrence of the secret from a string so it can never reach a client or log line. */
export function redactSecret(text: string, secret: string | undefined): string {
  if (!secret) return text;
  return text.split(secret).join('[redacted]');
}
