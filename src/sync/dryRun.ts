/**
 * Dry-run listing: walks the selected libraries and reports each item's external IDs.
 * Read-only; contacts Plex only.
 */

import { PlexClient } from '../plex/PlexClient';
import { ITEM_TYPES_BY_LIBRARY, PlexItem, PlexItemType, PlexSection } from '../plex/types';

/** External ID schemes we can look summaries up by. */
export const ID_SCHEMES = ['tvdb', 'tmdb', 'imdb'] as const;
export type IdScheme = (typeof ID_SCHEMES)[number];

export interface TypeStats {
  total: number;
  /** Items carrying at least one ID of each scheme. */
  withId: Record<IdScheme, number>;
  /** Items with none of the schemes above. */
  noUsableId: number;
  summaryLocked: number;
  emptySummary: number;
}

export interface LibraryReport {
  section: PlexSection;
  types: Partial<Record<PlexItemType, TypeStats>>;
}

export interface DryRunOptions {
  /** Called once per item; omit to only collect counts. */
  onItem?: (item: PlexItem, section: PlexSection) => void;
}

export async function runDryRun(
  client: PlexClient,
  sections: PlexSection[],
  options: DryRunOptions = {}
): Promise<LibraryReport[]> {
  const reports: LibraryReport[] = [];

  for (const section of sections) {
    const report: LibraryReport = { section, types: {} };
    for (const type of ITEM_TYPES_BY_LIBRARY[section.type] ?? []) {
      const stats = emptyStats();
      for await (const item of client.listItems(section.key, type)) {
        addToStats(stats, item);
        options.onItem?.(item, section);
      }
      report.types[type] = stats;
    }
    reports.push(report);
  }

  return reports;
}

/** Returns the scheme of an external ID ("tmdb://105" → "tmdb"), or undefined for unknown schemes. */
export function idScheme(id: string): IdScheme | undefined {
  const scheme = id.split('://')[0];
  return (ID_SCHEMES as readonly string[]).includes(scheme) ? (scheme as IdScheme) : undefined;
}

function emptyStats(): TypeStats {
  return {
    total: 0,
    withId: { tvdb: 0, tmdb: 0, imdb: 0 },
    noUsableId: 0,
    summaryLocked: 0,
    emptySummary: 0,
  };
}

function addToStats(stats: TypeStats, item: PlexItem): void {
  stats.total++;
  const schemes = new Set(item.externalIds.map(idScheme).filter((s): s is IdScheme => s !== undefined));
  for (const scheme of schemes) {
    stats.withId[scheme]++;
  }
  if (schemes.size === 0) stats.noUsableId++;
  if (item.summaryLocked) stats.summaryLocked++;
  if (!item.summary.trim()) stats.emptySummary++;
}

/** One line per item for the listing, e.g. "episode  1234  Breaking Bad S01E02 ...  tvdb://349232 imdb://tt...". */
export function formatItem(item: PlexItem): string {
  const ids = item.externalIds.length ? item.externalIds.join(' ') : '(no external IDs)';
  const flags = [item.summaryLocked ? 'locked' : '', item.summary.trim() ? '' : 'no-summary'].filter(Boolean);
  const flagText = flags.length ? `  [${flags.join(', ')}]` : '';
  return `${item.type.padEnd(7)}  ${item.ratingKey.padStart(7)}  ${displayTitle(item)}  ${ids}${flagText}`;
}

export function displayTitle(item: PlexItem): string {
  switch (item.type) {
    case 'movie':
    case 'show':
      return item.year ? `${item.title} (${item.year})` : item.title;
    case 'season':
      return `${item.parentTitle ?? '?'} / ${item.title}`;
    case 'episode': {
      const s = String(item.parentIndex ?? 0).padStart(2, '0');
      const e = String(item.index ?? 0).padStart(2, '0');
      return `${item.grandparentTitle ?? '?'} S${s}E${e} ${item.title}`;
    }
  }
}

/** Human-readable summary table of a dry run. */
export function formatReport(reports: LibraryReport[]): string {
  const lines: string[] = [];
  for (const { section, types } of reports) {
    lines.push(`\n${section.title} (section ${section.key}, ${section.type}, agent ${section.agent ?? 'unknown'})`);
    lines.push(`  ${'type'.padEnd(8)} ${'total'.padStart(7)} ${'tvdb'.padStart(7)} ${'tmdb'.padStart(7)} ${'imdb'.padStart(7)} ${'no ID'.padStart(7)} ${'locked'.padStart(7)} ${'empty'.padStart(7)}`);
    for (const [type, s] of Object.entries(types)) {
      if (!s) continue;
      lines.push(
        `  ${type.padEnd(8)} ${n(s.total)} ${n(s.withId.tvdb)} ${n(s.withId.tmdb)} ${n(s.withId.imdb)} ${n(s.noUsableId)} ${n(s.summaryLocked)} ${n(s.emptySummary)}`
      );
    }
  }
  return lines.join('\n');
}

function n(value: number): string {
  return String(value).padStart(7);
}
