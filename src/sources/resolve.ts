/**
 * Summary resolution for the providers: ask each source in priority order; the first summary wins.
 */

import logger from '../utils/logger';
import { ItemType, LookupItem, SourceLookup, SourceName, SummarySource } from './SummarySource';

/** Source priority per item type. */
export const SOURCE_ORDER: Record<ItemType, SourceName[]> = {
  movie: ['tmdb', 'omdb'],
  show: ['tvdb', 'tmdb'],
  season: ['tvdb', 'tmdb'],
  episode: ['tvdb', 'tmdb'],
};

export interface Winner {
  source: string;
  summary: string;
  externalId: string;
}

export interface Resolution {
  winner?: Winner;
  lookups: Array<{ source: SourceName; lookup: SourceLookup }>;
}

export async function resolveSummary(
  sources: Map<SourceName, SummarySource>,
  item: LookupItem,
  all = false
): Promise<Resolution> {
  const resolution: Resolution = { lookups: [] };
  for (const name of SOURCE_ORDER[item.type]) {
    const source = sources.get(name);
    if (!source) continue;
    const lookup = await source.getSummary(item);
    resolution.lookups.push({ source: name, lookup });
    if (lookup.status === 'unavailable') {
      logger.warn(`${item.title}: ${lookup.reason}`);
    }
    if (lookup.status === 'found' && !resolution.winner) {
      resolution.winner = { source: name, summary: lookup.summary, externalId: lookup.externalId };
      if (!all) break;
    }
  }
  return resolution;
}
