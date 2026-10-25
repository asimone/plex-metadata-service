/**
 * The TV metadata provider: shows, seasons and episodes (types 2, 3, 4), backed by TVDB in
 * aired order, with TMDB as the fallback for shows TVDB doesn't list. Returns identity, titles,
 * numbering, dates, external IDs and summaries; Plex Series fills artwork, cast, ratings and the rest.
 */

import { SourceName, SummarySource } from '../../sources/SummarySource';
import { resolveSummary } from '../../sources/resolve';
import { tvdbLanguage } from '../../sources/tvdb/TvdbSource';
import { cleanSummary } from '../../text/cleanSummary';
import logger from '../../utils/logger';
import { MetadataTypeName, ProviderMetadata, buildGuid, compact, metadataKey, yearOf } from '../common';
import { Candidate, idHints, scoreCandidate, yearFromFilename } from '../match';
import { TmdbShows } from './TmdbShows';
import { Episode, Show, ShowSeason, TvdbSearchResult, TvdbShows } from './TvdbShows';

export const TV_IDENTIFIER = 'tv.plex.agents.custom.simone.tv';
export const TV_TITLE = 'TVDB TV Shows';

export interface TvContext {
  /** Plex's language tag, e.g. "en-US". */
  language: string;
  /** Plex's per-show "Episode ordering" (a SeasonType id such as "tvdbDvd"); aired order when unset. */
  episodeOrder?: string;
}

/**
 * Episode orders, as Plex SeasonType ids mapped to TVDB season types. Aired ("official") is the
 * default; the others are offered per show when TVDB has seasons of that type.
 */
const ORDERS = [
  { id: 'tvdbAiring', type: 'official', tag: 'Aired' },
  { id: 'tvdbDvd', type: 'dvd', tag: 'DVD' },
  { id: 'tvdbAbsolute', type: 'absolute', tag: 'Absolute' },
  { id: 'tvdbAlternate', type: 'alternate', tag: 'Alternate' },
  { id: 'tvdbRegional', type: 'regional', tag: 'Regional' },
] as const;

/** The TVDB season type for a Plex episodeOrder; aired order for unknown or missing values. */
export function seasonTypeFor(episodeOrder?: string): string {
  return ORDERS.find(o => o.id === episodeOrder)?.type ?? 'official';
}

/** The orders a TVDB show offers, for Plex's "Episode ordering" setting. Aired is always listed. */
function seasonTypes(show: Show): ProviderMetadata['SeasonType'] {
  return ORDERS.filter(o => o.type === 'official' || (show.seasonsByType?.[o.type]?.length ?? 0) > 0).map(o => ({
    id: o.id,
    source: 'tvdb',
    tag: o.tag,
    title: `TheTVDB (${o.tag})`,
  }));
}

export interface TvMatchRequest {
  type: 2 | 3 | 4;
  title?: string;
  parentTitle?: string;
  grandparentTitle?: string;
  year?: number;
  guid?: string;
  filename?: string;
  index?: number;
  parentIndex?: number;
  date?: string;
  manual?: boolean;
  includeChildren?: boolean;
}

/** Where a show's data comes from. TVDB keys are unchanged; TMDB keys are for shows TVDB lacks. */
export type ShowSource = 'tvdb' | 'tmdb';

interface ShowRef {
  source: ShowSource;
  id: string;
}

type Parsed =
  | { type: 'show'; source: ShowSource; showId: string }
  // Seasons in a non-aired order carry it ("tvdb-season-1-2-dvd"): their episodes differ.
  | { type: 'season'; source: ShowSource; showId: string; season: number; order?: string }
  | { type: 'episode'; source: 'tvdb'; episodeId: string }
  // TMDB has no episode → show lookup, so its episode keys carry the show and numbers.
  | { type: 'episode'; source: 'tmdb'; showId: string; season: number; episode: number };

/**
 * A TVDB title match scoring at least this (an exact title, or a near-exact one in the right year)
 * is trusted without asking TMDB.
 */
const CONFIDENT_SCORE = 90;

/**
 * Search queries to try in order: the title as given, then the part before a subtitle separator
 * (":", " - ", "–", "—") when that leaves something meaningful.
 */
export function searchQueries(title: string): string[] {
  const queries = [title.trim()];
  const main = title.split(/\s*(?::|\s[-–—]\s|[–—])\s*/)[0].trim();
  if (main.length >= 3 && main !== queries[0]) queries.push(main);
  return queries;
}

