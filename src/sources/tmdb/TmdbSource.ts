/**
 * TMDB summaries for movies, by tmdb:// ID or (via /find) imdb:// ID.
 * Docs: https://developer.themoviedb.org/reference
 */

import { PlexItem } from '../../plex/types';
import { CircuitBreaker } from '../../resilience/circuitBreaker';
import { HttpSource, NotFoundError, describeError } from '../../resilience/http';
import { Store } from '../../store/Store';
import { cleanSummary } from '../../text/cleanSummary';
import { DAY_MS, SourceLookup, SummarySource, externalId } from '../SummarySource';

interface TmdbMovie {
  id: number;
  overview?: string;
}

interface TmdbFind {
  movie_results?: TmdbMovie[];
}

export interface TmdbOptions {
  apiKey: string;
  language: string;
  store: Store;
  http?: HttpSource;
  ttlMs?: number;
  notFoundTtlMs?: number;
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
    if (item.type !== 'movie') {
      return { status: 'no-id' };
    }

    const tmdbId = externalId(item, 'tmdb');
    const imdbId = externalId(item, 'imdb');
    try {
      if (tmdbId) {
        const overview = await this.cached(`tmdb:movie:${tmdbId}`, () => this.movieOverview(tmdbId));
        return toLookup(overview, `tmdb://${tmdbId}`);
      }
      if (imdbId) {
        const overview = await this.cached(`tmdb:find:${imdbId}`, () => this.findOverview(imdbId));
        return toLookup(overview, `imdb://${imdbId}`);
      }
      return { status: 'no-id' };
    } catch (error) {
      return { status: 'unavailable', reason: `tmdb: ${describeError(error)}` };
    }
  }

  private async movieOverview(id: string): Promise<string | null> {
    try {
      const movie = await this.http.getJson<TmdbMovie>(`/movie/${encodeURIComponent(id)}`, {
        language: this.options.language,
      });
      return movie.overview ?? '';
    } catch (error) {
      if (error instanceof NotFoundError) return null;
      throw error;
    }
  }

  private async findOverview(imdbId: string): Promise<string | null> {
    const result = await this.http.getJson<TmdbFind>(`/find/${encodeURIComponent(imdbId)}`, {
      external_source: 'imdb_id',
      language: this.options.language,
    });
    const movie = result.movie_results?.[0];
    return movie ? (movie.overview ?? '') : null;
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

function toLookup(overview: string | null, id: string): SourceLookup {
  const summary = cleanSummary(overview);
  return summary ? { status: 'found', summary, externalId: id } : { status: 'not-found', externalId: id };
}
