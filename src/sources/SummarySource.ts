/**
 * A source of summary text, looked up by an item's external IDs only.
 */

export type SourceName = 'tmdb' | 'omdb' | 'tvdb';

export type ItemType = 'movie' | 'show' | 'season' | 'episode';

/** What a source needs to look an item up. */
export interface LookupItem {
  type: ItemType;
  title: string;
  /** External IDs, e.g. ["imdb://tt0088763", "tmdb://105"]. */
  externalIds: string[];
}

export type SourceLookup =
  /** The source has a usable summary (already cleaned). */
  | { status: 'found'; summary: string; externalId: string }
  /** The source knows the item but has no summary, or doesn't know the ID. */
  | { status: 'not-found'; externalId: string }
  /** The item has no ID this source can use. */
  | { status: 'no-id' }
  /** The source failed, is disabled, or is over budget. */
  | { status: 'unavailable'; reason: string };

export interface SummarySource {
  readonly name: SourceName;
  getSummary(item: LookupItem): Promise<SourceLookup>;
}

/** Returns the first external ID with the given scheme, without the scheme ("tmdb://105" → "105"). */
export function externalId(item: LookupItem, scheme: string): string | undefined {
  const prefix = `${scheme}://`;
  const id = item.externalIds.find(x => x.startsWith(prefix));
  return id ? id.slice(prefix.length) : undefined;
}

export const DAY_MS = 24 * 60 * 60 * 1000;
