/**
 * HTTP routes for the TV provider, mounted at /tv.
 */

import { Request, Response, Router } from 'express';
import logger from '../../utils/logger';
import { container, flag, isValidRatingKey, plexParam, providerDefinition } from '../common';
import { TV_IDENTIFIER, TV_TITLE, TvContext, TvMatchRequest, TvProvider } from './TvProvider';

const VERSION = '1.0.0';
const DEFAULT_PAGE_SIZE = 20;

export function tvRoutes(provider: TvProvider, defaultLanguage: string): Router {
  const router = Router();
  const ctx = (req: Request): TvContext => ({ language: plexParam(req, 'X-Plex-Language') ?? defaultLanguage });

  router.get('/', (_req, res) => {
    res.json(providerDefinition(TV_IDENTIFIER, TV_TITLE, VERSION, ['show', 'season', 'episode']));
  });

  router.post('/library/metadata/matches', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    logger.debug('tv match request', body);
    const type = Number(body.type);
    if (type !== 2 && type !== 3 && type !== 4) {
      return res.status(400).json({ error: `This provider matches shows, seasons and episodes (types 2-4), got ${body.type}` });
    }
    const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
    const num = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : Number.isFinite(Number(v)) ? Number(v) : undefined);
    const match: TvMatchRequest = {
      type,
      title: str(body.title),
      parentTitle: str(body.parentTitle),
      grandparentTitle: str(body.grandparentTitle),
      year: num(body.year),
      guid: str(body.guid),
      filename: str(body.filename),
      index: num(body.index),
      parentIndex: num(body.parentIndex),
      date: str(body.date),
      manual: flag(body.manual),
      includeChildren: flag(body.includeChildren),
    };
    const showTitle = type === 2 ? match.title : type === 3 ? match.parentTitle : match.grandparentTitle;
    if (!showTitle && !match.guid && !match.filename) {
      return res.status(400).json({ error: 'Match needs a show title, guid or filename' });
    }
    if (type === 3 && match.index === undefined) {
      return res.status(400).json({ error: 'Season match needs index' });
    }
    if (type === 4 && (match.parentIndex === undefined || match.index === undefined) && !match.date) {
      return res.status(400).json({ error: 'Episode match needs parentIndex and index, or date' });
    }
    try {
      res.json(container(TV_IDENTIFIER, await provider.match(match, ctx(req))));
    } catch (error) {
      fail(res, 'match', error);
    }
  });

  router.get('/library/metadata/:ratingKey/extras', (_req, res) => {
    res.json(container(TV_IDENTIFIER, []));
  });

  for (const kind of ['children', 'grandchildren'] as const) {
    router.get(`/library/metadata/:ratingKey/${kind}`, async (req: Request, res: Response) => {
      const ratingKey = String(req.params.ratingKey);
      if (!isValidRatingKey(ratingKey)) return res.status(400).json({ error: 'Invalid ratingKey' });
      const { start, size } = paging(req);
      try {
        const page = await provider[kind](ratingKey, ctx(req), start, size);
        if (!page) return res.status(404).json({ error: `No ${kind} for ${ratingKey}` });
        res.json(container(TV_IDENTIFIER, page.items, page.total, start));
      } catch (error) {
        fail(res, kind, error);
      }
    });
  }

  router.get('/library/metadata/:ratingKey', async (req: Request, res: Response) => {
    const ratingKey = String(req.params.ratingKey);
    if (!isValidRatingKey(ratingKey)) return res.status(400).json({ error: 'Invalid ratingKey' });
    try {
      const item = await provider.metadata(ratingKey, ctx(req), flag(req.query.includeChildren));
      if (!item) return res.status(404).json({ error: `Unknown ratingKey ${ratingKey}` });
      res.json(container(TV_IDENTIFIER, [item]));
    } catch (error) {
      fail(res, 'metadata', error);
    }
  });

  return router;
}

/**
 * X-Plex-Container-Start / -Size, from headers or query. Plex sends a 0-based start
 * (observed: X-Plex-Container-Start=0); the default page size is 20.
 */
export function paging(req: Request): { start: number; size: number } {
  const start = parseInt(plexParam(req, 'X-Plex-Container-Start') ?? '0', 10);
  const size = parseInt(plexParam(req, 'X-Plex-Container-Size') ?? String(DEFAULT_PAGE_SIZE), 10);
  return {
    start: Number.isFinite(start) && start > 0 ? start : 0,
    size: Number.isFinite(size) && size > 0 ? Math.min(size, 500) : DEFAULT_PAGE_SIZE,
  };
}

function fail(res: Response, what: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(`tv ${what} failed: ${message}`);
  res.status(500).json({ error: 'Internal server error' });
}
