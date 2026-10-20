#!/usr/bin/env node
/**
 * Command-line entry point. Run with no arguments for usage.
 */

import path from 'path';
import { parseArgs } from 'node:util';
import { loadDotenv, readConfig, validateConfig, Config } from './config/env';
import { PlexClient } from './plex/PlexClient';
import { PlexSection } from './plex/types';
import { OmdbSource } from './sources/omdb/OmdbSource';
import { SummarySource } from './sources/SummarySource';
import { TmdbSource } from './sources/tmdb/TmdbSource';
import { Store } from './store/Store';
import { formatItem, formatReport, runDryRun, displayTitle } from './sync/dryRun';
import { isSupportedSection, selectSections } from './sync/libraries';
import { Outcome, SummarySync, describeLookup } from './sync/SummarySync';
import logger from './utils/logger';

const USAGE = `Usage:
  cli libraries                         List the server's libraries
  cli list [--library X] [--summary-only] [--json]
                                        List items and their external IDs (read-only)
  cli sync [--library X] [--item <ratingKey>]... [--all] [--full] [--write]
                                        Dry run by default: show which summaries would change.
                                        --write applies changes. Whole-library writes also need
                                        SYNC_WRITE=true; --item writes don't.
  cli show <ratingKey>                  Plex's summary next to every source's, and the decision
  cli restore <ratingKey>... | --all    Put back Plex's original summary and unlock it

Common options:
  --library <name|key>   Limit to a library (repeatable; default PLEX_LIBRARIES or all movie/TV libraries)
  --all                  (sync) list every item, not just the ones that would change
  --full                 (sync) print full summaries instead of the first line
`;

export async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      library: { type: 'string', multiple: true },
      item: { type: 'string', multiple: true },
      write: { type: 'boolean', default: false },
      all: { type: 'boolean', default: false },
      full: { type: 'boolean', default: false },
      'summary-only': { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      // Accepted for clarity; sync is a dry run unless --write is given.
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  const [command, ...args] = positionals;
  if (values.help || !command) {
    process.stdout.write(USAGE);
    return command || values.help ? 0 : 1;
  }

  loadDotenv();
  const config = readConfig();
  const { errors, warnings } = validateConfig(config);
  warnings.forEach(w => logger.warn(w));
  if (errors.length > 0) {
    errors.forEach(e => logger.error(e));
    return 1;
  }

  const plex = new PlexClient({ url: config.plex.url, token: config.plex.token });
  const libraries = values.library ?? [];

  switch (command) {
    case 'libraries':
      return listLibraries(plex);
    case 'list':
      return list(plex, config, { libraries, summaryOnly: values['summary-only'], json: values.json });
    case 'sync':
      return withSync(config, plex, sync =>
        runSync(sync, plex, config, { libraries, items: values.item ?? [], write: values.write, all: values.all, full: values.full })
      );
    case 'show':
      if (args.length !== 1) return usageError('show needs one ratingKey');
      return withSync(config, plex, sync => show(sync, plex, args[0]));
    case 'restore':
      if (!values.all && args.length === 0) return usageError('restore needs ratingKeys or --all');
      return withSync(config, plex, (sync, store) => restore(sync, store, args, values.all));
    default:
      return usageError(`Unknown command "${command}"`);
  }
}

function usageError(message: string): number {
  logger.error(message);
  process.stdout.write(USAGE);
  return 1;
}

/** Opens the store, builds the configured sources, and closes the store afterwards. */
async function withSync(config: Config, plex: PlexClient, fn: (sync: SummarySync, store: Store) => Promise<number>): Promise<number> {
  const store = new Store(path.join(config.dataDir, 'summary-sync.db'));
  try {
    const sources: SummarySource[] = [];
    if (config.sources.tmdbApiKey) {
      sources.push(new TmdbSource({ apiKey: config.sources.tmdbApiKey, language: config.sources.language, store }));
    }
    if (config.sources.omdbApiKey) {
      sources.push(new OmdbSource({ apiKey: config.sources.omdbApiKey, dailyCap: config.sources.omdbDailyCap, store }));
    }
    return await fn(new SummarySync(plex, store, sources), store);
  } finally {
    store.close();
  }
}

async function listLibraries(plex: PlexClient): Promise<number> {
  for (const s of await plex.getSections()) {
    const note = isSupportedSection(s) ? '' : '  (not supported)';
    out(`${s.key.padStart(4)}  ${s.type.padEnd(6)}  ${s.title}  [${s.agent ?? 'unknown agent'}]${note}`);
  }
  return 0;
}

async function chooseSections(plex: PlexClient, config: Config, libraries: string[]): Promise<PlexSection[]> {
  return selectSections(await plex.getSections(), libraries.length > 0 ? libraries : config.plex.libraries);
}

async function list(plex: PlexClient, config: Config, opts: { libraries: string[]; summaryOnly: boolean; json: boolean }): Promise<number> {
  const sections = await chooseSections(plex, config, opts.libraries);
  logger.info(`Listing: ${sections.map(s => s.title).join(', ') || 'no movie or TV libraries'}`);
  const reports = await runDryRun(plex, sections, {
    onItem: opts.summaryOnly
      ? undefined
      : (item, section) => out(opts.json ? JSON.stringify({ library: section.title, ...item }) : formatItem(item)),
  });
  out(formatReport(reports));
  return 0;
}

