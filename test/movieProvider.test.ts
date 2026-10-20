import nock from 'nock';
import request from 'supertest';
import { Config, readConfig } from '../src/config/env';
import { CircuitBreaker } from '../src/resilience/circuitBreaker';
import { HttpSource } from '../src/resilience/http';
import { TmdbMovies } from '../src/providers/movie/TmdbMovies';
import { createApp } from '../src/server';
import { Store } from '../src/store/Store';

const TMDB = 'https://api.themoviedb.org';
const OMDB = 'https://www.omdbapi.com';
const ID = 'tv.plex.agents.custom.simone.movie';

const bttf = {
  id: 105,
  title: 'Back to the Future',
  original_title: 'Back to the Future',
  release_date: '1985-07-03',
  overview: 'Marty McFly, a 17-year-old high school student, is accidentally sent 30 years into the past...',
  poster_path: '/poster.jpg',
  popularity: 50,
  external_ids: { imdb_id: 'tt0088763' },
};

let store: Store;
let config: Config;

function app(omdb = false) {
  config = readConfig({ TMDB_API_KEY: 'key', OMDB_API_KEY: omdb ? 'okey' : '' });
  const tmdbMovies = new TmdbMovies(
    'key',
    store,
    new HttpSource({ baseURL: `${TMDB}/3`, params: { api_key: 'key' }, breaker: new CircuitBreaker('t'), sleep: async () => undefined })
  );
  return createApp(config, store, { tmdbMovies });
}

beforeAll(() => {
  nock.disableNetConnect();
  // supertest talks to the app on localhost
  nock.enableNetConnect('127.0.0.1');
});
beforeEach(() => (store = new Store(':memory:')));
afterEach(() => {
  store.close();
  nock.cleanAll();
});
afterAll(() => nock.enableNetConnect());

describe('GET /movie', () => {
  it('describes a movie-only provider with the permanent identifier', async () => {
    const res = await request(app()).get('/movie').expect(200);
    expect(res.body.MediaProvider).toEqual({
      identifier: ID,
      title: expect.any(String),
      version: expect.any(String),
      Types: [{ type: 1, Scheme: [{ scheme: ID }] }],
      Feature: [
        { type: 'metadata', key: '/library/metadata' },
        { type: 'match', key: '/library/metadata/matches' },
      ],
    });
  });
});

describe('POST /movie/library/metadata/matches', () => {
  it('matches "Back to the Future" (1985) to tmdb-movie-105 by title and year', async () => {
    nock(TMDB)
      .get('/3/search/movie')
      .query(q => q.query === 'Back to the Future' && q.year === '1985')
      .reply(200, {
        results: [
          { id: 165, title: 'Back to the Future Part II', release_date: '1989-11-22', popularity: 40 },
          bttf,
        ],
      });
    const res = await request(app()).post('/movie/library/metadata/matches').send({ type: 1, title: 'Back to the Future', year: 1985 }).expect(200);

    expect(res.body.MediaContainer).toMatchObject({ identifier: ID, size: 1, totalSize: 1, offset: 0 });
    expect(res.body.MediaContainer.Metadata[0]).toMatchObject({
      ratingKey: 'tmdb-movie-105',
      key: '/library/metadata/tmdb-movie-105',
      guid: `${ID}://movie/tmdb-movie-105`,
      type: 'movie',
      title: 'Back to the Future',
      year: 1985,
      originallyAvailableAt: '1985-07-03',
      thumb: 'https://image.tmdb.org/t/p/w500/poster.jpg',
    });
  });

  it('matches imdb://tt0088763 by ID without searching', async () => {
    nock(TMDB)
      .get('/3/find/tt0088763')
      .query(q => q.external_source === 'imdb_id')
      .reply(200, { movie_results: [bttf] });
    const res = await request(app()).post('/movie/library/metadata/matches').send({ type: 1, guid: 'imdb://tt0088763', title: 'Wrong Title' }).expect(200);
    expect(res.body.MediaContainer.Metadata.map((m: { ratingKey: string }) => m.ratingKey)).toEqual(['tmdb-movie-105']);
  });

  it('uses a {tmdb-…} tag in the filename', async () => {
    nock(TMDB).get('/3/movie/105').query(true).reply(200, bttf);
    const res = await request(app())
      .post('/movie/library/metadata/matches')
      .send({ type: 1, title: 'BTTF', filename: '/Movies/Back to the Future (1985) {tmdb-105}/x.mkv' })
      .expect(200);
    expect(res.body.MediaContainer.Metadata[0].ratingKey).toBe('tmdb-movie-105');
  });

  it('returns up to 10 ranked results for manual searches, retrying without the year', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: 1000 + i, title: `Dune ${i}`, release_date: '2000-01-01' }));
    nock(TMDB)
      .get('/3/search/movie')
      .query(q => q.year === '1999')
      .reply(200, { results: [] })
      .get('/3/search/movie')
      .query(q => q.year === undefined)
      .reply(200, { results: [...many, { id: 841, title: 'Dune', release_date: '1984-12-14' }] });
    const res = await request(app()).post('/movie/library/metadata/matches').send({ type: 1, title: 'Dune', year: 1999, manual: 1 }).expect(200);
    expect(res.body.MediaContainer.size).toBe(10);
    expect(res.body.MediaContainer.Metadata[0].ratingKey).toBe('tmdb-movie-841');
  });

  it('filters adult results unless includeAdult=1', async () => {
    nock(TMDB)
      .get('/3/search/movie')
      .query(q => q.include_adult === 'false')
      .reply(200, { results: [{ id: 1, title: 'X', adult: true, release_date: '2000-01-01' }] });
    const res = await request(app()).post('/movie/library/metadata/matches').send({ type: 1, title: 'X' }).expect(200);
    expect(res.body.MediaContainer.size).toBe(0);
  });

  it('rejects other types and empty requests with 400', async () => {
    await request(app()).post('/movie/library/metadata/matches').send({ type: 2, title: 'Show' }).expect(400);
    await request(app()).post('/movie/library/metadata/matches').send({ type: 1 }).expect(400);
  });

  it('returns 500 when TMDB fails', async () => {
    nock(TMDB).get('/3/search/movie').query(true).reply(401);
    await request(app()).post('/movie/library/metadata/matches').send({ type: 1, title: 'X' }).expect(500);
  });
});

