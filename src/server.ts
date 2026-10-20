/**
 * Provider server: the HTTP endpoints Plex calls.
 *
 *   GET  /movie                              provider definition
 *   POST /movie/library/metadata/matches     match
 *   GET  /movie/library/metadata/:ratingKey  metadata
 *   GET  /health
 */

import express, { Express } from 'express';
import path from 'path';
import { Config, loadDotenv, readConfig } from './config/env';
import { MovieProvider } from './providers/movie/MovieProvider';
import { TmdbMovies } from './providers/movie/TmdbMovies';
import { movieRoutes } from './providers/movie/movieRoutes';
import { OmdbSource } from './sources/omdb/OmdbSource';
import { SourceName, SummarySource } from './sources/SummarySource';
import { TmdbSource } from './sources/tmdb/TmdbSource';
import { Store } from './store/Store';
import logger from './utils/logger';

export function createApp(config: Config, store: Store, deps: { tmdbMovies?: TmdbMovies } = {}): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    logger.debug(`${req.method} ${req.originalUrl}`);
    next();
  });

  const started = Date.now();
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptimeSeconds: Math.round((Date.now() - started) / 1000), cacheEntries: store.cacheSize() });
  });

  if (config.sources.tmdbApiKey) {
    const tmdbMovies = deps.tmdbMovies ?? new TmdbMovies(config.sources.tmdbApiKey, store);
    const movie = new MovieProvider(tmdbMovies, summarySources(config, store));
    app.use('/movie', movieRoutes(movie, config.sources.language));
  } else {
    logger.warn('TMDB_API_KEY not set: the movie provider (/movie) is disabled');
  }

  return app;
}

/** Summary sources per language, created on first use. */
function summarySources(config: Config, store: Store): (language: string) => Map<SourceName, SummarySource> {
  const byLanguage = new Map<string, Map<SourceName, SummarySource>>();
  const omdb = config.sources.omdbApiKey
    ? new OmdbSource({ apiKey: config.sources.omdbApiKey, dailyCap: config.sources.omdbDailyCap, store })
    : undefined;
  return language => {
    let sources = byLanguage.get(language);
    if (!sources) {
      sources = new Map<SourceName, SummarySource>();
      if (config.sources.tmdbApiKey) {
        sources.set('tmdb', new TmdbSource({ apiKey: config.sources.tmdbApiKey, language, store }));
      }
      // OMDb is English-only (IMDb plots).
      if (omdb && language.toLowerCase().startsWith('en')) sources.set('omdb', omdb);
      byLanguage.set(language, sources);
    }
    return sources;
  };
}

if (require.main === module) {
  loadDotenv();
  const config = readConfig();
  const port = parseInt(process.env.PORT || '3000', 10);
  const store = new Store(path.join(config.dataDir, 'providers.db'));
  const app = createApp(config, store);
  app.listen(port, () => {
    logger.info(`Providers listening on port ${port}`);
    logger.info(`Movie provider: http://<this-host>:${port}/movie`);
  });
}