export function parseTvRatingKey(ratingKey: string): Parsed | undefined {
  let m = /^(tvdb|tmdb)-show-(\d+)$/.exec(ratingKey);
  if (m) return { type: 'show', source: m[1] as ShowSource, showId: m[2] };
  m = /^(tvdb|tmdb)-season-(\d+)-(\d+)(?:-(dvd|absolute|alternate|regional))?$/.exec(ratingKey);
  if (m) {
    const season = { type: 'season' as const, source: m[1] as ShowSource, showId: m[2], season: parseInt(m[3], 10) };
    return m[4] ? { ...season, order: m[4] } : season;
  }
  m = /^tvdb-episode-(\d+)$/.exec(ratingKey);
  if (m) return { type: 'episode', source: 'tvdb', episodeId: m[1] };
  m = /^tmdb-episode-(\d+)-(\d+)-(\d+)$/.exec(ratingKey);
  if (m) return { type: 'episode', source: 'tmdb', showId: m[1], season: parseInt(m[2], 10), episode: parseInt(m[3], 10) };
  return undefined;
}

const showKey = (source: ShowSource, id: number | string) => `${source}-show-${id}`;
const seasonKey = (b: Bundle, n: number) => `${b.source}-season-${b.show.id}-${n}${b.order === 'official' ? '' : `-${b.order}`}`;
// Episode keys don't depend on the order, so switching a show's ordering keeps its episodes (and watch history).
const episodeKey = (b: Bundle, e: Episode) =>
  b.source === 'tvdb' ? `tvdb-episode-${e.id}` : `tmdb-episode-${b.show.id}-${e.seasonNumber}-${e.number}`;
const guidFor = (type: MetadataTypeName, ratingKey: string) => buildGuid(TV_IDENTIFIER, type, ratingKey);
const seasonTitle = (n: number) => (n === 0 ? 'Specials' : `Season ${n}`);

/** A show with its episodes loaded in one episode order, the unit every TV response is built from. */
interface Bundle {
  source: ShowSource;
  /** TVDB season type the episodes are numbered by ("official" = aired; always "official" for TMDB). */
  order: string;
  show: Show;
  episodes: Episode[];
  /** Seasons that actually have episodes, in order. */
  seasons: ShowSeason[];
}

export class TvProvider {
  constructor(
    private readonly tvdb: TvdbShows,
    /** Summary fallbacks (TMDB) and the TVDB season source, per Plex language. */
    private readonly sourcesFor: (language: string) => Map<SourceName, SummarySource>,
    /** Shows TVDB doesn't list. Without it the provider is TVDB-only. */
    private readonly tmdb?: TmdbShows
  ) {}

  // ---------- metadata ----------

  async metadata(ratingKey: string, ctx: TvContext, includeChildren = false): Promise<ProviderMetadata | undefined> {
    const parsed = parseTvRatingKey(ratingKey);
    if (!parsed) return undefined;

    if (parsed.type === 'episode') {
      if (parsed.source === 'tmdb') {
        const bundle = await this.bundle({ source: 'tmdb', id: parsed.showId }, ctx);
        const episode = bundle?.episodes.find(e => e.seasonNumber === parsed.season && e.number === parsed.episode);
        return bundle && episode ? this.episodeMeta(bundle, episode, ctx) : undefined;
      }
      const showId = await this.tvdb.seriesIdForEpisode(parsed.episodeId);
      const bundle = showId ? await this.bundle({ source: 'tvdb', id: showId }, ctx) : undefined;
      const episode = bundle?.episodes.find(e => String(e.id) === parsed.episodeId);
      return bundle && episode ? this.episodeMeta(bundle, episode, ctx) : undefined;
    }

    const bundle = await this.bundle({ source: parsed.source, id: parsed.showId }, ctx, parsed.type === 'season' ? (parsed.order ?? 'official') : undefined);
    if (!bundle) return undefined;

    if (parsed.type === 'show') {
      const meta = await this.showMeta(bundle, ctx);
      if (includeChildren) {
        const seasons = await Promise.all(bundle.seasons.map(s => this.seasonMeta(bundle, s, ctx)));
        meta.Children = { size: seasons.length, Metadata: seasons };
      }
      return meta;
    }

    const season = bundle.seasons.find(s => s.number === parsed.season);
    if (!season) return undefined;
    const meta = await this.seasonMeta(bundle, season, ctx);
    if (includeChildren) {
      const episodes = await this.episodesMeta(bundle, bundle.episodes.filter(e => e.seasonNumber === season.number), ctx);
      meta.Children = { size: episodes.length, Metadata: episodes };
    }
    return meta;
  }

