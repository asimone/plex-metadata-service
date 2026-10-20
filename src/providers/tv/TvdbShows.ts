/**
 * TVDB as the TV backbone: search, a show with its seasons, and its episodes (aired order),
 * all in the requested language and cached.
 */

import axios from 'axios';
import { NotFoundError } from '../../resilience/http';
import { DAY_MS } from '../../sources/SummarySource';
import { TvdbClient, TvdbEnvelope } from '../../sources/tvdb/TvdbClient';
import { Store } from '../../store/Store';

export interface TvdbSearchResult {
  tvdbId: string;
  name: string;
  /** Name in the requested language, if TVDB has one. */
  translatedName?: string;
  aliases: string[];
  year?: number;
  image?: string;
  overview?: string;
}

export interface ShowSeason {
  id: number;
  number: number;
  /** TVDB has an overview for this season in the requested language. */
  hasOverview: boolean;
}

export interface Show {
  id: number;
  /** Title in the requested language, falling back to TVDB's primary name. */
  title: string;
  originalTitle: string;
  overview?: string;
  year?: number;
  firstAired?: string;
  imdbId?: string;
  tmdbId?: string;
  seasons: ShowSeason[];
}

export interface Episode {
  id: number;
  seasonNumber: number;
  number: number;
  name?: string;
  overview?: string;
  aired?: string;
}

interface RawSearch {
  tvdb_id: string;
  name: string;
  aliases?: string[];
  year?: string;
  image_url?: string;
  translations?: Record<string, string>;
  overviews?: Record<string, string>;
  overview?: string;
}

interface RawSeries {
  id: number;
  name: string;
  year?: string;
  firstAired?: string;
  overview?: string;
  originalLanguage?: string;
  remoteIds?: Array<{ id: string; sourceName?: string }>;
  seasons?: Array<{ id: number; number: number; type?: { type?: string }; overviewTranslations?: string[] }>;
  translations?: {
    nameTranslations?: Array<{ name: string; language: string; isAlias?: boolean }>;
    overviewTranslations?: Array<{ overview: string; language: string }>;
  };
}

interface RawEpisode {
  id: number;
  seasonNumber: number;
  number: number;
  name?: string | null;
  overview?: string | null;
  aired?: string | null;
}

export class TvdbShows {
  constructor(
    private readonly client: TvdbClient,
    private readonly store: Store
  ) {}

  async search(query: string, lang: string, year?: number): Promise<TvdbSearchResult[]> {
    const params: Record<string, string | number> = { query, type: 'series' };
    if (year) params.year = year;
    const raw = await this.cached(`tvdbs:search:${JSON.stringify(params)}`, DAY_MS, async () => {
      const r = await this.client.get<TvdbEnvelope<RawSearch[]>>('/search', params);
      return r.data ?? [];
    });
    return (raw ?? []).map(r => ({
      tvdbId: String(r.tvdb_id),
      name: r.name,
      translatedName: r.translations?.[lang],
      aliases: r.aliases ?? [],
      year: r.year ? parseInt(r.year, 10) || undefined : undefined,
      image: r.image_url,
      overview: r.overviews?.[lang],
    }));
  }

