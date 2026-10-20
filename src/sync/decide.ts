/**
 * Decides what to do with one item. Pure: no I/O.
 */

import { PlexItem } from '../plex/types';
import { ItemRecord } from '../store/Store';
import { sameSummary } from '../text/cleanSummary';

export interface Winner {
  source: string;
  summary: string;
  externalId: string;
}

export type Action =
  /** Write our summary and lock it. */
  | 'write'
  /** Plex already has the same text; just lock it so refreshes can't replace it. */
  | 'lock'
  /** Already ours and locked. */
  | 'unchanged'
  /** A person edited the summary in Plex; never touch it. */
  | 'user-owned'
  /** No source had a summary; leave Plex's. */
  | 'no-source';

export interface Decision {
  action: Action;
  /** True when Plex's GUID changed since we wrote (e.g. Fix Match), so the old record is stale. */
  rematched: boolean;
}

export function decide(item: PlexItem, record: ItemRecord | undefined, winner: Winner | undefined): Decision {
  const rematched = record !== undefined && record.plexGuid !== (item.plexGuid ?? '');

  if (record?.status === 'user-owned' && !rematched) {
    return { action: 'user-owned', rematched };
  }

  if (item.summaryLocked) {
    // A locked summary is ours only if it's exactly what we last wrote.
    const ours = record !== undefined && record.status === 'synced' && sameSummary(item.summary, record.writtenSummary);
    if (!ours) {
      return { action: 'user-owned', rematched };
    }
  }

  if (!winner) {
    return { action: 'no-source', rematched };
  }

  if (sameSummary(winner.summary, item.summary)) {
    return { action: item.summaryLocked ? 'unchanged' : 'lock', rematched };
  }

  return { action: 'write', rematched };
}
