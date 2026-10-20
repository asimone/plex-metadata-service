import nock from 'nock';
import { PlexClient, toPlexItem } from '../src/plex/PlexClient';
import { PlexItem } from '../src/plex/types';

const URL = 'http://plex.test:32400';

function client(pageSize = 2) {
  return new PlexClient({ url: URL, token: 'secret', pageSize });
}

async function collect(gen: AsyncGenerator<PlexItem>): Promise<PlexItem[]> {
  const items: PlexItem[] = [];
  for await (const item of gen) items.push(item);
  return items;
}

beforeAll(() => nock.disableNetConnect());
afterEach(() => nock.cleanAll());
afterAll(() => nock.enableNetConnect());

describe('PlexClient.getSections', () => {
  it('sends the token and maps directories', async () => {
    nock(URL, { reqheaders: { 'X-Plex-Token': 'secret', Accept: 'application/json' } })
      .get('/library/sections')
      .reply(200, {
        MediaContainer: {
          Directory: [
            { key: '1', title: 'Movies', type: 'movie', agent: 'tv.plex.agents.movie' },
            { key: 2, title: 'TV Shows', type: 'show', agent: 'tv.plex.agents.series' },
          ],
        },
      });

    expect(await client().getSections()).toEqual([
      { key: '1', title: 'Movies', type: 'movie', agent: 'tv.plex.agents.movie' },
      { key: '2', title: 'TV Shows', type: 'show', agent: 'tv.plex.agents.series' },
    ]);
  });

  it('explains a rejected token', async () => {
    nock(URL).get('/library/sections').reply(401);
    await expect(client().getSections()).rejects.toThrow(/PLEX_TOKEN/);
  });

  it('explains an unreachable server', async () => {
    nock(URL).get('/library/sections').replyWithError(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }));
    await expect(client().getSections()).rejects.toThrow(/Could not reach Plex/);
  });
});

describe('PlexClient.listItems', () => {
  it('pages through a library with includeGuids', async () => {
    const page = (start: number, ratingKeys: string[]) =>
      nock(URL)
        .get('/library/sections/1/all')
        .query({ type: '1', includeGuids: '1', 'X-Plex-Container-Start': String(start), 'X-Plex-Container-Size': '2' })
        .reply(200, {
          MediaContainer: {
            totalSize: 3,
            Metadata: ratingKeys.map(k => ({ ratingKey: k, type: 'movie', title: `Movie ${k}` })),
          },
        });
    page(0, ['10', '11']);
    page(2, ['12']);

    const items = await collect(client().listItems('1', 'movie'));
    expect(items.map(i => i.ratingKey)).toEqual(['10', '11', '12']);
    expect(nock.isDone()).toBe(true);
  });

  it('stops on a short page when totalSize is missing', async () => {
    nock(URL)
      .get('/library/sections/2/all')
      .query(true)
      .reply(200, { MediaContainer: { Metadata: [{ ratingKey: '1', type: 'show', title: 'Show' }] } });

    const items = await collect(client().listItems('2', 'show'));
    expect(items).toHaveLength(1);
  });

  it('handles an empty library', async () => {
    nock(URL).get('/library/sections/2/all').query(true).reply(200, { MediaContainer: { size: 0 } });
    expect(await collect(client().listItems('2', 'season'))).toEqual([]);
  });
});

describe('PlexClient writes and single items', () => {
  it('sets and locks a summary with a PUT on the section', async () => {
    const scope = nock(URL, { reqheaders: { 'X-Plex-Token': 'secret' } })
      .put('/library/sections/1/all')
      .query({ type: '1', id: '42', 'summary.value': 'Marty & Doc, 1985.', 'summary.locked': '1' })
      .reply(200);
    await client().setSummary('1', { ratingKey: '42', type: 'movie' }, 'Marty & Doc, 1985.', true);
    expect(scope.isDone()).toBe(true);
  });

  it('unlocks with summary.locked=0', async () => {
    const scope = nock(URL)
      .put('/library/sections/2/all')
      .query({ type: '4', id: '7', 'summary.value': 'orig', 'summary.locked': '0' })
      .reply(200);
    await client().setSummary('2', { ratingKey: '7', type: 'episode' }, 'orig', false);
    expect(scope.isDone()).toBe(true);
  });

  it('fetches one item with its section', async () => {
    nock(URL)
      .get('/library/metadata/42')
      .query({ includeGuids: '1' })
      .reply(200, {
        MediaContainer: {
          librarySectionID: 1,
          Metadata: [{ ratingKey: '42', type: 'movie', title: 'BTTF', librarySectionID: 1, Guid: [{ id: 'tmdb://105' }] }],
        },
      });
    const found = await client().getItem('42');
    expect(found?.sectionKey).toBe('1');
    expect(found?.item.externalIds).toEqual(['tmdb://105']);
  });

  it('returns undefined for an unknown item', async () => {
    nock(URL).get('/library/metadata/999').query(true).reply(404);
    await expect(client().getItem('999')).resolves.toBeUndefined();
  });
});

describe('toPlexItem', () => {
  it('maps external IDs, lock state and episode position', () => {
    const item = toPlexItem(
      {
        ratingKey: '500',
        type: 'episode',
        title: "Cat's in the Bag...",
        summary: 'Walt and Jesse...',
        guid: 'plex://episode/abc',
        Guid: [{ id: 'imdb://tt1054724' }, { id: 'tmdb://62086' }, { id: 'tvdb://349233' }],
        Field: [{ name: 'title', locked: true }, { name: 'summary', locked: true }],
        grandparentTitle: 'Breaking Bad',
        parentIndex: 1,
        index: 2,
      },
      'episode'
    );
    expect(item).toMatchObject({
      ratingKey: '500',
      type: 'episode',
      summaryLocked: true,
      plexGuid: 'plex://episode/abc',
      externalIds: ['imdb://tt1054724', 'tmdb://62086', 'tvdb://349233'],
      grandparentTitle: 'Breaking Bad',
      parentIndex: 1,
      index: 2,
    });
  });

  it('defaults missing fields', () => {
    const item = toPlexItem({ ratingKey: '1', type: 'weird' }, 'season');
    expect(item).toMatchObject({ type: 'season', title: '', summary: '', summaryLocked: false, externalIds: [] });
  });

  it('treats only the summary field lock as summaryLocked', () => {
    const item = toPlexItem({ ratingKey: '1', type: 'movie', Field: [{ name: 'title', locked: true }] }, 'movie');
    expect(item.summaryLocked).toBe(false);
  });
});
