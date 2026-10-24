import nock from 'nock';
import request from 'supertest';
import { readConfig } from '../src/config/env';
import { TmdbShows } from '../src/providers/tv/TmdbShows';
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
  const tmdbHttp = new HttpSource({ baseURL: `${TMDB}/3`, params: { api_key: 'tkey' }, breaker: new CircuitBreaker('tmdb-shows'), sleep: async () => undefined });
  return createApp(config, store, {
    tvdbClient: new TvdbClient('key', undefined, store, http),
    tmdbShows: new TmdbShows('tkey', store, tmdbHttp),
  });
}

/** O.J.: Made in America (2016): a five-part series on TMDB that TVDB doesn't list. */
const ojShow = {
  id: 66738,
  name: 'O.J.: Made in America',
  original_name: 'O.J.: Made in America',
  overview: 'The rise and fall of American football star, O.J. Simpson.',
  first_air_date: '2016-06-11',
  seasons: [{ id: 76950, season_number: 1, overview: '', episode_count: 5 }],
  external_ids: { imdb_id: 'tt5275892', tvdb_id: null },
};

const ojEpisodes = [
  ['Part One - Obsessed with Fame', '2016-06-11'],
  ['Part Two - The Split America', '2016-06-14'],
  ['Part Three - The Murder', '2016-06-15'],
  ['Part Four - Trial of the Century', '2016-06-17'],
  ['Part Five - The Verdict', '2016-06-18'],
].map(([name, air_date], i) => ({ id: 1200 + i, season_number: 1, episode_number: i + 1, name, overview: `Part ${i + 1} overview.`, air_date }));

