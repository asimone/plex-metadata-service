/**
 * The movie metadata provider: matching and metadata for type 1, backed by TMDB.
 * Returns identity, title, dates, external IDs and the summary; Plex Movie fills the rest.
 */

import { SourceName, SummarySource } from '../../sources/SummarySource';
import { resolveSummary } from '../../sources/resolve';
import { cleanSummary } from '../../text/cleanSummary';
import logger from '../../utils/logger';
import { ProviderMetadata, buildGuid, compact, metadataKey, yearOf } from '../common';
import { idHints, rank, yearFromFilename } from '../match';
import { POSTER_BASE, TmdbMovie, TmdbMovies } from './TmdbMovies';

export const MOVIE_IDENTIFIER = 'tv.plex.agents.custom.simone.movie';
export const MOVIE_TITLE = 'TMDB Movies';

const RATING_KEY = /^tmdb-movie-(\d+)$/;

export interface MovieMatchRequest {
  title?: string;
  year?: number;
  guid?: string;
  filename?: string;
  manual?: boolean;
  includeAdult?: boolean;
  language: string;
}

export class MovieProvider {
  constructor(
    private readonly tmdb: TmdbMovies,
    /** Builds summary sources for a language (sources cache per language). */
    private readonly sourcesFor: (language: string) => Map<SourceName, SummarySource>
  ) {}

  /** Returns ranked matches: at most one, or up to 10 for manual searches. */
  async match(req: MovieMatchRequest): Promise<ProviderMetadata[]> {
    const limit = req.manual ? 10 : 1;
    const hints = idHints(req.guid, req.filename);

    // An ID hint is authoritative.
    const byId = hints.tmdb
      ? await this.tmdb.getMovie(hints.tmdb, req.language)
      : hints.imdb
        ? await this.tmdb.findByImdb(hints.imdb, req.language)
        : undefined;
    if (byId) {
      logger.info(`movie match: ${req.title ?? '?'} → tmdb ${byId.id} (ID hint)`);
      return [toMatchResult(byId)];
    }

    if (!req.title) {
      return [];
    }
    const year = req.year ?? yearFromFilename(req.filename);
    const includeAdult = req.includeAdult ?? false;
    let results = await this.tmdb.search(req.title, { year, includeAdult, language: req.language });
    if (results.length === 0 && year) {
      // TMDB's year filter is strict; retry without it and let ranking weigh the year.
      results = await this.tmdb.search(req.title, { includeAdult, language: req.language });
    }
    if (!includeAdult) {
      results = results.filter(r => !r.adult);
    }

    const ranked = rank(
      { title: req.title, year },
      results.map(r => ({ ...r, originalTitle: r.original_title, year: yearOf(r.release_date) }))
    ).slice(0, limit);
    logger.info(`movie match: ${req.title} (${year ?? '?'}) → ${ranked.map(r => `tmdb ${r.id}`).join(', ') || 'no match'}`);
    return ranked.map(toMatchResult);
  }

  /** Full metadata for a ratingKey, or undefined if it isn't ours or TMDB doesn't know it. */
  async metadata(ratingKey: string, language: string): Promise<ProviderMetadata | undefined> {
    const id = RATING_KEY.exec(ratingKey)?.[1];
    if (!id) return undefined;
    const movie = await this.tmdb.getMovie(id, language);
    if (!movie) return undefined;

    const imdbId = movie.external_ids?.imdb_id || undefined;
    const externalIds = [imdbId && `imdb://${imdbId}`, `tmdb://${movie.id}`].filter((x): x is string => Boolean(x));
    // TMDB is first in the movie source order and we already have its overview; ask the
    // remaining sources (OMDb) only when it's empty.
    let summary = cleanSummary(movie.overview);
    let source = summary ? 'tmdb' : 'none';
    if (!summary) {
      const others = new Map([...this.sourcesFor(language)].filter(([name]) => name !== 'tmdb'));
      const { winner } = await resolveSummary(others, { type: 'movie', title: movie.title, externalIds });
      summary = winner?.summary;
      source = winner?.source ?? 'none';
    }
    logger.info(`movie metadata: ${movie.title} [${ratingKey}] summary=${source}`);

    return compact({
      ...base(movie),
      originalTitle: movie.original_title && movie.original_title !== movie.title ? movie.original_title : undefined,
      summary,
      Guid: externalIds.map(id => ({ id })),
    });
  }
}

function base(movie: TmdbMovie): ProviderMetadata {
  const ratingKey = `tmdb-movie-${movie.id}`;
  return compact({
    ratingKey,
    key: metadataKey(ratingKey),
    guid: buildGuid(MOVIE_IDENTIFIER, 'movie', ratingKey),
    type: 'movie' as const,
    title: movie.title,
    originallyAvailableAt: movie.release_date || undefined,
    year: yearOf(movie.release_date),
  });
}

/** Match results carry a poster and a short summary so Fix Match is easy to read. */
function toMatchResult(movie: TmdbMovie): ProviderMetadata {
  return compact({
    ...base(movie),
    thumb: movie.poster_path ? `${POSTER_BASE}${movie.poster_path}` : undefined,
    summary: cleanSummary(movie.overview),
  });
}
