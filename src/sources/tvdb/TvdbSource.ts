/**
 * TheTVDB v4 summaries for shows, seasons and episodes, by the item's own tvdb:// ID.
 * Docs: https://thetvdb.github.io/v4-api/
 */

import { CircuitBreaker } from '../../resilience/circuitBreaker';
import { HttpSource, NotFoundError, describeError } from '../../resilience/http';
import { Store } from '../../store/Store';
import { cleanSummary } from '../../text/cleanSummary';
import { DAY_MS, LookupItem, SourceLookup, SummarySource, externalId } from '../SummarySource';
import { TvdbClient, TvdbEnvelope } from './TvdbClient';

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
  /** Share one logged-in client between sources and the TV provider. */
  client?: TvdbClient;
  ttlMs?: number;
  notFoundTtlMs?: number;
}

export class TvdbSource implements SummarySource {
  readonly name = 'tvdb' as const;
  private client: TvdbClient;
  private lang: string;

  constructor(private readonly options: TvdbOptions) {
    this.client =
      options.client ??
      new TvdbClient(
        options.apiKey,
        options.pin,
        options.store,
        options.http ?? new HttpSource({ baseURL: 'https://api4.thetvdb.com/v4', breaker: new CircuitBreaker('tvdb') })
      );
    this.lang = tvdbLanguage(options.language);
  }

  get breaker(): CircuitBreaker {
    return this.client.http.breaker;
  }

  async getSummary(item: LookupItem): Promise<SourceLookup> {
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
      const result = await this.client.get<TvdbEnvelope<TvdbTranslation>>(`/${endpoint}/${encodeURIComponent(id)}/translations/${this.lang}`);
      return result.data?.overview ?? '';
    } catch (error) {
      if (error instanceof NotFoundError) return null;
      throw error;
    }
  }
}