/** TMDB endpoints for the O.J. fixture. */
function tmdbOj() {
  nock(TMDB)
    .persist()
    .get('/3/tv/66738')
    .query(q => q.append_to_response === 'external_ids')
    .reply(200, ojShow)
    .get('/3/tv/66738/season/1')
    .query(true)
    .reply(200, { episodes: ojEpisodes });
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
    expect(parseTvRatingKey('tvdb-show-1')).toEqual({ type: 'show', source: 'tvdb', showId: '1' });
    expect(parseTvRatingKey('tvdb-season-1-0')).toEqual({ type: 'season', source: 'tvdb', showId: '1', season: 0 });
    expect(parseTvRatingKey('tvdb-episode-9')).toEqual({ type: 'episode', source: 'tvdb', episodeId: '9' });
    expect(parseTvRatingKey('tmdb-show-66738')).toEqual({ type: 'show', source: 'tmdb', showId: '66738' });
    expect(parseTvRatingKey('tmdb-season-66738-1')).toEqual({ type: 'season', source: 'tmdb', showId: '66738', season: 1 });
    expect(parseTvRatingKey('tmdb-episode-66738-1-5')).toEqual({ type: 'episode', source: 'tmdb', showId: '66738', season: 1, episode: 5 });
    expect(parseTvRatingKey('tmdb-episode-9')).toBeUndefined();
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

describe('TMDB fallback for shows TVDB does not list', () => {
  it('matches a TMDB show when TVDB has no confident title match, with TMDB keys and IDs', async () => {
    tmdbOj();
    nock(TVDB)
      .post('/v4/login')
      .reply(200, { status: 'success', data: { token: 'tok' } })
      .get('/v4/search')
      .query({ query: 'OJ Made in America', type: 'series', year: '2016' })
      .reply(200, { status: 'success', data: [{ tvdb_id: '314131', name: 'The Real O.J. Simpson Trial', year: '2016' }] });
    nock(TMDB)
      .get('/3/search/tv')
      .query(q => q.query === 'OJ Made in America' && q.first_air_date_year === '2016')
      .reply(200, { results: [{ id: 66738, name: 'O.J.: Made in America', original_name: 'O.J.: Made in America', first_air_date: '2016-06-11', popularity: 5 }] });

    const res = await match({ type: 2, title: 'OJ Made in America', year: 2016, includeChildren: 1 }).expect(200);
    const show = res.body.MediaContainer.Metadata[0];
    expect(show).toMatchObject({
      ratingKey: 'tmdb-show-66738',
      key: '/library/metadata/tmdb-show-66738/children',
      guid: `${ID}://show/tmdb-show-66738`,
      title: 'O.J.: Made in America',
      year: 2016,
      originallyAvailableAt: '2016-06-11',
      summary: 'The rise and fall of American football star, O.J. Simpson.',
      Guid: [{ id: 'tmdb://66738' }, { id: 'imdb://tt5275892' }],
    });
    expect(show.Children.Metadata.map((s: { ratingKey: string }) => s.ratingKey)).toEqual(['tmdb-season-66738-1']);
  });

  it('keeps a confident TVDB match without asking TMDB', async () => {
    tvdbShow();
    nock(TVDB)
      .get('/v4/search')
      .query({ query: 'ZENSHU', type: 'series', year: '2025' })
      .reply(200, { status: 'success', data: [{ tvdb_id: '447955', name: '全修。', year: '2025', translations: { eng: 'ZENSHU' } }] });
    // No TMDB search is mocked: calling it would fail the request.
    const res = await match({ type: 2, title: 'ZENSHU', year: 2025 }).expect(200);
    expect(res.body.MediaContainer.Metadata[0].ratingKey).toBe('tvdb-show-447955');
  });

  it('uses a tmdb:// hint directly, and prefers TVDB when TMDB knows the TVDB ID', async () => {
    tmdbOj();
    const direct = await match({ type: 2, guid: 'tmdb://66738' }).expect(200);
    expect(direct.body.MediaContainer.Metadata[0].ratingKey).toBe('tmdb-show-66738');

    tvdbShow();
    nock(TMDB)
      .get('/3/tv/249882')
      .query(true)
      .reply(200, { id: 249882, name: 'ZENSHU', seasons: [], external_ids: { imdb_id: 'tt31863730', tvdb_id: 447955 } });
    const viaTvdb = await match({ type: 2, guid: 'tmdb://249882' }).expect(200);
    expect(viaTvdb.body.MediaContainer.Metadata[0].ratingKey).toBe('tvdb-show-447955');
  });

  it('falls back to TMDB for an imdb:// hint TVDB does not know', async () => {
    tmdbOj();
    nock(TVDB)
      .post('/v4/login')
      .reply(200, { status: 'success', data: { token: 'tok' } })
      .get('/v4/search/remoteid/tt5275892')
      .reply(200, { status: 'success', data: [] });
    nock(TMDB)
      .get('/3/find/tt5275892')
      .query(q => q.external_source === 'imdb_id')
      .reply(200, { tv_results: [{ id: 66738 }] });
    const res = await match({ type: 2, guid: 'imdb://tt5275892' }).expect(200);
    expect(res.body.MediaContainer.Metadata[0].ratingKey).toBe('tmdb-show-66738');
  });

  it('matches TMDB seasons and episodes by number and serves them by key', async () => {
    tmdbOj();
    const episode = await match({ type: 4, grandparentTitle: 'x', guid: 'tmdb://66738', parentIndex: 1, index: 5 }).expect(200);
    expect(episode.body.MediaContainer.Metadata[0]).toEqual({
      ratingKey: 'tmdb-episode-66738-1-5',
      key: '/library/metadata/tmdb-episode-66738-1-5',
      guid: `${ID}://episode/tmdb-episode-66738-1-5`,
      type: 'episode',
      title: 'Part Five - The Verdict',
      index: 5,
      parentIndex: 1,
      originallyAvailableAt: '2016-06-18',
      year: 2016,
      summary: 'Part 5 overview.',
      parentRatingKey: 'tmdb-season-66738-1',
      parentKey: '/library/metadata/tmdb-season-66738-1',
      parentGuid: `${ID}://season/tmdb-season-66738-1`,
      parentTitle: 'Season 1',
      grandparentRatingKey: 'tmdb-show-66738',
      grandparentKey: '/library/metadata/tmdb-show-66738',
      grandparentGuid: `${ID}://show/tmdb-show-66738`,
      grandparentTitle: 'O.J.: Made in America',
      Guid: [{ id: 'tmdb://1204' }],
    });

    const byKey = await request(app()).get('/tv/library/metadata/tmdb-episode-66738-1-1').expect(200);
    expect(byKey.body.MediaContainer.Metadata[0].title).toBe('Part One - Obsessed with Fame');

    const season = await request(app()).get('/tv/library/metadata/tmdb-season-66738-1/children').expect(200);
    expect(season.body.MediaContainer).toMatchObject({ size: 5, totalSize: 5 });
    await request(app()).get('/tv/library/metadata/tmdb-episode-66738-1-9').expect(404);
  });

  it('lists TVDB and TMDB candidates together in a manual search, best first', async () => {
    tmdbOj();
    nock(TVDB)
      .persist()
      .post('/v4/login')
      .reply(200, { status: 'success', data: { token: 'tok' } })
      .get('/v4/search')
      .query(true)
      .reply(200, { status: 'success', data: [{ tvdb_id: '314131', name: 'The Real O.J. Simpson Trial', year: '2016' }] })
      .get('/v4/series/314131/extended')
      .query(true)
      .reply(200, { status: 'success', data: { id: 314131, name: 'The Real O.J. Simpson Trial', year: '2016', seasons: [] } })
      .get('/v4/series/314131/episodes/default/eng')
      .query(true)
      .reply(200, { status: 'success', data: { episodes: [] }, links: { next: null } });
    nock(TMDB)
      .get('/3/search/tv')
      .query(true)
      .reply(200, { results: [{ id: 66738, name: 'O.J.: Made in America', first_air_date: '2016-06-11' }] });
    const res = await match({ type: 2, title: 'O.J.: Made in America', year: 2016, manual: 1 }).expect(200);
    expect(res.body.MediaContainer.Metadata.map((m: { ratingKey: string }) => m.ratingKey)).toEqual(['tmdb-show-66738', 'tvdb-show-314131']);
  });
});
