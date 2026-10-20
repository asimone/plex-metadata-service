import nock from 'nock';
import request from 'supertest';
import { readConfig } from '../src/config/env';
import { inLanguage } from '../src/providers/tv/TvdbShows';
import { parseTvRatingKey, searchQueries } from '../src/providers/tv/TvProvider';
import { CircuitBreaker } from '../src/resilience/circuitBreaker';
import { HttpSource } from '../src/resilience/http';
import { createApp } from '../src/server';
import { TvdbClient } from '../src/sources/tvdb/TvdbClient';
import { Store } from '../src/store/Store';

const TVDB = 'https://api4.thetvdb.com';
const TMDB = 'https://api.themoviedb.org';
const ID = 'tv.plex.agents.custom.simone.tv';

const series = {
  id: 447955,
  name: '全修。',
  year: '2025',
  firstAired: '2025-01-05',
  overview: '広瀬ナツ子は…',
  originalLanguage: 'jpn',
  remoteIds: [
    { id: 'tt31863730', sourceName: 'IMDB' },
    { id: '249882', sourceName: 'TheMovieDB.com' },
  ],
  seasons: [
    { id: 2119014, number: 0, type: { type: 'official' }, overviewTranslations: [] },
    { id: 2119015, number: 1, type: { type: 'official' }, overviewTranslations: ['eng'] },
    { id: 9999, number: 1, type: { type: 'absolute' }, overviewTranslations: [] },
  ],
  translations: {
    nameTranslations: [
      { name: '全修。', language: 'jpn', isPrimary: true },
      { name: 'ZENSHU', language: 'eng' },
    ],
    overviewTranslations: [{ overview: 'After graduating from high school, Natsuko Hirose...', language: 'eng' }],
  },
};

const episodes = [
  { id: 101, seasonNumber: 1, number: 1, name: 'FIRST STROKE', aired: '2025-01-05', overview: 'An up-and-coming anime director...' },
  { id: 102, seasonNumber: 1, number: 2, name: 'DEFEND', aired: '2025-01-12', overview: 'Natsuko <i>fights</i>.' },
  { id: 103, seasonNumber: 1, number: 3, name: 'DESTINY', aired: '2025-01-19', overview: '日本語のあらすじです。' },
];

let store: Store;

function app() {
  const config = readConfig({ TVDB_API_KEY: 'key', TMDB_API_KEY: 'tkey' });
  const http = new HttpSource({ baseURL: `${TVDB}/v4`, breaker: new CircuitBreaker('tvdb'), sleep: async () => undefined });
  return createApp(config, store, { tvdbClient: new TvdbClient('key', undefined, store, http) });
}

/** TVDB endpoints for the ZENSHU fixture (persisted: the cache absorbs repeats anyway). */
function tvdbShow() {
  nock(TVDB)
    .persist()
    .post('/v4/login')
    .reply(200, { status: 'success', data: { token: 'tok' } })
    .get('/v4/series/447955/extended')
    .query({ meta: 'translations', short: 'true' })
    .reply(200, { status: 'success', data: series })
    .get('/v4/series/447955/episodes/default/eng')
    .query({ page: '0' })
    .reply(200, { status: 'success', data: { episodes }, links: { next: null } })
    .get('/v4/seasons/2119015/translations/eng')
    .reply(200, { status: 'success', data: { overview: 'Season one overview.' } });
}

function match(body: object) {
  return request(app()).post('/tv/library/metadata/matches').send(body);
}

beforeAll(() => {
  nock.disableNetConnect();
  nock.enableNetConnect('127.0.0.1');
});
beforeEach(() => (store = new Store(':memory:')));
afterEach(() => {
  store.close();
  nock.cleanAll();
});
afterAll(() => nock.enableNetConnect());

describe('helpers', () => {
  it('parses TV ratingKeys', () => {
    expect(parseTvRatingKey('tvdb-show-1')).toEqual({ type: 'show', showId: '1' });
    expect(parseTvRatingKey('tvdb-season-1-0')).toEqual({ type: 'season', showId: '1', season: 0 });
    expect(parseTvRatingKey('tvdb-episode-9')).toEqual({ type: 'episode', episodeId: '9' });
    expect(parseTvRatingKey('tmdb-movie-1')).toBeUndefined();
  });

  it('falls back to the main title before a subtitle', () => {
    expect(searchQueries('Winning Time: The Rise of the Lakers Dynasty')).toEqual(['Winning Time: The Rise of the Lakers Dynasty', 'Winning Time']);
    expect(searchQueries('Bluey - Minisodes')).toEqual(['Bluey - Minisodes', 'Bluey']);
    expect(searchQueries('Spider-Man: The Animated Series')).toEqual(['Spider-Man: The Animated Series', 'Spider-Man']);
    expect(searchQueries('Doctor Who')).toEqual(['Doctor Who']);
    expect(searchQueries('X: The Show')).toEqual(['X: The Show']);
  });

  it('drops non-Latin text for Latin-script languages', () => {
    expect(inLanguage('日本語のあらすじです。', 'eng')).toBeUndefined();
    expect(inLanguage('Natsuko (夏子) fights.', 'eng')).toBe('Natsuko (夏子) fights.');
    expect(inLanguage('日本語のあらすじです。', 'jpn')).toBe('日本語のあらすじです。');
  });
});