describe('GET /movie/library/metadata/:ratingKey', () => {
  it('returns identity, dates, external IDs and the cleaned summary, and nothing else', async () => {
    nock(TMDB)
      .get('/3/movie/105')
      .query({ api_key: 'key', language: 'de-DE', append_to_response: 'external_ids' })
      .reply(200, bttf);
    const res = await request(app()).get('/movie/library/metadata/tmdb-movie-105').set('X-Plex-Language', 'de-DE').expect(200);

    expect(res.body.MediaContainer).toMatchObject({ identifier: ID, size: 1, totalSize: 1 });
    expect(res.body.MediaContainer.Metadata[0]).toEqual({
      ratingKey: 'tmdb-movie-105',
      key: '/library/metadata/tmdb-movie-105',
      guid: `${ID}://movie/tmdb-movie-105`,
      type: 'movie',
      title: 'Back to the Future',
      originallyAvailableAt: '1985-07-03',
      year: 1985,
      summary: bttf.overview,
      Guid: [{ id: 'imdb://tt0088763' }, { id: 'tmdb://105' }],
    });
  });

  it('falls back to OMDb when TMDB has no overview, and omits summary when nobody has one', async () => {
    nock(TMDB).get('/3/movie/105').query(true).reply(200, { ...bttf, overview: '' });
    nock(OMDB).get('/').query(q => q.i === 'tt0088763').reply(200, { Response: 'True', Plot: 'IMDb plot.' });
    const withOmdb = await request(app(true)).get('/movie/library/metadata/tmdb-movie-105').expect(200);
    expect(withOmdb.body.MediaContainer.Metadata[0].summary).toBe('IMDb plot.');

    store.close();
    store = new Store(':memory:');
    nock(TMDB).get('/3/movie/105').query(true).reply(200, { ...bttf, overview: '' });
    const without = await request(app()).get('/movie/library/metadata/tmdb-movie-105').expect(200);
    expect(without.body.MediaContainer.Metadata[0]).not.toHaveProperty('summary');
  });

  it('caches TMDB so a repeat request makes no upstream call', async () => {
    nock(TMDB).get('/3/movie/105').query(true).once().reply(200, bttf);
    const server = app();
    await request(server).get('/movie/library/metadata/tmdb-movie-105').expect(200);
    await request(server).get('/movie/library/metadata/tmdb-movie-105').expect(200);
  });

  it('404s for keys that are not ours or movies TMDB does not know', async () => {
    await request(app()).get('/movie/library/metadata/plex-123').expect(404);
    nock(TMDB).get('/3/movie/999999').query(true).reply(404);
    await request(app()).get('/movie/library/metadata/tmdb-movie-999999').expect(404);
  });

  it('400s for malformed ratingKeys', async () => {
    await request(app()).get('/movie/library/metadata/bad%20key!').expect(400);
  });
});

describe('GET /health', () => {
  it('reports ok without calling upstreams', async () => {
    const res = await request(app()).get('/health').expect(200);
    expect(res.body.status).toBe('ok');
  });
});
