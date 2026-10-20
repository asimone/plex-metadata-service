#!/usr/bin/env node
/**
 * Command-line entry point.
 *
 *   node dist/cli.js libraries
 *   node dist/cli.js sync --dry-run [--library <name|key>]... [--summary-only] [--json]
 */

import { parseArgs } from 'node:util';
import { loadDotenv, readConfig, validateConfig, Config } from './config/env';
import { PlexClient } from './plex/PlexClient';
import { isSupportedSection, selectSections } from './sync/libraries';
import { formatItem, formatReport, runDryRun } from './sync/dryRun';
import logger from './utils/logger';

const USAGE = `Usage:
  cli libraries                      List the server's libraries
  cli sync --dry-run [options]       List items and their external IDs (no writes)

Options for sync:
  --library <name|key>   Limit to a library (repeatable; default PLEX_LIBRARIES or all movie/TV libraries)
  --summary-only         Print only the per-library counts
  --json                 Print items as JSON lines instead of text
`;

export async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      'dry-run': { type: 'boolean', default: false },
      library: { type: 'string', multiple: true },
      'summary-only': { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  const command = positionals[0];
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

  const client = new PlexClient({ url: config.plex.url, token: config.plex.token });

  switch (command) {
    case 'libraries':
      return listLibraries(client);
    case 'sync':
      if (!values['dry-run']) {
        logger.error('Writing to Plex is not implemented yet; run "sync --dry-run"');
        return 1;
      }
      return dryRun(client, config, {
        libraries: values.library ?? [],
        summaryOnly: values['summary-only'],
        json: values.json,
      });
    default:
      logger.error(`Unknown command "${command}"`);
      process.stdout.write(USAGE);
      return 1;
  }
}

async function listLibraries(client: PlexClient): Promise<number> {
  const sections = await client.getSections();
  for (const s of sections) {
    const note = isSupportedSection(s) ? '' : '  (not supported)';
    process.stdout.write(`${s.key.padStart(4)}  ${s.type.padEnd(6)}  ${s.title}  [${s.agent ?? 'unknown agent'}]${note}\n`);
  }
  return 0;
}

async function dryRun(
  client: PlexClient,
  config: Config,
  opts: { libraries: string[]; summaryOnly: boolean; json: boolean }
): Promise<number> {
  const wanted = opts.libraries.length > 0 ? opts.libraries : config.plex.libraries;
  const sections = selectSections(await client.getSections(), wanted);
  if (sections.length === 0) {
    logger.warn('No movie or TV libraries found');
    return 0;
  }

  logger.info(`Dry run over: ${sections.map(s => s.title).join(', ')}`);
  const reports = await runDryRun(client, sections, {
    onItem: opts.summaryOnly
      ? undefined
      : (item, section) => {
          const line = opts.json ? JSON.stringify({ library: section.title, ...item }) : formatItem(item);
          process.stdout.write(line + '\n');
        },
  });

  process.stdout.write(formatReport(reports) + '\n');
  return 0;
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
