/**
 * Environment configuration
 */

import dotenv from 'dotenv';
import path from 'path';

export interface Config {
  sources: {
    tvdbApiKey: string;
    tvdbPin: string;
    tmdbApiKey: string;
    omdbApiKey: string;
    omdbDailyCap: number;
    /** Default summary language when Plex doesn't send one, e.g. "en-US". */
    language: string;
  };
  dataDir: string;
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
    sources: {
      tvdbApiKey: (env.TVDB_API_KEY || '').trim(),
      tvdbPin: (env.TVDB_PIN || '').trim(),
      tmdbApiKey: (env.TMDB_API_KEY || '').trim(),
      omdbApiKey: (env.OMDB_API_KEY || '').trim(),
      omdbDailyCap: positiveInt(env.OMDB_DAILY_CAP, 900),
      language: (env.SUMMARY_LANGUAGE || 'en-US').trim(),
    },
    dataDir: (env.DATA_DIR || './data').trim(),
  };
}

function positiveInt(value: string | undefined, fallback: number): number {
  const n = parseInt((value || '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
