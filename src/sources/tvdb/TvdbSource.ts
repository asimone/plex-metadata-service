/**
 * TheTVDB v4 summaries for shows, seasons and episodes, by the item's own tvdb:// ID.
 * Docs: https://thetvdb.github.io/v4-api/
 */

import axios from 'axios';
import { PlexItem } from '../../plex/types';
import { CircuitBreaker } from '../../resilience/circuitBreaker';
import { HttpSource, NotFoundError, describeError } from '../../resilience/http';
import { Store } from '../../store/Store';
import { cleanSummary } from '../../text/cleanSummary';
import { DAY_MS, SourceLookup, SummarySource, externalId } from '../SummarySource';

interface TvdbEnvelope<T> {
  status: string;
  data: T;
}

interface TvdbTranslation {
  name?: string;
  overview?: string;
}

const ENDPOINT: Record<string, string> = {
  show: 'series',
  season: 'seasons',
  episode: 'episodes',
};

/** ISO 639-1 → TVDB's 3-letter language codes for the common cases. */
const LANGUAGE_CODES: Record<string, string> = {
  en: 'eng',
  de: 'deu',
  fr: 'fra',
  es: 'spa',
  it: 'ita',
  pt: 'por',
  nl: 'nld',
  sv: 'swe',
  da: 'dan',
  no: 'nor',
  fi: 'fin',
  pl: 'pol',
  ru: 'rus',
  ja: 'jpn',
  ko: 'kor',
  zh: 'zho',
};

/** "en-US" → "eng". Unknown languages fall back to English. */
export function tvdbLanguage(language: string): string {
  return LANGUAGE_CODES[language.slice(0, 2).toLowerCase()] ?? 'eng';
}

export interface TvdbOptions {
  apiKey: string;
  pin?: string;
  language: string;
  store: Store;
  http?: HttpSource;
  ttlMs?: number;
  notFoundTtlMs?: number;
}

const TOKEN_KEY = 'tvdb:token';
/** Tokens last about a month; refresh well before. */
const TOKEN_TTL_MS = 25 * DAY_MS;

export class TvdbSource implements SummarySource {
  readonly name = 'tvdb' as const;
  private http: HttpSource;
  private token?: string;
  private lang: string;

  constructor(private readonly options: TvdbOptions) {
    this.http =
      options.http ??
      new HttpSource({
        baseURL: 'https://api4.thetvdb.com/v4',
        breaker: new CircuitBreaker('tvdb'),
      });
    this.lang = tvdbLanguage(options.language);
  }

  get breaker(): CircuitBreaker {
    return this.http.breaker;
  }

  async getSummary(item: PlexItem): Promise<SourceLookup> {
    const endpoint = ENDPOINT[item.type];
    const id = externalId(item, 'tvdb');
    if (!endpoint || !id) {
      return { status: 'no-id' };
    }

    const key = `tvdb:${endpoint}:${id}:${this.lang}`;
    let overview: string | null;
    const hit = this.options.store.cacheGet<string | null>(key);
    if (hit) {
      overview = hit.value;
    } else {
      try {
        overview = await this.fetchOverview(endpoint, id);
      } catch (error) {
        return { status: 'unavailable', reason: `tvdb: ${describeError(error)}` };
      }
      const ttl = overview === null ? (this.options.notFoundTtlMs ?? 7 * DAY_MS) : (this.options.ttlMs ?? 30 * DAY_MS);
      this.options.store.cacheSet(key, overview, ttl);
    }

    const summary = cleanSummary(overview);
    const ref = `tvdb://${id}`;
    return summary ? { status: 'found', summary, externalId: ref } : { status: 'not-found', externalId: ref };
  }

  /** The overview in the configured language, or null if TVDB has none in that language. */
  private async fetchOverview(endpoint: string, id: string): Promise<string | null> {
    try {
      const result = await this.authed<TvdbEnvelope<TvdbTranslation>>(`/${endpoint}/${encodeURIComponent(id)}/translations/${this.lang}`);
      return result.data?.overview ?? '';
    } catch (error) {
      if (error instanceof NotFoundError) return null;
      throw error;
    }
  }

  /** GET with the bearer token; logs in when needed and once more if the token is rejected. */
  private async authed<T>(url: string): Promise<T> {
    // A failed login throws here, outside the retry below.
    const token = await this.getToken();
    try {
      return await this.http.getJson<T>(url, undefined, { Authorization: `Bearer ${token}` });
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        return this.http.getJson<T>(url, undefined, { Authorization: `Bearer ${await this.getToken(true)}` });
      }
      throw error;
    }
  }

  private async getToken(refresh = false): Promise<string> {
    if (!refresh) {
      if (this.token) return this.token;
      const cached = this.options.store.cacheGet<string>(TOKEN_KEY);
      if (cached) return (this.token = cached.value);
    }

    const body = this.options.pin ? { apikey: this.options.apiKey, pin: this.options.pin } : { apikey: this.options.apiKey };
    const response = await this.http.postJson<TvdbEnvelope<{ token: string }>>('/login', body);
    const token = response.data?.token;
    if (!token) {
      throw new Error('TVDB login returned no token; check TVDB_API_KEY / TVDB_PIN');
    }
    this.options.store.cacheSet(TOKEN_KEY, token, TOKEN_TTL_MS);
    return (this.token = token);
  }
}