describe('GET /tv', () => {
  it('declares shows, seasons and episodes', async () => {
    const res = await request(app()).get('/tv').expect(200);
    expect(res.body.MediaProvider.identifier).toBe(ID);
    expect(res.body.MediaProvider.title).toBe('TVDB TV Shows');
    expect(res.body.MediaProvider.Types.map((t: { type: number }) => t.type)).toEqual([2, 3, 4]);
  });
});

describe('matching', () => {
  it('matches a show by title search, in English, with children', async () => {
    tvdbShow();
    nock(TVDB)
      .get('/v4/search')
      .query({ query: 'ZENSHU', type: 'series', year: '2025' })
      .reply(200, {
        status: 'success',
        data: [
          { tvdb_id: '1', name: 'Zen', year: '2025' },
          { tvdb_id: '447955', name: '全修。', year: '2025', aliases: ['ZENSHU.'], translations: { eng: 'ZENSHU' } },
        ],
      });
    const res = await match({ type: 2, title: 'ZENSHU', year: 2025, includeChildren: 1 }).expect(200);
    const show = res.body.MediaContainer.Metadata[0];
    expect(show).toMatchObject({
      ratingKey: 'tvdb-show-447955',
      key: '/library/metadata/tvdb-show-447955/children',
      guid: `${ID}://show/tvdb-show-447955`,
      type: 'show',
      title: 'ZENSHU',
      originalTitle: '全修。',
      year: 2025,
      originallyAvailableAt: '2025-01-05',
      summary: 'After graduating from high school, Natsuko Hirose...',
      Guid: [{ id: 'tvdb://447955' }, { id: 'imdb://tt31863730' }, { id: 'tmdb://249882' }],
    });
    // Only seasons that have episodes, and only aired order.
    expect(show.Children.Metadata.map((s: { ratingKey: string }) => s.ratingKey)).toEqual(['tvdb-season-447955-1']);
  });

  it('retries with the main title when TVDB finds nothing for the full title', async () => {
    tvdbShow();
    nock(TVDB)
      .get('/v4/search')
      .query({ query: 'ZENSHU: The Long Subtitle', type: 'series' })
      .reply(200, { status: 'success', data: [] })
      .get('/v4/search')
      .query({ query: 'ZENSHU', type: 'series' })
      .reply(200, {
        status: 'success',
        data: [
          { tvdb_id: '1', name: 'Zenshu Other', year: '2020' },
          { tvdb_id: '447955', name: '全修。', year: '2025', translations: { eng: 'ZENSHU: The Long Subtitle' } },
        ],
      });
    const res = await match({ type: 2, title: 'ZENSHU: The Long Subtitle' }).expect(200);
    expect(res.body.MediaContainer.Metadata[0].ratingKey).toBe('tvdb-show-447955');
  });

  it('uses a {tvdb-…} tag in the path without searching', async () => {
    tvdbShow();
    const res = await match({ type: 2, title: 'Anything', filename: 'ZENSHU (2025) {tvdb-447955}/Season 01/x.mkv' }).expect(200);
    expect(res.body.MediaContainer.Metadata[0].ratingKey).toBe('tvdb-show-447955');
  });

  it('resolves an imdb:// hint through TVDB remote IDs', async () => {
    tvdbShow();
    nock(TVDB).get('/v4/search/remoteid/tt31863730').reply(200, { status: 'success', data: [{ series: { id: 447955 } }] });
    const res = await match({ type: 2, guid: 'imdb://tt31863730' }).expect(200);
    expect(res.body.MediaContainer.Metadata[0].ratingKey).toBe('tvdb-show-447955');
  });

  it('matches a season by show and index', async () => {
    tvdbShow();
    const res = await match({ type: 3, parentTitle: 'x', filename: '{tvdb-447955}/S1/e.mkv', index: 1, includeChildren: 1 }).expect(200);
    const season = res.body.MediaContainer.Metadata[0];
    expect(season).toMatchObject({
      ratingKey: 'tvdb-season-447955-1',
      title: 'Season 1',
      index: 1,
      summary: 'Season one overview.',
      parentRatingKey: 'tvdb-show-447955',
      parentTitle: 'ZENSHU',
      originallyAvailableAt: '2025-01-05',
    });
    expect(season.Children.size).toBe(3);
  });

  it('matches an episode by numbers or by air date', async () => {
    tvdbShow();
    const byNumber = await match({ type: 4, grandparentTitle: 'x', filename: '{tvdb-447955}/e.mkv', parentIndex: 1, index: 2 }).expect(200);
    expect(byNumber.body.MediaContainer.Metadata[0]).toMatchObject({ ratingKey: 'tvdb-episode-102', title: 'DEFEND', summary: 'Natsuko fights.' });

    const byDate = await match({ type: 4, grandparentTitle: 'x', filename: '{tvdb-447955}/e.mkv', date: '2025-01-19' }).expect(200);
    expect(byDate.body.MediaContainer.Metadata[0].ratingKey).toBe('tvdb-episode-103');
  });

  it('returns an empty container when nothing matches', async () => {
    tvdbShow();
    const res = await match({ type: 4, grandparentTitle: 'x', filename: '{tvdb-447955}/e.mkv', parentIndex: 9, index: 9 }).expect(200);
    expect(res.body.MediaContainer.size).toBe(0);
  });

  it('validates requests', async () => {
    await match({ type: 1, title: 'Movie' }).expect(400);
    await match({ type: 2 }).expect(400);
    await match({ type: 3, parentTitle: 'Show' }).expect(400);
    await match({ type: 4, grandparentTitle: 'Show', index: 1 }).expect(400);
  });
});

