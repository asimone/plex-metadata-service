/**
 * Resolves summaries for Plex items and (optionally) writes them back, locked.
 */

import { PlexClient } from '../plex/PlexClient';
import { ITEM_TYPES_BY_LIBRARY, PlexItem, PlexItemType, PlexSection } from '../plex/types';
import { SourceLookup, SourceName, SummarySource } from '../sources/SummarySource';
import { Resolution, SOURCE_ORDER, Winner, resolveSummary } from '../sources/resolve';
import { ItemRecord, Store } from '../store/Store';
import logger from '../utils/logger';
import { Action, Decision, decide } from './decide';


export interface Outcome extends Decision {
  item: PlexItem;
  sectionKey: string;
  winner?: Winner;
  /** Why no source had a summary, e.g. "tmdb: not-found; omdb: no-id". */
  detail?: string;
  /** True if the write was actually sent to Plex. */
  written: boolean;
  error?: string;
}

export interface SyncOptions {
  write: boolean;
  /** Minimum gap between writes to Plex. */
  writeIntervalMs?: number;
  /** Items resolved in parallel (source lookups). Writes stay spaced by writeIntervalMs. */
  concurrency?: number;
  onOutcome?: (outcome: Outcome) => void;
}

export type SyncCounts = Record<Action | 'errors', number>;

