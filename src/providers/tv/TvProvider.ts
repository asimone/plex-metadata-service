/**
 * The TV metadata provider: shows, seasons and episodes (types 2, 3, 4), backed by TVDB in
 * aired order. Returns identity, titles, numbering, dates, external IDs and summaries;
 * Plex Series fills artwork, cast, ratings and the rest.
 */

import { SourceName, SummarySource } from '../../sources/SummarySource';
import { resolveSummary } from '../../sources/resolve';
import { tvdbLanguage } from '../../sources/tvdb/TvdbSource';
import { cleanSummary } from '../../text/cleanSummary';
import logger from '../../utils/logger';
import { MetadataTypeName, ProviderMetadata, buildGuid, compact, metadataKey, yearOf } from '../common';
import { idHints, rank, yearFromFilename } from '../match';
import { Episode, Show, ShowSeason, TvdbSearchResult, TvdbShows } from './TvdbShows';

export const TV_IDENTIFIER = 'tv.plex.agents.custom.simone.tv';
export const TV_TITLE = 'TVDB TV Shows';

export interface TvContext {
  /** Plex's language tag, e.g. "en-US". */
  language: string;
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

type Parsed =
  | { type: 'show'; showId: string }
  | { type: 'season'; showId: string; season: number }
  | { type: 'episode'; episodeId: string };

export function parseTvRatingKey(ratingKey: string): Parsed | undefined {
  let m = /^tvdb-show-(\d+)$/.exec(ratingKey);
  if (m) return { type: 'show', showId: m[1] };
  m = /^tvdb-season-(\d+)-(\d+)$/.exec(ratingKey);
  if (m) return { type: 'season', showId: m[1], season: parseInt(m[2], 10) };
  m = /^tvdb-episode-(\d+)$/.exec(ratingKey);
  if (m) return { type: 'episode', episodeId: m[1] };
  return undefined;
}

const showKey = (id: number | string) => `tvdb-show-${id}`;
const seasonKey = (showId: number | string, n: number) => `tvdb-season-${showId}-${n}`;
const episodeKey = (id: number | string) => `tvdb-episode-${id}`;
const guidFor = (type: MetadataTypeName, ratingKey: string) => buildGuid(TV_IDENTIFIER, type, ratingKey);
const seasonTitle = (n: number) => (n === 0 ? 'Specials' : `Season ${n}`);

/** A show with its episodes loaded, the unit every TV response is built from. */
interface Bundle {
  show: Show;
  episodes: Episode[];
  /** Seasons that actually have episodes, in order. */
  seasons: ShowSeason[];
}

export class TvProvider {
  constructor(
    private readonly tvdb: TvdbShows,
    /** Summary fallbacks (TMDB) and the TVDB season source, per Plex language. */
    private readonly sourcesFor: (language: string) => Map<SourceName, SummarySource>
  ) {}

  // ---------- metadata ----------

