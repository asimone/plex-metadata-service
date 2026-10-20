/**
 * Read-only Plex Media Server client.
 * Lists libraries and pages through their items with external IDs (includeGuids=1).
 */

import axios, { AxiosError, AxiosInstance } from 'axios';
import logger from '../utils/logger';
import {
  PlexItem,
  PlexItemType,
  PlexSection,
  PlexType,
  RawDirectory,
  RawMediaContainer,
  RawMetadata,
} from './types';

export interface PlexClientOptions {
  url: string;
  token: string;
  /** Items per page when listing a library. */
  pageSize?: number;
  timeoutMs?: number;
}

export class PlexError extends Error {}

export class PlexClient {
  private client: AxiosInstance;
  private pageSize: number;

  constructor(options: PlexClientOptions) {
    this.pageSize = options.pageSize ?? 200;
    this.client = axios.create({
      baseURL: options.url,
      timeout: options.timeoutMs ?? 15000,
      headers: {
        Accept: 'application/json',
        'X-Plex-Token': options.token,
        'X-Plex-Product': 'plex-summary-sync',
        'X-Plex-Client-Identifier': 'plex-summary-sync',
      },
    });
  }

  /** Lists every library section on the server. */
  async getSections(): Promise<PlexSection[]> {
    const data = await this.get<RawMediaContainer<RawDirectory>>('/library/sections');
    return (data.MediaContainer.Directory ?? []).map(d => ({
      key: String(d.key),
      title: d.title,
      type: d.type,
      agent: d.agent,
    }));
  }

  /**
   * Yields every item of one type in a section, one page at a time.
   */
  async *listItems(sectionKey: string, type: PlexItemType): AsyncGenerator<PlexItem> {
    let start = 0;
    for (;;) {
      const data = await this.get<RawMediaContainer<RawMetadata>>(
        `/library/sections/${encodeURIComponent(sectionKey)}/all`,
        {
          type: PlexType[type],
          includeGuids: 1,
          'X-Plex-Container-Start': start,
          'X-Plex-Container-Size': this.pageSize,
        }
      );
      const page = data.MediaContainer.Metadata ?? [];
      for (const raw of page) {
        yield toPlexItem(raw, type);
      }

      start += page.length;
      const total = data.MediaContainer.totalSize;
      if (page.length === 0 || (total !== undefined && start >= total) || (total === undefined && page.length < this.pageSize)) {
        return;
      }
    }
  }

  private async get<T>(url: string, params?: Record<string, string | number>): Promise<T> {
    try {
      logger.debug(`Plex GET ${url}`, params ? { params } : undefined);
      const response = await this.client.get<T>(url, { params });
      return response.data;
    } catch (error) {
      throw toPlexError(error, url);
    }
  }
}

/** Maps a raw Plex metadata entry to a PlexItem. */
export function toPlexItem(raw: RawMetadata, fallbackType: PlexItemType): PlexItem {
  const type = (raw.type in PlexType ? raw.type : fallbackType) as PlexItemType;
  const summaryLocked = (raw.Field ?? []).some(f => f.name === 'summary' && Boolean(f.locked));

  return {
    ratingKey: String(raw.ratingKey),
    type,
    title: raw.title ?? '',
    year: raw.year,
    summary: raw.summary ?? '',
    summaryLocked,
    plexGuid: raw.guid,
    externalIds: (raw.Guid ?? []).map(g => g.id).filter(Boolean),
    parentRatingKey: raw.parentRatingKey,
    parentTitle: raw.parentTitle,
    grandparentRatingKey: raw.grandparentRatingKey,
    grandparentTitle: raw.grandparentTitle,
    index: raw.index,
    parentIndex: raw.parentIndex,
  };
}

function toPlexError(error: unknown, url: string): PlexError {
  if (axios.isAxiosError(error)) {
    const err = error as AxiosError;
    const status = err.response?.status;
    if (status === 401) {
      return new PlexError('Plex rejected the token (401). Check PLEX_TOKEN.');
    }
    if (status) {
      return new PlexError(`Plex returned ${status} for ${url}`);
    }
    return new PlexError(`Could not reach Plex at ${err.config?.baseURL ?? 'PLEX_URL'}: ${err.code ?? err.message}`);
  }
  return new PlexError(`Plex request failed for ${url}: ${String(error)}`);
}
