/**
 * Outbound JSON GET with timeout, retries (network errors, 429, 5xx) and a circuit breaker.
 */

import axios, { AxiosInstance } from 'axios';
import { CircuitBreaker } from './circuitBreaker';

export interface HttpOptions {
  baseURL: string;
  /** Query params sent on every request (e.g. an API key). */
  params?: Record<string, string>;
  timeoutMs?: number;
  maxRetries?: number;
  /** Base backoff delay; doubles per attempt, with jitter. */
  backoffMs?: number;
  breaker: CircuitBreaker;
  sleep?: (ms: number) => Promise<void>;
}

/** A 404 from upstream: the item doesn't exist there. Not retried, not a breaker failure. */
export class NotFoundError extends Error {}

const NOT_FOUND = Symbol('not-found');

export class HttpSource {
  private client: AxiosInstance;
  private maxRetries: number;
  private backoffMs: number;
  private sleep: (ms: number) => Promise<void>;
  readonly breaker: CircuitBreaker;

  constructor(options: HttpOptions) {
    this.client = axios.create({
      baseURL: options.baseURL,
      params: options.params,
      timeout: options.timeoutMs ?? 8000,
    });
    this.maxRetries = options.maxRetries ?? 3;
    this.backoffMs = options.backoffMs ?? 500;
    this.breaker = options.breaker;
    this.sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  }

  /** GETs JSON. Throws NotFoundError on 404; other failures (after retries) throw the last error. */
  async getJson<T>(url: string, params?: Record<string, string | number>): Promise<T> {
    // A 404 resolves inside the breaker so it doesn't count as a failure.
    const result = await this.breaker.run(() => this.withRetries<T>(url, params));
    if (result === NOT_FOUND) {
      throw new NotFoundError(`${url} not found`);
    }
    return result;
  }

  private async withRetries<T>(url: string, params?: Record<string, string | number>): Promise<T | typeof NOT_FOUND> {
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await this.client.get<T>(url, { params });
        return response.data;
      } catch (error) {
        const status = axios.isAxiosError(error) ? error.response?.status : undefined;
        if (status === 404) {
          return NOT_FOUND;
        }
        const retryable = status === undefined || status === 429 || status >= 500;
        if (!retryable || attempt >= this.maxRetries) {
          throw error;
        }
        await this.sleep(this.delayFor(attempt, error));
      }
    }
  }

  private delayFor(attempt: number, error: unknown): number {
    if (axios.isAxiosError(error)) {
      const retryAfter = Number(error.response?.headers?.['retry-after']);
      if (Number.isFinite(retryAfter) && retryAfter > 0) {
        return Math.min(retryAfter, 30) * 1000;
      }
    }
    const base = this.backoffMs * 2 ** attempt;
    return base / 2 + Math.random() * base;
  }
}

/** Short, secret-free description of an HTTP error for logs. */
export function describeError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    return error.response ? `HTTP ${error.response.status}` : (error.code ?? error.message);
  }
  return error instanceof Error ? error.message : String(error);
}
