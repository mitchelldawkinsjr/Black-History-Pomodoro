import { redactSecret } from '../schemas/discovery.js';

export class UpstreamError extends Error {
  readonly upstreamStatus: number | null;
  constructor(message: string, upstreamStatus: number | null = null) {
    super(message);
    this.name = 'UpstreamError';
    this.upstreamStatus = upstreamStatus;
  }
}

export interface BlackHistoryClientOptions {
  apiKey: string;
  baseUrl: string;
  factPath: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface FactSource {
  fetchRandomFact(): Promise<unknown>;
}

/** Thin HTTP client for the Black History API v2. The key is only ever sent as a request header. */
export class BlackHistoryClient implements FactSource {
  private readonly apiKey: string;
  private readonly url: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: BlackHistoryClientOptions) {
    this.apiKey = opts.apiKey;
    this.url = `${opts.baseUrl.replace(/\/+$/, '')}${opts.factPath}`;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 8000;
  }

  async fetchRandomFact(): Promise<unknown> {
    let res: Response;
    try {
      res = await this.fetchImpl(this.url, {
        method: 'GET',
        headers: { 'x-api-key': this.apiKey, accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'network error';
      throw new UpstreamError(`Black History API request failed: ${redactSecret(msg, this.apiKey)}`);
    }
    if (!res.ok) {
      throw new UpstreamError(`Black History API responded with HTTP ${res.status}`, res.status);
    }
    try {
      return await res.json();
    } catch {
      throw new UpstreamError('Black History API returned invalid JSON', res.status);
    }
  }
}