describe('metadata, children and grandchildren', () => {
  it('builds an episode with its parents, falling back to TMDB when TVDB has no English text', async () => {
    tvdbShow();
    nock(TVDB).get('/v4/episodes/103').reply(200, { status: 'success', data: { id: 103, seriesId: 447955 } });
    nock(TMDB)
      .get('/3/find/103')
      .query(q => q.external_source === 'tvdb_id')
      .reply(200, { tv_episode_results: [{ overview: 'English text from TMDB.' }] });

    const res = await request(app()).get('/tv/library/metadata/tvdb-episode-103').expect(200);
    expect(res.body.MediaContainer.Metadata[0]).toEqual({
      ratingKey: 'tvdb-episode-103',
      key: '/library/metadata/tvdb-episode-103',
      guid: `${ID}://episode/tvdb-episode-103`,
      type: 'episode',
      title: 'DESTINY',
      index: 3,
      parentIndex: 1,
      originallyAvailableAt: '2025-01-19',
      year: 2025,
      summary: 'English text from TMDB.',
      parentRatingKey: 'tvdb-season-447955-1',
      parentKey: '/library/metadata/tvdb-season-447955-1',
      parentGuid: `${ID}://season/tvdb-season-447955-1`,
      parentTitle: 'Season 1',
      grandparentRatingKey: 'tvdb-show-447955',
      grandparentKey: '/library/metadata/tvdb-show-447955',
      grandparentGuid: `${ID}://show/tvdb-show-447955`,
      grandparentTitle: 'ZENSHU',
      Guid: [{ id: 'tvdb://103' }],
    });
  });

  it('pages children and grandchildren with Plex headers', async () => {
    tvdbShow();
    const seasons = await request(app()).get('/tv/library/metadata/tvdb-show-447955/children').expect(200);
    expect(seasons.body.MediaContainer).toMatchObject({ size: 1, totalSize: 1, offset: 0 });

    const page = await request(app())
      .get('/tv/library/metadata/tvdb-show-447955/grandchildren')
      .set('X-Plex-Container-Start', '1')
      .set('X-Plex-Container-Size', '1')
      .expect(200);
    expect(page.body.MediaContainer).toMatchObject({ size: 1, totalSize: 3, offset: 1 });
    expect(page.body.MediaContainer.Metadata[0].ratingKey).toBe('tvdb-episode-102');

    const viaQuery = await request(app()).get('/tv/library/metadata/tvdb-season-447955-1/children?X-Plex-Container-Size=2').expect(200);
    expect(viaQuery.body.MediaContainer).toMatchObject({ size: 2, totalSize: 3 });
  });

  it('404s for unknown items and children that do not exist', async () => {
    tvdbShow();
    nock(TVDB).get('/v4/series/0/extended').query(true).reply(400, { status: 'failure' });
    await request(app()).get('/tv/library/metadata/tvdb-show-0').expect(404);
    await request(app()).get('/tv/library/metadata/tvdb-season-447955-7').expect(404);
    await request(app()).get('/tv/library/metadata/tvdb-episode-101/children').expect(404);
    await request(app()).get('/tv/library/metadata/tvdb-season-447955-1/grandchildren').expect(404);
    await request(app()).get('/tv/library/metadata/plex-1').expect(404);
  });

  it('answers extras with an empty container', async () => {
    const res = await request(app()).get('/tv/library/metadata/tvdb-show-447955/extras').expect(200);
    expect(res.body.MediaContainer.size).toBe(0);
  });
});
