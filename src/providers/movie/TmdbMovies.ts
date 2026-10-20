/**
 * TMDB movie lookups for the movie provider: details, search and IMDb ID lookup, cached.
 */

import { CircuitBreaker } from '../../resilience/circuitBreaker';
import { HttpSource, NotFoundError } from '../../resilience/http';
import { DAY_MS } from '../../sources/SummarySource';
import { Store } from '../../store/Store';

export interface TmdbMovie {
  id: number;
  title: string;
  original_title?: string;
  release_date?: string;
  overview?: string;
  poster_path?: string | null;
  popularity?: number;
  adult?: boolean;
  external_ids?: { imdb_id?: string | null };
}

interface SearchResponse {
  results?: TmdbMovie[];
}

interface FindResponse {
  movie_results?: TmdbMovie[];
}

export const POSTER_BASE = 'https://image.tmdb.org/t/p/w500';

export class TmdbMovies {
  private http: HttpSource;

  constructor(
    apiKey: string,
    private readonly store: Store,
    http?: HttpSource
  ) {
    this.http =
      http ??
      new HttpSource({
        baseURL: 'https://api.themoviedb.org/3',
        params: { api_key: apiKey },
        breaker: new CircuitBreaker('tmdb-movies'),
      });
  }

  /** Movie details with external IDs, or undefined if TMDB has no such movie. */
  async getMovie(id: string, language: string): Promise<TmdbMovie | undefined> {
    const value = await this.cached(`tmdbm:movie:${id}:${language}`, 7 * DAY_MS, async () => {
      try {
        return await this.http.getJson<TmdbMovie>(`/movie/${encodeURIComponent(id)}`, {
          language,
          append_to_response: 'external_ids',
        });
      } catch (error) {
        if (error instanceof NotFoundError) return null;
        throw error;
      }
    });
    return value ?? undefined;
  }

  /** The TMDB movie for an IMDb ID, if any. */
  async findByImdb(imdbId: string, language: string): Promise<TmdbMovie | undefined> {
    const value = await this.cached(`tmdbm:find:${imdbId}:${language}`, 7 * DAY_MS, async () => {
      const found = await this.http.getJson<FindResponse>(`/find/${encodeURIComponent(imdbId)}`, {
        external_source: 'imdb_id',
        language,
      });
      return found.movie_results?.[0] ?? null;
    });
    return value ?? undefined;
  }

  async search(query: string, options: { year?: number; includeAdult: boolean; language: string }): Promise<TmdbMovie[]> {
    const params: Record<string, string | number> = {
      query,
      include_adult: options.includeAdult ? 'true' : 'false',
      language: options.language,
    };
    if (options.year) params.year = options.year;
    const key = `tmdbm:search:${JSON.stringify(params)}`;
    const value = await this.cached(key, DAY_MS, async () => {
      const response = await this.http.getJson<SearchResponse>('/search/movie', params);
      return response.results ?? [];
    });
    return value ?? [];
  }

  private async cached<T>(key: string, ttlMs: number, fetch: () => Promise<T | null>): Promise<T | null> {
    const hit = this.store.cacheGet<T | null>(key);
    if (hit) return hit.value;
    const value = await fetch();
    this.store.cacheSet(key, value, value === null ? DAY_MS : ttlMs);
    return value;
  }
}
