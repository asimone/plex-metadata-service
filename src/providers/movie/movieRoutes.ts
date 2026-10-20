/**
 * HTTP routes for the movie provider, mounted at /movie.
 */

import { Request, Response, Router } from 'express';
import logger from '../../utils/logger';
import { container, flag, isValidRatingKey, plexParam, providerDefinition } from '../common';
import { MOVIE_IDENTIFIER, MOVIE_TITLE, MovieProvider } from './MovieProvider';

const VERSION = '1.0.0';

export function movieRoutes(provider: MovieProvider, defaultLanguage: string): Router {
  const router = Router();
  const language = (req: Request) => plexParam(req, 'X-Plex-Language') ?? defaultLanguage;

  router.get('/', (_req, res) => {
    res.json(providerDefinition(MOVIE_IDENTIFIER, MOVIE_TITLE, VERSION, ['movie']));
  });

  router.post('/library/metadata/matches', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    logger.debug('movie match request', body);
    const type = Number(body.type);
    if (body.type !== undefined && type !== 1) {
      return res.status(400).json({ error: `This provider only matches movies (type 1), got type ${body.type}` });
    }
    if (!body.title && !body.guid && !body.filename) {
      return res.status(400).json({ error: 'Match needs a title, guid or filename' });
    }
    try {
      const results = await provider.match({
        title: typeof body.title === 'string' ? body.title : undefined,
        year: body.year !== undefined ? Number(body.year) || undefined : undefined,
        guid: typeof body.guid === 'string' ? body.guid : undefined,
        filename: typeof body.filename === 'string' ? body.filename : undefined,
        manual: flag(body.manual),
        includeAdult: flag(body.includeAdult),
        language: language(req),
      });
      res.json(container(MOVIE_IDENTIFIER, results));
    } catch (error) {
      fail(res, 'match', error);
    }
  });

  router.get('/library/metadata/:ratingKey', async (req: Request, res: Response) => {
    const ratingKey = String(req.params.ratingKey);
    if (!isValidRatingKey(ratingKey)) {
      return res.status(400).json({ error: 'Invalid ratingKey' });
    }
    try {
      const item = await provider.metadata(ratingKey, language(req));
      if (!item) {
        return res.status(404).json({ error: `Unknown ratingKey ${ratingKey}` });
      }
      res.json(container(MOVIE_IDENTIFIER, [item]));
    } catch (error) {
      fail(res, 'metadata', error);
    }
  });

  return router;
}

function fail(res: Response, what: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(`movie ${what} failed: ${message}`);
  res.status(500).json({ error: 'Internal server error' });
}
