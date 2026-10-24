/**
 * TMDB as the TV fallback for shows TVDB doesn't list: search, a show with its seasons, its
 * episodes, and IMDb ID lookup, in the requested language and cached. Returns the same shapes
 * as TvdbShows so the provider builds responses the same way.
 */

import { CircuitBreaker } from '../../resilience/circuitBreaker';
import { HttpSource, NotFoundError } from '../../resilience/http';
import { DAY_MS } from '../../sources/SummarySource';
import { Store } from '../../store/Store';
import { Episode, Show } from './TvdbShows';

export interface TmdbShowSearchResult {
  tmdbId: string;
  name: string;
  originalName?: string;
  year?: number;
  popularity?: number;
}

interface RawSearch {
  results?: Array<{ id: number; name: string; original_name?: string; first_air_date?: string; popularity?: number }>;
}

interface RawShow {
  id: number;
  name: string;
  original_name?: string;
  overview?: string;
  first_air_date?: string;
  seasons?: Array<{ id: number; season_number: number; overview?: string; episode_count?: number }>;
  external_ids?: { imdb_id?: string | null; tvdb_id?: number | null };
}

interface RawSeason {
  episodes?: Array<{ id: number; season_number: number; episode_number: number; name?: string; overview?: string; air_date?: string | null }>;
}

interface FindResponse {
  tv_results?: Array<{ id: number }>;
}

export class TmdbShows {
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
        breaker: new CircuitBreaker('tmdb-shows'),
      });
  }

  async search(query: string, language: string, year?: number): Promise<TmdbShowSearchResult[]> {
    const params: Record<string, string | number> = { query, language };
    if (year) params.first_air_date_year = year;
    const raw = await this.cached(`tmdbs:search:${JSON.stringify(params)}`, DAY_MS, async () => {
      const r = await this.http.getJson<RawSearch>('/search/tv', params);
      return r.results ?? [];
    });
    return (raw ?? []).map(r => ({
      tmdbId: String(r.id),
      name: r.name,
      originalName: r.original_name,
      year: yearOf(r.first_air_date),
      popularity: r.popularity,
    }));
  }

  /** The TMDB show for an IMDb ID, if TMDB knows it as a TV show. */
  async showIdForImdb(imdbId: string, language: string): Promise<string | undefined> {
    const id = await this.cached(`tmdbs:find:${imdbId}`, 7 * DAY_MS, async () => {
      const found = await this.http.getJson<FindResponse>(`/find/${encodeURIComponent(imdbId)}`, { external_source: 'imdb_id', language });
      const show = found.tv_results?.[0];
      return show ? String(show.id) : null;
    });
    return id ?? undefined;
  }

  async show(id: string, language: string): Promise<Show | undefined> {
    const raw = await this.cached(`tmdbs:show:${id}:${language}`, 7 * DAY_MS, async () => {
      try {
        return await this.http.getJson<RawShow>(`/tv/${encodeURIComponent(id)}`, { language, append_to_response: 'external_ids' });
      } catch (error) {
        if (error instanceof NotFoundError) return null;
        throw error;
      }
    });
    if (!raw) return undefined;
    return {
      id: raw.id,
      title: raw.name,
      originalTitle: raw.original_name ?? raw.name,
      overview: raw.overview || undefined,
      year: yearOf(raw.first_air_date),
      firstAired: raw.first_air_date || undefined,
      imdbId: raw.external_ids?.imdb_id || undefined,
      tmdbId: String(raw.id),
      tvdbId: raw.external_ids?.tvdb_id ? String(raw.external_ids.tvdb_id) : undefined,
      seasons: (raw.seasons ?? [])
        .map(s => ({ id: s.id, number: s.season_number, hasOverview: Boolean(s.overview), overview: s.overview || undefined }))
        .sort((a, b) => a.number - b.number),
    };
  }

  /** Every episode of a show, season by season, in the requested language. */
  async episodes(show: Show, language: string): Promise<Episode[]> {
    const all: Episode[] = [];
    for (const season of show.seasons) {
      const raw = await this.cached(`tmdbs:season:${show.id}:${season.number}:${language}`, DAY_MS, async () => {
        try {
          const r = await this.http.getJson<RawSeason>(`/tv/${show.id}/season/${season.number}`, { language });
          return r.episodes ?? [];
        } catch (error) {
          if (error instanceof NotFoundError) return null;
          throw error;
        }
      });
      for (const e of raw ?? []) {
        all.push({
          id: e.id,
          seasonNumber: e.season_number,
          number: e.episode_number,
          name: e.name || undefined,
          overview: e.overview || undefined,
          aired: e.air_date || undefined,
        });
      }
    }
    return all;
  }

  private async cached<T>(key: string, ttlMs: number, fetch: () => Promise<T | null>): Promise<T | null> {
    const hit = this.store.cacheGet<T | null>(key);
    if (hit) return hit.value;
    const value = await fetch();
    this.store.cacheSet(key, value, value === null ? DAY_MS : ttlMs);
    return value;
  }
}

function yearOf(date?: string): number | undefined {
  return date ? parseInt(date.slice(0, 4), 10) || undefined : undefined;
}