  /** Seasons of a show, or episodes of a season. Undefined if the key isn't a show or season. */
  async children(ratingKey: string, ctx: TvContext, start: number, size: number): Promise<{ items: ProviderMetadata[]; total: number } | undefined> {
    const parsed = parseTvRatingKey(ratingKey);
    if (!parsed || parsed.type === 'episode') return undefined;
    const bundle = await this.bundle({ source: parsed.source, id: parsed.showId }, ctx, parsed.type === 'season' ? (parsed.order ?? 'official') : undefined);
    if (!bundle) return undefined;

    if (parsed.type === 'show') {
      const page = bundle.seasons.slice(start, start + size);
      return { items: await Promise.all(page.map(s => this.seasonMeta(bundle, s, ctx))), total: bundle.seasons.length };
    }
    const episodes = bundle.episodes.filter(e => e.seasonNumber === parsed.season);
    if (!bundle.seasons.some(s => s.number === parsed.season)) return undefined;
    return { items: await this.episodesMeta(bundle, episodes.slice(start, start + size), ctx), total: episodes.length };
  }

  /** All episodes of a show. */
  async grandchildren(ratingKey: string, ctx: TvContext, start: number, size: number): Promise<{ items: ProviderMetadata[]; total: number } | undefined> {
    const parsed = parseTvRatingKey(ratingKey);
    if (!parsed || parsed.type !== 'show') return undefined;
    const bundle = await this.bundle({ source: parsed.source, id: parsed.showId }, ctx);
    if (!bundle) return undefined;
    return {
      items: await this.episodesMeta(bundle, bundle.episodes.slice(start, start + size), ctx),
      total: bundle.episodes.length,
    };
  }

  // ---------- matching ----------

  async match(req: TvMatchRequest, ctx: TvContext): Promise<ProviderMetadata[]> {
    const showTitle = req.type === 2 ? req.title : req.type === 3 ? req.parentTitle : req.grandparentTitle;
    const year = req.type === 2 ? (req.year ?? yearFromFilename(req.filename)) : undefined;
    const limit = req.manual && req.type === 2 ? 10 : 1;

    const candidates = await this.findShows(showTitle, year, req.guid, req.filename, ctx, limit);
    logger.info(`tv match (type ${req.type}): ${showTitle ?? '?'} ${year ? `(${year}) ` : ''}→ ${candidates.map(c => `${c.source} ${c.id}`).join(', ') || 'no match'}`);
    if (candidates.length === 0) return [];

    if (req.type === 2) {
      if (candidates.length === 1) {
        const meta = await this.metadata(showKey(candidates[0].source, candidates[0].id), ctx, req.includeChildren);
        return meta ? [meta] : [];
      }
      // Manual search: one show record per candidate, no children.
      const metas = await Promise.all(candidates.map(c => this.metadata(showKey(c.source, c.id), ctx)));
      return metas.filter((m): m is ProviderMetadata => Boolean(m));
    }

    const bundle = await this.bundle(candidates[0], ctx);
    if (!bundle) return [];

    if (req.type === 3) {
      const season = bundle.seasons.find(s => s.number === req.index);
      if (!season) return [];
      const meta = await this.metadata(seasonKey(bundle, season.number), ctx, req.includeChildren);
      return meta ? [meta] : [];
    }

    const episode =
      req.parentIndex !== undefined && req.index !== undefined
        ? bundle.episodes.find(e => e.seasonNumber === req.parentIndex && e.number === req.index)
        : req.date
          ? bundle.episodes.find(e => e.aired === req.date!.slice(0, 10))
          : undefined;
    return episode ? [await this.episodeMeta(bundle, episode, ctx)] : [];
  }

