/**
 * Provider server: the HTTP endpoints Plex calls.
 *
 *   GET  /movie                              provider definition
 *   POST /movie/library/metadata/matches     match
 *   GET  /movie/library/metadata/:ratingKey  metadata
 *   GET  /tv ...                             the same for TV, plus /children and /grandchildren
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
import { TvdbClient } from './sources/tvdb/TvdbClient';
import { TvdbSource } from './sources/tvdb/TvdbSource';
import { TvProvider } from './providers/tv/TvProvider';
import { TvdbShows } from './providers/tv/TvdbShows';
import { tvRoutes } from './providers/tv/tvRoutes';
import { Store } from './store/Store';
import logger from './utils/logger';

export function createApp(config: Config, store: Store, deps: { tmdbMovies?: TmdbMovies; tvdbClient?: TvdbClient } = {}): Express {
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

  const tvdbClient =
    deps.tvdbClient ?? (config.sources.tvdbApiKey ? new TvdbClient(config.sources.tvdbApiKey, config.sources.tvdbPin, store) : undefined);
  const sources = summarySources(config, store, tvdbClient);

  if (config.sources.tmdbApiKey) {
    const tmdbMovies = deps.tmdbMovies ?? new TmdbMovies(config.sources.tmdbApiKey, store);
    const movie = new MovieProvider(tmdbMovies, sources);
    app.use('/movie', movieRoutes(movie, config.sources.language));
  } else {
    logger.warn('TMDB_API_KEY not set: the movie provider (/movie) is disabled');
  }

  if (tvdbClient) {
    const tv = new TvProvider(new TvdbShows(tvdbClient, store), sources);
    app.use('/tv', tvRoutes(tv, config.sources.language));
  } else {
    logger.warn('TVDB_API_KEY not set: the TV provider (/tv) is disabled');
  }

  return app;
}

/** Summary sources per language, created on first use. */
function summarySources(config: Config, store: Store, tvdbClient?: TvdbClient): (language: string) => Map<SourceName, SummarySource> {
  const byLanguage = new Map<string, Map<SourceName, SummarySource>>();
  const omdb = config.sources.omdbApiKey
    ? new OmdbSource({ apiKey: config.sources.omdbApiKey, dailyCap: config.sources.omdbDailyCap, store })
    : undefined;
  return language => {
    let sources = byLanguage.get(language);
    if (!sources) {
      sources = new Map<SourceName, SummarySource>();
      if (tvdbClient) {
        sources.set('tvdb', new TvdbSource({ apiKey: config.sources.tvdbApiKey, language, store, client: tvdbClient }));
      }
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
    logger.info(`Providers: http://<this-host>:${port}/movie and /tv`);
  });
}
