import nock from 'nock';
import { PlexItem } from '../src/plex/types';
import { CircuitBreaker } from '../src/resilience/circuitBreaker';
import { HttpSource } from '../src/resilience/http';
import { OmdbSource } from '../src/sources/omdb/OmdbSource';
import { TmdbSource } from '../src/sources/tmdb/TmdbSource';
import { Store } from '../src/store/Store';

const TMDB = 'https://api.themoviedb.org';
const OMDB = 'https://www.omdbapi.com';

const movie = (externalIds: string[]): PlexItem => ({
  ratingKey: '1',
  type: 'movie',
  title: 'Back to the Future',
  summary: '',
  summaryLocked: false,
  externalIds,
});

const noSleep = async () => undefined;

let store: Store;
beforeAll(() => nock.disableNetConnect());
beforeEach(() => (store = new Store(':memory:')));
afterEach(() => {
  store.close();
  nock.cleanAll();
});
afterAll(() => nock.enableNetConnect());

describe('TmdbSource', () => {
  const tmdb = () =>
    new TmdbSource({
      apiKey: 'key',
      language: 'en-US',
      store,
      http: new HttpSource({
        baseURL: `${TMDB}/3`,
        params: { api_key: 'key' },
        breaker: new CircuitBreaker('tmdb'),
        sleep: noSleep,
      }),
    });

  it('looks up by tmdb:// ID and caches the result', async () => {
    nock(TMDB)
      .get('/3/movie/105')
      .query({ api_key: 'key', language: 'en-US' })
      .once()
      .reply(200, { id: 105, overview: 'Marty McFly, a 17-year-old <i>high school</i> student...' });

    const source = tmdb();
    const first = await source.getSummary(movie(['imdb://tt0088763', 'tmdb://105']));
    expect(first).toEqual({ status: 'found', summary: 'Marty McFly, a 17-year-old high school student...', externalId: 'tmdb://105' });

    // Second lookup is served from the cache (nock would fail on a second request).
    await expect(source.getSummary(movie(['tmdb://105']))).resolves.toEqual(first);
  });

  it('falls back to /find for imdb:// IDs', async () => {
    nock(TMDB)
      .get('/3/find/tt11645818')
      .query({ api_key: 'key', external_source: 'imdb_id', language: 'en-US' })
      .reply(200, { movie_results: [{ id: 1, overview: 'A painter...' }] });
    await expect(tmdb().getSummary(movie(['imdb://tt11645818']))).resolves.toEqual({
      status: 'found',
      summary: 'A painter...',
      externalId: 'imdb://tt11645818',
    });
  });

  it('reports not-found for a 404 or empty overview', async () => {
    nock(TMDB).get('/3/movie/1').query(true).reply(404).get('/3/movie/2').query(true).reply(200, { id: 2, overview: '' });
    await expect(tmdb().getSummary(movie(['tmdb://1']))).resolves.toEqual({ status: 'not-found', externalId: 'tmdb://1' });
    await expect(tmdb().getSummary(movie(['tmdb://2']))).resolves.toEqual({ status: 'not-found', externalId: 'tmdb://2' });
  });

  it('needs a usable ID', async () => {
    await expect(tmdb().getSummary(movie(['plex://movie/x']))).resolves.toEqual({ status: 'no-id' });
    // Seasons have no IMDb lookup, and Plex's tmdb:// on a season isn't directly fetchable.
    await expect(tmdb().getSummary({ ...movie(['tmdb://1', 'imdb://tt1']), type: 'season' })).resolves.toEqual({ status: 'no-id' });
  });

  it('looks up shows directly by tmdb:// ID', async () => {
    nock(TMDB).get('/3/tv/1396').query({ api_key: 'key', language: 'en-US' }).reply(200, { overview: 'Walter White...' });
    await expect(tmdb().getSummary({ ...movie(['tvdb://81189', 'tmdb://1396']), type: 'show' })).resolves.toEqual({
      status: 'found',
      summary: 'Walter White...',
      externalId: 'tmdb://1396',
    });
  });

  it('finds seasons and episodes by tvdb:// ID', async () => {
    nock(TMDB)
      .get('/3/find/349232')
      .query({ api_key: 'key', external_source: 'tvdb_id', language: 'en-US' })
      .reply(200, { tv_episode_results: [{ overview: 'Pilot text.' }] })
      .get('/3/find/30272')
      .query({ api_key: 'key', external_source: 'tvdb_id', language: 'en-US' })
      .reply(200, { tv_season_results: [] });
    await expect(tmdb().getSummary({ ...movie(['tmdb://62085', 'tvdb://349232']), type: 'episode' })).resolves.toEqual({
      status: 'found',
      summary: 'Pilot text.',
      externalId: 'tvdb://349232',
    });
    await expect(tmdb().getSummary({ ...movie(['tvdb://30272']), type: 'season' })).resolves.toEqual({
      status: 'not-found',
      externalId: 'tvdb://30272',
    });
  });

  it('reports failures as unavailable', async () => {
    nock(TMDB).get('/3/movie/105').query(true).reply(401);
    await expect(tmdb().getSummary(movie(['tmdb://105']))).resolves.toEqual({ status: 'unavailable', reason: 'tmdb: HTTP 401' });
  });
});

describe('OmdbSource', () => {
  const omdb = (dailyCap = 900) =>
    new OmdbSource({
      apiKey: 'key',
      dailyCap,
      store,
      http: new HttpSource({ baseURL: OMDB, params: { apikey: 'key' }, breaker: new CircuitBreaker('omdb'), sleep: noSleep }),
    });

  it('looks up the full plot by imdb:// ID and spends budget once', async () => {
    nock(OMDB).get('/').query({ apikey: 'key', i: 'tt0088763', plot: 'full' }).once().reply(200, { Response: 'True', Plot: 'Marty...' });
    const source = omdb();
    const expected = { status: 'found', summary: 'Marty...', externalId: 'imdb://tt0088763' };
    await expect(source.getSummary(movie(['imdb://tt0088763']))).resolves.toEqual(expected);
    await expect(source.getSummary(movie(['imdb://tt0088763']))).resolves.toEqual(expected);
    expect(source.budgetUsed()).toBe(1);
  });

  it('treats Response False and "N/A" plots as not found', async () => {
    nock(OMDB)
      .get('/')
      .query(q => q.i === 'tt1')
      .reply(200, { Response: 'False', Error: 'Incorrect IMDb ID.' })
      .get('/')
      .query(q => q.i === 'tt2')
      .reply(200, { Response: 'True', Plot: 'N/A' });
    await expect(omdb().getSummary(movie(['imdb://tt1']))).resolves.toMatchObject({ status: 'not-found' });
    await expect(omdb().getSummary(movie(['imdb://tt2']))).resolves.toMatchObject({ status: 'not-found' });
  });

  it('stops at the daily cap', async () => {
    store.budgetSpend('omdb');
    await expect(omdb(1).getSummary(movie(['imdb://tt0088763']))).resolves.toEqual({
      status: 'unavailable',
      reason: 'omdb: daily cap of 1 reached',
    });
  });

  it('needs an imdb:// ID', async () => {
    await expect(omdb().getSummary(movie(['tmdb://105']))).resolves.toEqual({ status: 'no-id' });
  });
});
