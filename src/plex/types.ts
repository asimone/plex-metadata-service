/**
 * Plex Media Server types used by the summary sync.
 * Only the fields we read are modelled; Plex returns many more.
 */

/** Plex metadata type numbers used in library queries. */
export const PlexType = {
  movie: 1,
  show: 2,
  season: 3,
  episode: 4,
} as const;

export type PlexItemType = keyof typeof PlexType;

/** Which item types each library type contains, in sync order. */
export const ITEM_TYPES_BY_LIBRARY: Record<string, PlexItemType[]> = {
  movie: ['movie'],
  show: ['show', 'season', 'episode'],
};

export interface PlexSection {
  key: string;
  title: string;
  /** Library type as Plex reports it: "movie", "show", "artist", "photo". */
  type: string;
  /** The library's metadata agent, e.g. "tv.plex.agents.movie". */
  agent?: string;
}

export interface PlexItem {
  ratingKey: string;
  type: PlexItemType;
  title: string;
  year?: number;
  summary: string;
  /** True when the summary field is locked in Plex (manual edit or a previous sync). */
  summaryLocked: boolean;
  /** Plex's own GUID, e.g. "plex://movie/5d776…". */
  plexGuid?: string;
  /** External IDs from the item's Guid array, e.g. ["imdb://tt0088763", "tmdb://105"]. */
  externalIds: string[];
  parentRatingKey?: string;
  parentTitle?: string;
  grandparentRatingKey?: string;
  grandparentTitle?: string;
  /** Season number for seasons, episode number for episodes. */
  index?: number;
  /** Season number for episodes. */
  parentIndex?: number;
}

/** Raw shapes from Plex's JSON responses. */
export interface RawDirectory {
  key: string;
  title: string;
  type: string;
  agent?: string;
}

export interface RawMetadata {
  ratingKey: string;
  type: string;
  title?: string;
  year?: number;
  summary?: string;
  guid?: string;
  Guid?: Array<{ id: string }>;
  Field?: Array<{ name: string; locked?: boolean | number }>;
  parentRatingKey?: string;
  parentTitle?: string;
  grandparentRatingKey?: string;
  grandparentTitle?: string;
  index?: number;
  parentIndex?: number;
}

export interface RawMediaContainer<T> {
  MediaContainer: {
    size?: number;
    totalSize?: number;
    offset?: number;
    Directory?: T[];
    Metadata?: T[];
  };
}
