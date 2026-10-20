import nock from 'nock';
import { PlexItem } from '../src/plex/types';
import { CircuitBreaker } from '../src/resilience/circuitBreaker';
import { HttpSource } from '../src/resilience/http';
import { TvdbSource, tvdbLanguage } from '../src/sources/tvdb/TvdbSource';
import { Store } from '../src/store/Store';

const TVDB = 'https://api4.thetvdb.com';

const item = (type: PlexItem['type'], externalIds: string[]): PlexItem => ({
  ratingKey: '1',
  type,
  title: 'Breaking Bad',
  summary: '',
  summaryLocked: false,
  externalIds,
});

let store: Store;
beforeAll(() => nock.disableNetConnect());
beforeEach(() => (store = new Store(':memory:')));
afterEach(() => {
  store.close();
  nock.cleanAll();
});
afterAll(() => nock.enableNetConnect());

function tvdb(pin?: string) {
  return new TvdbSource({
    apiKey: 'key',
    pin,
    language: 'en-US',
    store,
    http: new HttpSource({ baseURL: `${TVDB}/v4`, breaker: new CircuitBreaker('tvdb'), sleep: async () => undefined }),
  });
}

function login(token = 'tok', body: Record<string, string> = { apikey: 'key' }) {
  return nock(TVDB).post('/v4/login', body).reply(200, { status: 'success', data: { token } });
}

describe('tvdbLanguage', () => {
  it('maps ISO codes to TVDB codes, defaulting to English', () => {
    expect(tvdbLanguage('en-US')).toBe('eng');
    expect(tvdbLanguage('de-DE')).toBe('deu');
    expect(tvdbLanguage('xx')).toBe('eng');
  });
});

describe('TvdbSource', () => {
  it('logs in once and fetches each type by its own TVDB ID', async () => {
    login();
    const auth = { reqheaders: { Authorization: 'Bearer tok' } };
    nock(TVDB, auth)
      .get('/v4/series/81189/translations/eng')
      .reply(200, { status: 'success', data: { name: 'Breaking Bad', overview: 'When Walter White...' } })
      .get('/v4/seasons/30272/translations/eng')
      .reply(200, { status: 'success', data: { overview: 'Season one.' } })
      .get('/v4/episodes/349232/translations/eng')
      .reply(200, { status: 'success', data: { overview: 'Pilot.' } });

    const source = tvdb();
    await expect(source.getSummary(item('show', ['tmdb://1396', 'tvdb://81189']))).resolves.toEqual({
      status: 'found',
      summary: 'When Walter White...',
      externalId: 'tvdb://81189',
    });
    await expect(source.getSummary(item('season', ['tvdb://30272']))).resolves.toMatchObject({ summary: 'Season one.' });
    await expect(source.getSummary(item('episode', ['tvdb://349232']))).resolves.toMatchObject({ summary: 'Pilot.' });
    expect(nock.isDone()).toBe(true);
  });

  it('sends the PIN when configured', async () => {
    const scope = login('tok', { apikey: 'key', pin: '1234' });
    nock(TVDB).get('/v4/series/1/translations/eng').reply(200, { status: 'success', data: { overview: 'x' } });
    await tvdb('1234').getSummary(item('show', ['tvdb://1']));
    expect(scope.isDone()).toBe(true);
  });

  it('reuses a cached token across instances', async () => {
    store.cacheSet('tvdb:token', 'cached', 60_000);
    nock(TVDB, { reqheaders: { Authorization: 'Bearer cached' } })
      .get('/v4/series/1/translations/eng')
      .reply(200, { status: 'success', data: { overview: 'x' } });
    await expect(tvdb().getSummary(item('show', ['tvdb://1']))).resolves.toMatchObject({ status: 'found' });
  });

  it('logs in again when the token is rejected', async () => {
    store.cacheSet('tvdb:token', 'stale', 60_000);
    nock(TVDB, { reqheaders: { Authorization: 'Bearer stale' } }).get('/v4/series/1/translations/eng').reply(401);
    login('fresh');
    nock(TVDB, { reqheaders: { Authorization: 'Bearer fresh' } })
      .get('/v4/series/1/translations/eng')
      .reply(200, { status: 'success', data: { overview: 'x' } });
    await expect(tvdb().getSummary(item('show', ['tvdb://1']))).resolves.toMatchObject({ status: 'found' });
    expect(store.cacheGet('tvdb:token')).toEqual({ value: 'fresh' });
  });

  it('treats a missing translation as not found, and caches it', async () => {
    login();
    nock(TVDB).get('/v4/seasons/5/translations/eng').once().reply(404, { status: 'failure', data: null });
    const source = tvdb();
    const expected = { status: 'not-found', externalId: 'tvdb://5' };
    await expect(source.getSummary(item('season', ['tvdb://5']))).resolves.toEqual(expected);
    await expect(source.getSummary(item('season', ['tvdb://5']))).resolves.toEqual(expected);
  });

  it('needs a tvdb:// ID and a TV item', async () => {
    await expect(tvdb().getSummary(item('show', ['tmdb://1']))).resolves.toEqual({ status: 'no-id' });
    await expect(tvdb().getSummary(item('movie', ['tvdb://1']))).resolves.toEqual({ status: 'no-id' });
  });

  it('reports a failed login as unavailable', async () => {
    nock(TVDB).post('/v4/login').reply(401, { status: 'failure' });
    await expect(tvdb().getSummary(item('show', ['tvdb://1']))).resolves.toEqual({ status: 'unavailable', reason: 'tvdb: HTTP 401' });
  });
});