  /**
   * Shows for a match, best first: ID hints (guid / filename tags), then TVDB title search, then
   * TMDB for shows TVDB doesn't list. TVDB wins whenever it has the show, so existing matches and
   * Sonarr's numbering are unchanged.
   */
  private async findShows(
    title: string | undefined,
    year: number | undefined,
    guid: string | undefined,
    filename: string | undefined,
    ctx: TvContext,
    limit: number
  ): Promise<ShowRef[]> {
    const hints = idHints(guid, filename);
    if (hints.tvdb) return [{ source: 'tvdb', id: hints.tvdb }];
    if (hints.imdb) {
      const id = await this.tvdb.seriesIdForImdb(hints.imdb);
      if (id) return [{ source: 'tvdb', id }];
      const tmdbId = await this.tmdb?.showIdForImdb(hints.imdb, ctx.language);
      if (tmdbId) return [await this.preferTvdb(tmdbId, ctx)];
    }
    if (hints.tmdb && (await this.tmdb?.show(hints.tmdb, ctx.language))) return [await this.preferTvdb(hints.tmdb, ctx)];
    if (!title) return [];

    const wanted = { title, year };
    const byScore = (a: { score: number }, b: { score: number }) => b.score - a.score;
    const tvdbHits = (await this.searchTvdb(title, year, tvdbLanguage(ctx.language)))
      .map(r => ({ ref: { source: 'tvdb', id: r.tvdbId } as ShowRef, score: scoreCandidate(wanted, r) }))
      .sort(byScore);
    const best = tvdbHits[0]?.score ?? -Infinity;
    if (!this.tmdb || (limit === 1 && best >= CONFIDENT_SCORE)) return tvdbHits.slice(0, limit).map(h => h.ref);

    const tmdbHits = (await this.searchTmdb(title, year, ctx.language))
      .map(r => ({ ref: { source: 'tmdb', id: r.tmdbId } as ShowRef, score: scoreCandidate(wanted, r) }))
      .sort(byScore);
    if (limit === 1) {
      const top = tmdbHits[0];
      return top && top.score > best ? [await this.preferTvdb(top.ref.id, ctx)] : tvdbHits.slice(0, 1).map(h => h.ref);
    }
    // Manual search: both lists by score; the sort is stable, so TVDB comes first on ties.
    return [...tvdbHits, ...tmdbHits].sort(byScore).slice(0, limit).map(h => h.ref);
  }

  /** A TMDB show, or its TVDB entry when TMDB knows one (TVDB numbering matches Sonarr). */
  private async preferTvdb(tmdbId: string, ctx: TvContext): Promise<ShowRef> {
    const show = await this.tmdb?.show(tmdbId, ctx.language);
    return show?.tvdbId ? { source: 'tvdb', id: show.tvdbId } : { source: 'tmdb', id: tmdbId };
  }

  private async searchTvdb(title: string, year: number | undefined, lang: string): Promise<Array<TvdbSearchResult & Candidate>> {
    // TVDB's search often finds nothing for long titles with subtitles (e.g. "Winning Time: The Rise
    // of the Lakers Dynasty"), so fall back to the main title. Ranking still uses the full title.
    let results: TvdbSearchResult[] = [];
    for (const query of searchQueries(title)) {
      results = await this.tvdb.search(query, lang, year);
      if (results.length === 0 && year) results = await this.tvdb.search(query, lang);
      if (results.length > 0) break;
    }
    return results.map(r => ({ ...r, title: r.translatedName ?? r.name, originalTitle: r.name, alternateTitles: r.aliases }));
  }

  private async searchTmdb(title: string, year: number | undefined, language: string): Promise<Array<Candidate & { tmdbId: string }>> {
    if (!this.tmdb) return [];
    let results: Awaited<ReturnType<TmdbShows['search']>> = [];
    for (const query of searchQueries(title)) {
      results = await this.tmdb.search(query, language, year);
      if (results.length === 0 && year) results = await this.tmdb.search(query, language);
      if (results.length > 0) break;
    }
    return results.map(r => ({ tmdbId: r.tmdbId, title: r.name, originalTitle: r.originalName, year: r.year, popularity: r.popularity }));
  }

  // ---------- building responses ----------

  /**
   * A show with its episodes in one order: `order` (a TVDB season type, from a season key) wins,
   * else the request's episodeOrder, else aired. TMDB shows are always in aired order. An order the
   * show doesn't have yields no seasons, as the spec asks.
   */
  private async bundle(ref: ShowRef, ctx: TvContext, order?: string): Promise<Bundle | undefined> {
    let show: Show | undefined;
    let episodes: Episode[];
    let seasons: ShowSeason[];
    const type = ref.source === 'tmdb' ? 'official' : (order ?? seasonTypeFor(ctx.episodeOrder));
    if (ref.source === 'tmdb') {
      show = await this.tmdb?.show(ref.id, ctx.language);
      if (!show) return undefined;
      episodes = await this.tmdb!.episodes(show, ctx.language);
      seasons = show.seasons;
    } else {
      const lang = tvdbLanguage(ctx.language);
      show = await this.tvdb.show(ref.id, lang);
      if (!show) return undefined;
      seasons = type === 'official' ? show.seasons : (show.seasonsByType?.[type] ?? []);
      episodes = type === 'official' ? await this.tvdb.episodes(ref.id, lang) : seasons.length ? await this.tvdb.episodes(ref.id, lang, type) : [];
    }
    episodes.sort((a, b) => a.seasonNumber - b.seasonNumber || a.number - b.number);
    const withEpisodes = new Set(episodes.map(e => e.seasonNumber));
    return { source: ref.source, order: type, show, episodes, seasons: seasons.filter(s => withEpisodes.has(s.number)) };
  }

