/**
 * Environment configuration
 */

import dotenv from 'dotenv';
import path from 'path';

export interface Config {
  plex: {
    url: string;
    token: string;
    /** Library names or section IDs to sync. Empty means every movie and show library. */
    libraries: string[];
  };
  sources: {
    tvdbApiKey: string;
    tvdbPin: string;
    tmdbApiKey: string;
    omdbApiKey: string;
  };
}

/**
 * Loads `.env` from the working directory into process.env (existing variables win).
 */
export function loadDotenv(): void {
  dotenv.config({ path: path.resolve(process.cwd(), '.env'), quiet: true });
}

/**
 * Builds the config object from an environment map. Pure, so tests can pass their own env.
 */
export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    plex: {
      url: (env.PLEX_URL || '').trim().replace(/\/+$/, ''),
      token: (env.PLEX_TOKEN || '').trim(),
      libraries: (env.PLEX_LIBRARIES || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean),
    },
    sources: {
      tvdbApiKey: (env.TVDB_API_KEY || '').trim(),
      tvdbPin: (env.TVDB_PIN || '').trim(),
      tmdbApiKey: (env.TMDB_API_KEY || '').trim(),
      omdbApiKey: (env.OMDB_API_KEY || '').trim(),
    },
  };
}

/**
 * Validates the config and returns any problems. Errors are fatal; warnings are not.
 */
export function validateConfig(config: Config): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!config.plex.url) {
    errors.push('PLEX_URL is not set (e.g. http://192.168.1.10:32400)');
  } else if (!/^https?:\/\/[^/]+/.test(config.plex.url)) {
    errors.push(`PLEX_URL must start with http:// or https:// (got "${config.plex.url}")`);
  }

  if (!config.plex.token) {
    errors.push('PLEX_TOKEN is not set');
  }

  const { tvdbApiKey, tmdbApiKey, omdbApiKey } = config.sources;
  if (!tvdbApiKey && !tmdbApiKey && !omdbApiKey) {
    warnings.push('No source API keys set (TVDB_API_KEY, TMDB_API_KEY, OMDB_API_KEY); only listing is possible');
  }

  return { errors, warnings };
}
