/**
 * Shared pieces for the Plex metadata providers (spec: docs/MediaProvider.md, docs/Metadata.md).
 */

import { Request } from 'express';

export type MetadataTypeName = 'movie' | 'show' | 'season' | 'episode';

export const METADATA_TYPE_NUMBER: Record<MetadataTypeName, number> = {
  movie: 1,
  show: 2,
  season: 3,
  episode: 4,
};

/** A Metadata object as returned to Plex. Only fields we set are modelled. */
export interface ProviderMetadata {
  ratingKey: string;
  key: string;
  guid: string;
  type: MetadataTypeName;
  title: string;
  originallyAvailableAt?: string;
  year?: number;
  summary?: string;
  thumb?: string;
  originalTitle?: string;
  index?: number;
  parentRatingKey?: string;
  parentKey?: string;
  parentGuid?: string;
  parentTitle?: string;
  parentIndex?: number;
  grandparentRatingKey?: string;
  grandparentKey?: string;
  grandparentGuid?: string;
  grandparentTitle?: string;
  Guid?: Array<{ id: string }>;
  /** Episode orderings a TV show offers (Plex's "Episode ordering" setting). */
  SeasonType?: Array<{ id: string; source: string; tag: string; title: string }>;
  Children?: { size: number; Metadata: ProviderMetadata[] };
}

export interface MediaContainer {
  MediaContainer: {
    offset: number;
    totalSize: number;
    identifier: string;
    size: number;
    Metadata: ProviderMetadata[];
  };
}

const RATING_KEY = /^[a-zA-Z0-9_-]+$/;

export function isValidRatingKey(ratingKey: string): boolean {
  return RATING_KEY.test(ratingKey);
}

export function buildGuid(identifier: string, type: MetadataTypeName, ratingKey: string): string {
  if (!isValidRatingKey(ratingKey)) {
    throw new Error(`Invalid ratingKey "${ratingKey}"`);
  }
  return `${identifier}://${type}/${ratingKey}`;
}

export function metadataKey(ratingKey: string): string {
  return `/library/metadata/${ratingKey}`;
}

export function container(identifier: string, items: ProviderMetadata[], totalSize = items.length, offset = 0): MediaContainer {
  return { MediaContainer: { offset, totalSize, identifier, size: items.length, Metadata: items } };
}

/** Builds a provider definition (GET /<base>). */
export function providerDefinition(identifier: string, title: string, version: string, types: MetadataTypeName[]) {
  return {
    MediaProvider: {
      identifier,
      title,
      version,
      Types: types.map(t => ({ type: METADATA_TYPE_NUMBER[t], Scheme: [{ scheme: identifier }] })),
      Feature: [
        { type: 'metadata', key: '/library/metadata' },
        { type: 'match', key: '/library/metadata/matches' },
      ],
    },
  };
}

/** Reads a Plex header that may also arrive as a query parameter (e.g. X-Plex-Language). */
export function plexParam(req: Request, name: string): string | undefined {
  const header = req.headers[name.toLowerCase()];
  if (typeof header === 'string' && header) return header;
  const query = req.query[name];
  return typeof query === 'string' && query ? query : undefined;
}

/** True for 1 / "1" / true. */
export function flag(value: unknown): boolean {
  return value === 1 || value === '1' || value === true || value === 'true';
}

/** Removes undefined fields so responses never carry empty keys. */
export function compact<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== '')) as T;
}

export function yearOf(date: string | undefined): number | undefined {
  const year = date ? parseInt(date.slice(0, 4), 10) : NaN;
  return Number.isFinite(year) ? year : undefined;
}