  private async showMeta(b: Bundle, ctx: TvContext): Promise<ProviderMetadata> {
    const { show } = b;
    const ratingKey = showKey(b.source, show.id);
    const externalIds = (
      b.source === 'tvdb'
        ? [`tvdb://${show.id}`, show.imdbId && `imdb://${show.imdbId}`, show.tmdbId && `tmdb://${show.tmdbId}`]
        : [`tmdb://${show.id}`, show.imdbId && `imdb://${show.imdbId}`, show.tvdbId && `tvdb://${show.tvdbId}`]
    ).filter((x): x is string => Boolean(x));
    const summary = await this.summary('show', show.title, cleanSummary(show.overview), externalIds, ctx, [b.source]);
    return compact({
      ratingKey,
      key: `${metadataKey(ratingKey)}/children`,
      guid: guidFor('show', ratingKey),
      type: 'show' as const,
      title: show.title,
      originalTitle: show.originalTitle !== show.title ? show.originalTitle : undefined,
      originallyAvailableAt: show.firstAired ?? b.episodes.find(e => e.aired)?.aired,
      year: show.year ?? yearOf(show.firstAired),
      summary,
      Guid: externalIds.map(id => ({ id })),
      SeasonType: b.source === 'tvdb' ? seasonTypes(show) : undefined,
    });
  }

  private async seasonMeta(b: Bundle, season: ShowSeason, ctx: TvContext): Promise<ProviderMetadata> {
    const { show } = b;
    const ratingKey = seasonKey(b, season.number);
    const showRatingKey = showKey(b.source, show.id);
    const first = b.episodes.find(e => e.seasonNumber === season.number && e.aired)?.aired;
    // TMDB returns season overviews with the show. TVDB only lists the ones it has; skip the
    // lookup otherwise (most seasons have none).
    const summary =
      b.source === 'tmdb'
        ? cleanSummary(season.overview)
        : season.hasOverview
          ? await this.summary('season', show.title, undefined, [`tvdb://${season.id}`], ctx)
          : undefined;
    return compact({
      ratingKey,
      key: `${metadataKey(ratingKey)}/children`,
      guid: guidFor('season', ratingKey),
      type: 'season' as const,
      title: seasonTitle(season.number),
      index: season.number,
      originallyAvailableAt: first,
      year: yearOf(first),
      summary,
      parentRatingKey: showRatingKey,
      parentKey: metadataKey(showRatingKey),
      parentGuid: guidFor('show', showRatingKey),
      parentTitle: show.title,
      Guid: [{ id: `${b.source}://${season.id}` }],
    });
  }

  private episodesMeta(b: Bundle, episodes: Episode[], ctx: TvContext): Promise<ProviderMetadata[]> {
    return Promise.all(episodes.map(e => this.episodeMeta(b, e, ctx)));
  }

  private async episodeMeta(b: Bundle, e: Episode, ctx: TvContext): Promise<ProviderMetadata> {
    const { show } = b;
    const ratingKey = episodeKey(b, e);
    const sKey = seasonKey(b, e.seasonNumber);
    const showRatingKey = showKey(b.source, show.id);
    const summary = await this.summary('episode', show.title, cleanSummary(e.overview), [`${b.source}://${e.id}`], ctx, [b.source]);
    return compact({
      ratingKey,
      key: metadataKey(ratingKey),
      guid: guidFor('episode', ratingKey),
      type: 'episode' as const,
      title: e.name || `Episode ${e.number}`,
      index: e.number,
      parentIndex: e.seasonNumber,
      originallyAvailableAt: e.aired,
      year: yearOf(e.aired),
      summary,
      parentRatingKey: sKey,
      parentKey: metadataKey(sKey),
      parentGuid: guidFor('season', sKey),
      parentTitle: seasonTitle(e.seasonNumber),
      grandparentRatingKey: showRatingKey,
      grandparentKey: metadataKey(showRatingKey),
      grandparentGuid: guidFor('show', showRatingKey),
      grandparentTitle: show.title,
      Guid: [{ id: `${b.source}://${e.id}` }],
    });
  }

  /**
   * The TVDB text we already have wins; otherwise ask the remaining sources in order
   * (`skip` lists sources already consulted).
   */
  private async summary(
    type: 'show' | 'season' | 'episode',
    title: string,
    known: string | undefined,
    externalIds: string[],
    ctx: TvContext,
    skip: SourceName[] = []
  ): Promise<string | undefined> {
    if (known) return known;
    const sources = new Map([...this.sourcesFor(ctx.language)].filter(([name]) => !skip.includes(name)));
    const { winner } = await resolveSummary(sources, { type, title, externalIds });
    return winner?.summary;
  }
}
