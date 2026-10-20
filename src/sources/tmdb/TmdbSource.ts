/**
 * TMDB summaries, by ID only:
 *   movie   tmdb://  → /movie/{id};        imdb:// → /find (movie_results)
 *   show    tmdb://  → /tv/{id};           tvdb:// or imdb:// → /find (tv_results)
 *   season  tvdb://  → /find (tv_season_results)
 *   episode tvdb:// or imdb:// → /find (tv_episode_results)
 * (Plex's tmdb:// on seasons and episodes is TMDB's internal ID, which TMDB can't look up directly.)
 * Docs: https://developer.themoviedb.org/reference
 */

import { PlexItem, PlexItemType } from '../../plex/types';
import { CircuitBreaker } from '../../resilience/circuitBreaker';
import { HttpSource, NotFoundError, describeError } from '../../resilience/http';
import { Store } from '../../store/Store';
import { cleanSummary } from '../../text/cleanSummary';
import { DAY_MS, SourceLookup, SummarySource, externalId } from '../SummarySource';

interface TmdbOverview {
  overview?: string;
}

type FindKey = 'movie_results' | 'tv_results' | 'tv_season_results' | 'tv_episode_results';
type TmdbFind = Partial<Record<FindKey, TmdbOverview[]>>;

const FIND_RESULTS: Record<PlexItemType, FindKey> = {
  movie: 'movie_results',
  show: 'tv_results',
  season: 'tv_season_results',
  episode: 'tv_episode_results',
};

export interface TmdbOptions {
  apiKey: string;
  language: string;
  store: Store;
  http?: HttpSource;
  ttlMs?: number;
  notFoundTtlMs?: number;
}

/** One way to look an item up: the ID used, the cache key, and the fetch. */
interface Lookup {
  ref: string;
  key: string;
  fetch: () => Promise<string | null>;
}

export class TmdbSource implements SummarySource {
  readonly name = 'tmdb' as const;
  private http: HttpSource;

  constructor(private readonly options: TmdbOptions) {
    this.http =
      options.http ??
      new HttpSource({
        baseURL: 'https://api.themoviedb.org/3',
        params: { api_key: options.apiKey },
        breaker: new CircuitBreaker('tmdb'),
      });
  }

  get breaker(): CircuitBreaker {
    return this.http.breaker;
  }

  async getSummary(item: PlexItem): Promise<SourceLookup> {
    const lookup = this.lookupFor(item);
    if (!lookup) {
      return { status: 'no-id' };
    }
    try {
      const overview = await this.cached(lookup.key, lookup.fetch);
      const summary = cleanSummary(overview);
      return summary ? { status: 'found', summary, externalId: lookup.ref } : { status: 'not-found', externalId: lookup.ref };
    } catch (error) {
      return { status: 'unavailable', reason: `tmdb: ${describeError(error)}` };
    }
  }

  private lookupFor(item: PlexItem): Lookup | undefined {
    const tmdbId = externalId(item, 'tmdb');
    const tvdbId = externalId(item, 'tvdb');
    const imdbId = externalId(item, 'imdb');
    const results = FIND_RESULTS[item.type];

    // Direct lookups: only movies and shows have a TMDB ID that TMDB can fetch by itself.
    if (tmdbId && (item.type === 'movie' || item.type === 'show')) {
      const path = item.type === 'movie' ? 'movie' : 'tv';
      return {
        ref: `tmdb://${tmdbId}`,
        key: `tmdb:${path}:${tmdbId}`,
        fetch: () => this.direct(`/${path}/${encodeURIComponent(tmdbId)}`),
      };
    }
    if (tvdbId && item.type !== 'movie') {
      return { ref: `tvdb://${tvdbId}`, key: `tmdb:find:tvdb:${item.type}:${tvdbId}`, fetch: () => this.find(tvdbId, 'tvdb_id', results) };
    }
    if (imdbId && item.type !== 'season') {
      return { ref: `imdb://${imdbId}`, key: `tmdb:find:imdb:${item.type}:${imdbId}`, fetch: () => this.find(imdbId, 'imdb_id', results) };
    }
    return undefined;
  }

  private async direct(path: string): Promise<string | null> {
    try {
      const result = await this.http.getJson<TmdbOverview>(path, { language: this.options.language });
      return result.overview ?? '';
    } catch (error) {
      if (error instanceof NotFoundError) return null;
      throw error;
    }
  }

  private async find(id: string, source: 'imdb_id' | 'tvdb_id', results: FindKey): Promise<string | null> {
    const found = await this.http.getJson<TmdbFind>(`/find/${encodeURIComponent(id)}`, {
      external_source: source,
      language: this.options.language,
    });
    const first = found[results]?.[0];
    return first ? (first.overview ?? '') : null;
  }

  /** Caches the raw overview (null = not found) per language. */
  private async cached(key: string, fetch: () => Promise<string | null>): Promise<string | null> {
    const fullKey = `${key}:${this.options.language}`;
    const hit = this.options.store.cacheGet<string | null>(fullKey);
    if (hit) return hit.value;

    const value = await fetch();
    const ttl = value === null ? (this.options.notFoundTtlMs ?? 7 * DAY_MS) : (this.options.ttlMs ?? 30 * DAY_MS);
    this.options.store.cacheSet(fullKey, value, ttl);
    return value;
  }
}