async function runSync(
  sync: SummarySync,
  plex: PlexClient,
  config: Config,
  opts: { libraries: string[]; items: string[]; write: boolean; all: boolean; full: boolean }
): Promise<number> {
  if (opts.write && opts.items.length === 0 && !config.sync.write) {
    logger.error('Whole-library writes are disabled. Set SYNC_WRITE=true in .env, or use --item <ratingKey> to write single items.');
    return 1;
  }
  if (sync.supportedTypes().length === 0) {
    logger.error('No summary sources configured. Set TMDB_API_KEY (and optionally OMDB_API_KEY).');
    return 1;
  }

  const mode = opts.write ? 'WRITE' : 'DRY RUN (nothing is written; add --write to apply)';
  logger.info(`Sync mode: ${mode}`);
  const options = {
    write: opts.write,
    writeIntervalMs: Math.ceil(1000 / config.sync.writesPerSecond),
    onOutcome: (o: Outcome) => printOutcome(o, opts),
  };

  if (opts.items.length > 0) {
    let failed = 0;
    for (const ratingKey of opts.items) {
      const found = await plex.getItem(ratingKey);
      if (!found) {
        logger.error(`No Plex item with ratingKey ${ratingKey}`);
        failed++;
        continue;
      }
      const outcome = await sync.syncItem(found.item, found.sectionKey, options);
      if (outcome.error) failed++;
    }
    return failed > 0 ? 1 : 0;
  }

  const sections = await chooseSections(plex, config, opts.libraries);
  const counts = await sync.syncSections(sections, options);
  const verb = opts.write ? 'written' : 'would write';
  out(
    `\n${counts.write} ${verb}, ${counts.lock} ${opts.write ? 'locked' : 'would lock'} (same text), ` +
      `${counts.unchanged} unchanged, ${counts['user-owned']} edited in Plex (left alone), ` +
      `${counts['no-source']} no source summary, ${counts.errors} errors`
  );
  return counts.errors > 0 ? 1 : 0;
}

function printOutcome(o: Outcome, opts: { all: boolean; full: boolean; write: boolean }): void {
  const title = `${displayTitle(o.item)} [${o.item.ratingKey}]`;
  if (o.error) {
    out(`ERROR      ${title}: ${o.error}`);
    return;
  }
  const interesting = o.action === 'write' || o.action === 'lock';
  if (!interesting && !opts.all) return;

  const label = (o.written ? `${o.action}✓` : o.action).padEnd(10);
  out(`${label} ${title}${o.winner ? `  ← ${o.winner.source} (${o.winner.externalId})` : ''}${o.detail ? `  (${o.detail})` : ''}`);
  if (o.action === 'write' && o.winner) {
    out(`   plex: ${clip(o.item.summary, opts.full)}`);
    out(`   new:  ${clip(o.winner.summary, opts.full)}`);
  }
}

async function show(sync: SummarySync, plex: PlexClient, ratingKey: string): Promise<number> {
  const found = await plex.getItem(ratingKey);
  if (!found) {
    logger.error(`No Plex item with ratingKey ${ratingKey}`);
    return 1;
  }
  const { item, sectionKey } = found;
  out(`${displayTitle(item)}  [ratingKey ${item.ratingKey}, section ${sectionKey}]`);
  out(`IDs: ${item.externalIds.join(' ') || '(none)'}`);
  out(`\nPlex${item.summaryLocked ? ' (locked)' : ''}:\n  ${item.summary || '(empty)'}`);

  const { lookups, winner } = await sync.resolve(item, true);
  if (lookups.length === 0) out('\n(no sources configured for this item type)');
  for (const { source, lookup } of lookups) {
    out(`\n${source}: ${lookup.status === 'found' ? '' : describeLookup(lookup)}`);
    if (lookup.status === 'found') out(`  ${lookup.summary}`);
  }

  const outcome = await sync.syncItem(item, sectionKey, { write: false });
  out(`\nDecision: ${outcome.action}${winner ? ` (from ${winner.source})` : ''}`);
  return 0;
}

async function restore(sync: SummarySync, store: Store, ratingKeys: string[], all: boolean): Promise<number> {
  const keys = all ? store.allItems().map(r => r.ratingKey) : ratingKeys;
  let missing = 0;
  for (const key of keys) {
    if (!(await sync.restore(key))) {
      logger.warn(`Nothing to restore for ${key} (never synced)`);
      missing++;
    }
  }
  out(`Restored ${keys.length - missing} item(s).`);
  return 0;
}

function clip(text: string, full: boolean): string {
  if (!text) return '(empty)';
  if (full) return text;
  const oneLine = text.replace(/\s+/g, ' ');
  return oneLine.length > 140 ? oneLine.slice(0, 137) + '…' : oneLine;
}

function out(line: string): void {
  process.stdout.write(line + '\n');
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    code => {
      process.exitCode = code;
    },
    error => {
      logger.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  );
}