  async metadata(ratingKey: string, ctx: TvContext, includeChildren = false): Promise<ProviderMetadata | undefined> {
    const parsed = parseTvRatingKey(ratingKey);
    if (!parsed) return undefined;

    if (parsed.type === 'episode') {
      const showId = await this.tvdb.seriesIdForEpisode(parsed.episodeId);
      const bundle = showId ? await this.bundle(showId, ctx) : undefined;
      const episode = bundle?.episodes.find(e => String(e.id) === parsed.episodeId);
      return bundle && episode ? this.episodeMeta(bundle, episode, ctx) : undefined;
    }

    const bundle = await this.bundle(parsed.showId, ctx);
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
    const bundle = await this.bundle(parsed.showId, ctx);
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
    const bundle = await this.bundle(parsed.showId, ctx);
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
    const lang = tvdbLanguage(ctx.language);

    const candidates = await this.findShows(showTitle, year, req.guid, req.filename, lang, limit);
    logger.info(`tv match (type ${req.type}): ${showTitle ?? '?'} ${year ? `(${year}) ` : ''}→ ${candidates.map(c => `tvdb ${c}`).join(', ') || 'no match'}`);
    if (candidates.length === 0) return [];

    if (req.type === 2) {
      if (candidates.length === 1) {
        const meta = await this.metadata(showKey(candidates[0]), ctx, req.includeChildren);
        return meta ? [meta] : [];
      }
      // Manual search: one show record per candidate, no children.
      const metas = await Promise.all(candidates.map(id => this.metadata(showKey(id), ctx)));
      return metas.filter((m): m is ProviderMetadata => Boolean(m));
    }

    const bundle = await this.bundle(candidates[0], ctx);
    if (!bundle) return [];

    if (req.type === 3) {
      const season = bundle.seasons.find(s => s.number === req.index);
      if (!season) return [];
      const meta = await this.metadata(seasonKey(bundle.show.id, season.number), ctx, req.includeChildren);
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

  /** TVDB series IDs for a show, best first: ID hints (guid / filename tags), then title search. */
  private async findShows(title: string | undefined, year: number | undefined, guid: string | undefined, filename: string | undefined, lang: string, limit: number): Promise<string[]> {
    const hints = idHints(guid, filename);
    if (hints.tvdb) return [hints.tvdb];
    if (hints.imdb) {
      const id = await this.tvdb.seriesIdForImdb(hints.imdb);
      if (id) return [id];
    }
    if (!title) return [];

    let results = await this.tvdb.search(title, lang, year);
    if (results.length === 0 && year) results = await this.tvdb.search(title, lang);
    const ranked = rank(
      { title, year },
      results.map((r: TvdbSearchResult) => ({ ...r, title: r.translatedName ?? r.name, originalTitle: r.name, alternateTitles: r.aliases }))
    );
    return ranked.slice(0, limit).map(r => r.tvdbId);
  }

  // ---------- building responses ----------

  private async bundle(showId: string, ctx: TvContext): Promise<Bundle | undefined> {
    const lang = tvdbLanguage(ctx.language);
    const show = await this.tvdb.show(showId, lang);
    if (!show) return undefined;
    const episodes = (await this.tvdb.episodes(showId, lang)).sort((a, b) => a.seasonNumber - b.seasonNumber || a.number - b.number);
    const withEpisodes = new Set(episodes.map(e => e.seasonNumber));
    return { show, episodes, seasons: show.seasons.filter(s => withEpisodes.has(s.number)) };
  }

  private async showMeta(b: Bundle, ctx: TvContext): Promise<ProviderMetadata> {
    const { show } = b;
    const ratingKey = showKey(show.id);
    const externalIds = [`tvdb://${show.id}`, show.imdbId && `imdb://${show.imdbId}`, show.tmdbId && `tmdb://${show.tmdbId}`].filter(
      (x): x is string => Boolean(x)
    );
    const summary = await this.summary('show', show.title, cleanSummary(show.overview), externalIds, ctx, ['tvdb']);
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
    });
  }

  private async seasonMeta(b: Bundle, season: ShowSeason, ctx: TvContext): Promise<ProviderMetadata> {
    const { show } = b;
    const ratingKey = seasonKey(show.id, season.number);
    const first = b.episodes.find(e => e.seasonNumber === season.number && e.aired)?.aired;
    // TVDB only lists season overviews it has; skip the lookup otherwise (most seasons have none).
    const summary = season.hasOverview
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
      parentRatingKey: showKey(show.id),
      parentKey: metadataKey(showKey(show.id)),
      parentGuid: guidFor('show', showKey(show.id)),
      parentTitle: show.title,
      Guid: [{ id: `tvdb://${season.id}` }],
    });
  }

  private episodesMeta(b: Bundle, episodes: Episode[], ctx: TvContext): Promise<ProviderMetadata[]> {
    return Promise.all(episodes.map(e => this.episodeMeta(b, e, ctx)));
  }

  private async episodeMeta(b: Bundle, e: Episode, ctx: TvContext): Promise<ProviderMetadata> {
    const { show } = b;
    const ratingKey = episodeKey(e.id);
    const sKey = seasonKey(show.id, e.seasonNumber);
    const summary = await this.summary('episode', show.title, cleanSummary(e.overview), [`tvdb://${e.id}`], ctx, ['tvdb']);
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
      grandparentRatingKey: showKey(show.id),
      grandparentKey: metadataKey(showKey(show.id)),
      grandparentGuid: guidFor('show', showKey(show.id)),
      grandparentTitle: show.title,
      Guid: [{ id: `tvdb://${e.id}` }],
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
