import { ApiError } from '../schemas/discovery.js';
import { extractFactCandidates, type NormalizedFact } from './blackHistoryAdapter.js';

export class BlackHistoryClient {
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(config: { apiKey?: string; baseUrl: string; timeoutMs?: number }) {
    this.apiKey = config.apiKey?.trim() || undefined;
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.timeoutMs = config.timeoutMs ?? 8000;
  }

  get enabled(): boolean {
    return Boolean(this.apiKey);
  }

  async fetchRandomFact(): Promise<NormalizedFact[]> {
    if (!this.apiKey) return [];

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}/fact/random`, {
        headers: { 'x-api-key': this.apiKey, Accept: 'application/json' },
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403 || response.status === 429 || !response.ok) {
        throw new ApiError('UPSTREAM_UNAVAILABLE', 'Upstream request failed', 503);
      }
      return extractFactCandidates(await response.json());
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError('UPSTREAM_UNAVAILABLE', 'Upstream unavailable', 503);
    } finally {
      clearTimeout(timer);
    }
  }
}
