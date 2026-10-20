/**
 * TheTVDB v4 HTTP client: login with the project API key (+ optional PIN), a cached bearer
 * token, and one re-login when the token is rejected.
 */

import axios from 'axios';
import { CircuitBreaker } from '../../resilience/circuitBreaker';
import { HttpSource } from '../../resilience/http';
import { Store } from '../../store/Store';
import { DAY_MS } from '../SummarySource';

export interface TvdbEnvelope<T> {
  status: string;
  data: T;
  links?: { next?: string | null; total_items?: number };
}

const TOKEN_KEY = 'tvdb:token';
/** Tokens last about a month; refresh well before. */
const TOKEN_TTL_MS = 25 * DAY_MS;

export class TvdbClient {
  readonly http: HttpSource;
  private token?: string;

  constructor(
    private readonly apiKey: string,
    private readonly pin: string | undefined,
    private readonly store: Store,
    http?: HttpSource
  ) {
    this.http = http ?? new HttpSource({ baseURL: 'https://api4.thetvdb.com/v4', breaker: new CircuitBreaker('tvdb') });
  }

  /** GET with the bearer token. A failed login throws; a rejected token triggers one re-login. */
  async get<T>(url: string, params?: Record<string, string | number>): Promise<T> {
    const token = await this.getToken();
    try {
      return await this.http.getJson<T>(url, params, { Authorization: `Bearer ${token}` });
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        return this.http.getJson<T>(url, params, { Authorization: `Bearer ${await this.getToken(true)}` });
      }
      throw error;
    }
  }

  private async getToken(refresh = false): Promise<string> {
    if (!refresh) {
      if (this.token) return this.token;
      const cached = this.store.cacheGet<string>(TOKEN_KEY);
      if (cached) return (this.token = cached.value);
    }

    const body = this.pin ? { apikey: this.apiKey, pin: this.pin } : { apikey: this.apiKey };
    const response = await this.http.postJson<TvdbEnvelope<{ token: string }>>('/login', body);
    const token = response.data?.token;
    if (!token) {
      throw new Error('TVDB login returned no token; check TVDB_API_KEY / TVDB_PIN');
    }
    this.store.cacheSet(TOKEN_KEY, token, TOKEN_TTL_MS);
    return (this.token = token);
  }
}