export class SummarySync {
  private sources: Map<SourceName, SummarySource>;
  private lastWriteAt = 0;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly plex: PlexClient,
    private readonly store: Store,
    sources: SummarySource[],
    private readonly sleep: (ms: number) => Promise<void> = ms => new Promise(r => setTimeout(r, ms))
  ) {
    this.sources = new Map(sources.map(s => [s.name, s]));
  }

  /** Item types this sync can currently handle (those with at least one configured source). */
  supportedTypes(): PlexItemType[] {
    return (Object.keys(SOURCE_ORDER) as PlexItemType[]).filter(t => SOURCE_ORDER[t].some(s => this.sources.has(s)));
  }

  /** Asks each configured source in priority order; the first summary wins. */
  resolve(item: PlexItem, all = false): Promise<Resolution> {
    return resolveSummary(this.sources, item, all);
  }

  /** Syncs every supported item in the given libraries. */
  async syncSections(sections: PlexSection[], options: SyncOptions): Promise<SyncCounts> {
    const counts = emptyCounts();
    const supported = this.supportedTypes();
    for (const section of sections) {
      const types = (ITEM_TYPES_BY_LIBRARY[section.type] ?? []).filter(t => supported.includes(t));
      if (types.length === 0) {
        logger.info(`${section.title}: no sources configured for ${section.type} libraries yet; skipping`);
        continue;
      }
      for (const type of types) {
        await forEachConcurrent(this.plex.listItems(section.key, type), options.concurrency ?? 1, async item => {
          tally(counts, await this.syncItem(item, section.key, options));
        });
      }
    }
    return counts;
  }

  /** Syncs one item. Writes only when options.write is true. */
  async syncItem(item: PlexItem, sectionKey: string, options: SyncOptions): Promise<Outcome> {
    let outcome: Outcome;
    try {
      const record = this.store.getItem(item.ratingKey);
      const { winner, lookups } = await this.resolve(item);
      const decision = decide(item, record, winner);
      outcome = { ...decision, item, sectionKey, winner, written: false };
      if (decision.action === 'no-source') {
        outcome.detail = lookups.map(l => `${l.source}: ${describeLookup(l.lookup)}`).join('; ') || 'no sources';
      }

      if (options.write) {
        if ((decision.action === 'write' || decision.action === 'lock') && winner) {
          await this.throttle(options.writeIntervalMs ?? 0);
          await this.plex.setSummary(sectionKey, item, winner.summary, true);
          this.store.saveItem(this.recordFor(item, sectionKey, record, decision, winner));
          outcome.written = true;
          logger.info(`Wrote summary: ${item.title} (${winner.source}, ${winner.externalId})`);
        } else if (decision.action === 'user-owned' && record?.status !== 'user-owned') {
          this.store.saveItem(this.userOwnedRecord(item, sectionKey, record));
          logger.warn(`Leaving ${item.title} alone: its summary was edited in Plex`);
        }
      }
    } catch (error) {
      outcome = {
        action: 'no-source',
        rematched: false,
        item,
        sectionKey,
        written: false,
        error: error instanceof Error ? error.message : String(error),
      };
      logger.error(`${item.title}: ${outcome.error}`);
    }
    options.onOutcome?.(outcome);
    return outcome;
  }

  /**
   * Puts back Plex's original summary and lock state, and forgets the item.
   * Returns false if we have no record for it.
   */
  async restore(ratingKey: string): Promise<boolean> {
    const record = this.store.getItem(ratingKey);
    if (!record) return false;
    if (record.status === 'synced') {
      await this.plex.setSummary(
        record.sectionKey,
        { ratingKey, type: record.type as PlexItemType },
        record.originalSummary,
        record.originalLocked
      );
      logger.info(`Restored original summary: ${record.title}`);
    }
    this.store.deleteItem(ratingKey);
    return true;
  }

  private recordFor(
    item: PlexItem,
    sectionKey: string,
    previous: ItemRecord | undefined,
    decision: Decision,
    winner: Winner
  ): ItemRecord {
    // Keep the first backup across rewrites and rematches; Plex's text after our write is ours, not the original.
    const keepOriginal = previous !== undefined && previous.status === 'synced';
    return {
      ratingKey: item.ratingKey,
      sectionKey,
      type: item.type,
      title: item.title,
      plexGuid: item.plexGuid ?? '',
      externalId: winner.externalId,
      source: winner.source,
      writtenSummary: winner.summary,
      writtenAt: new Date().toISOString(),
      originalSummary: keepOriginal ? previous.originalSummary : item.summary,
      originalLocked: keepOriginal ? previous.originalLocked : item.summaryLocked && !decision.rematched,
      status: 'synced',
    };
  }

  private userOwnedRecord(item: PlexItem, sectionKey: string, previous: ItemRecord | undefined): ItemRecord {
    return {
      ratingKey: item.ratingKey,
      sectionKey,
      type: item.type,
      title: item.title,
      plexGuid: item.plexGuid ?? '',
      externalId: previous?.externalId ?? '',
      source: previous?.source ?? '',
      writtenSummary: '',
      writtenAt: new Date().toISOString(),
      originalSummary: previous?.originalSummary ?? item.summary,
      originalLocked: previous?.originalLocked ?? item.summaryLocked,
      status: 'user-owned',
    };
  }

  /** Spaces writes out; callers queue up so concurrent lookups still write one at a time. */
  private throttle(intervalMs: number): Promise<void> {
    const turn = this.writeQueue.then(async () => {
      const wait = this.lastWriteAt + intervalMs - Date.now();
      if (wait > 0) await this.sleep(wait);
      this.lastWriteAt = Date.now();
    });
    this.writeQueue = turn.catch(() => undefined);
    return turn;
  }
}

export function describeLookup(lookup: SourceLookup): string {
  switch (lookup.status) {
    case 'found':
      return `found (${lookup.externalId})`;
    case 'not-found':
      return `no summary (${lookup.externalId})`;
    case 'no-id':
      return 'no usable ID';
    case 'unavailable':
      return lookup.reason;
  }
}

/** Runs fn over an async iterable with at most `limit` calls in flight. */
export async function forEachConcurrent<T>(items: AsyncIterable<T>, limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  const running = new Set<Promise<void>>();
  for await (const item of items) {
    const task: Promise<void> = fn(item).finally(() => running.delete(task));
    running.add(task);
    if (running.size >= Math.max(1, limit)) {
      await Promise.race(running);
    }
  }
  await Promise.all(running);
}

export function emptyCounts(): SyncCounts {
  return { write: 0, lock: 0, unchanged: 0, 'user-owned': 0, 'no-source': 0, errors: 0 };
}

export function tally(counts: SyncCounts, outcome: Outcome): void {
  if (outcome.error) counts.errors++;
  else counts[outcome.action]++;
}