  /** The TVDB series ID for an IMDb ID, if TVDB knows it as a series. */
  async seriesIdForImdb(imdbId: string): Promise<string | undefined> {
    const id = await this.cached(`tvdbs:remote:${imdbId}`, 7 * DAY_MS, async () => {
      try {
        const r = await this.client.get<TvdbEnvelope<Array<{ series?: { id: number } }>>>(`/search/remoteid/${encodeURIComponent(imdbId)}`);
        const series = (r.data ?? []).find(x => x.series)?.series;
        return series ? String(series.id) : null;
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    });
    return id ?? undefined;
  }

  async show(id: string, lang: string): Promise<Show | undefined> {
    const raw = await this.cached(`tvdbs:series:${id}`, 7 * DAY_MS, async () => {
      try {
        const r = await this.client.get<TvdbEnvelope<RawSeries>>(`/series/${encodeURIComponent(id)}/extended`, {
          meta: 'translations',
          short: 'true',
        });
        return r.data;
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    });
    return raw ? toShow(raw, lang) : undefined;
  }

  /** Every episode of a show in aired order, in the requested language. */
  async episodes(seriesId: string, lang: string): Promise<Episode[]> {
    const raw = await this.cached(`tvdbs:episodes:${seriesId}:${lang}`, DAY_MS, async () => {
      const all: RawEpisode[] = [];
      for (let page = 0; page < 20; page++) {
        const r = await this.client.get<TvdbEnvelope<{ episodes?: RawEpisode[] }>>(
          `/series/${encodeURIComponent(seriesId)}/episodes/default/${lang}`,
          { page }
        );
        all.push(...(r.data?.episodes ?? []));
        if (!r.links?.next) break;
      }
      return all;
    });
    return (raw ?? []).map(e => ({
      id: e.id,
      seasonNumber: e.seasonNumber,
      number: e.number,
      name: e.name ?? undefined,
      overview: inLanguage(e.overview ?? undefined, lang),
      aired: e.aired ?? undefined,
    }));
  }

  /** The series an episode belongs to. */
  async seriesIdForEpisode(episodeId: string): Promise<string | undefined> {
    const id = await this.cached(`tvdbs:episode-series:${episodeId}`, 30 * DAY_MS, async () => {
      try {
        const r = await this.client.get<TvdbEnvelope<{ seriesId: number }>>(`/episodes/${encodeURIComponent(episodeId)}`);
        return r.data?.seriesId ? String(r.data.seriesId) : null;
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    });
    return id ?? undefined;
  }

  private async cached<T>(key: string, ttlMs: number, fetch: () => Promise<T | null>): Promise<T | null> {
    const hit = this.store.cacheGet<T | null>(key);
    if (hit) return hit.value;
    const value = await fetch();
    this.store.cacheSet(key, value, value === null ? DAY_MS : ttlMs);
    return value;
  }
}

function toShow(raw: RawSeries, lang: string): Show {
  const names = raw.translations?.nameTranslations ?? [];
  const translated = names.find(n => n.language === lang && !n.isAlias)?.name;
  const overview = raw.translations?.overviewTranslations?.find(o => o.language === lang)?.overview;
  const remote = (source: string) => raw.remoteIds?.find(r => (r.sourceName ?? '').toLowerCase().includes(source))?.id;

  const seasons = (raw.seasons ?? [])
    .filter(s => (s.type?.type ?? 'official') === 'official')
    .map(s => ({ id: s.id, number: s.number, hasOverview: (s.overviewTranslations ?? []).includes(lang) }))
    .sort((a, b) => a.number - b.number);

  return {
    id: raw.id,
    title: translated ?? raw.name,
    originalTitle: raw.name,
    overview: overview ?? (raw.originalLanguage === lang ? raw.overview : undefined),
    year: raw.year ? parseInt(raw.year, 10) || undefined : undefined,
    firstAired: raw.firstAired || undefined,
    imdbId: remote('imdb'),
    tmdbId: remote('themoviedb'),
    seasons,
  };
}

const LATIN_LANGUAGES = new Set(['eng', 'deu', 'fra', 'spa', 'ita', 'por', 'nld', 'swe', 'dan', 'nor', 'fin', 'pol']);

/**
 * TVDB can return the original-language text when a translation is missing. For Latin-script
 * languages, treat text that is mostly non-Latin (e.g. Japanese) as "no overview in this language".
 */
export function inLanguage(text: string | undefined, lang: string): string | undefined {
  if (!text || !LATIN_LANGUAGES.has(lang)) return text;
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return text;
  const latin = letters.filter(ch => /\p{Script=Latin}/u.test(ch)).length;
  return latin / letters.length >= 0.5 ? text : undefined;
}

/** TVDB answers unknown IDs with 404, and impossible ones (e.g. 0) with 400. */
function isMissing(error: unknown): boolean {
  return error instanceof NotFoundError || (axios.isAxiosError(error) && error.response?.status === 400);
}
