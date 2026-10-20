import { PlexClient } from '../src/plex/PlexClient';
import { PlexItem, PlexItemType, PlexSection } from '../src/plex/types';
import { SourceLookup, SummarySource } from '../src/sources/SummarySource';
import { Store } from '../src/store/Store';
import { Outcome, SummarySync } from '../src/sync/SummarySync';

const movie = (over: Partial<PlexItem> = {}): PlexItem => ({
  ratingKey: '10',
  type: 'movie',
  title: 'Back to the Future',
  summary: 'AI slop.',
  summaryLocked: false,
  plexGuid: 'plex://movie/a',
  externalIds: ['imdb://tt0088763', 'tmdb://105'],
  ...over,
});

/** A source that answers from a map keyed by ratingKey. */
function source(name: 'tmdb' | 'omdb', answers: Record<string, SourceLookup>): SummarySource {
  return { name, getSummary: async item => answers[item.ratingKey] ?? { status: 'no-id' } };
}

interface Write {
  sectionKey: string;
  ratingKey: string;
  summary: string;
  locked: boolean;
}

function fakePlex(items: PlexItem[] = []) {
  const writes: Write[] = [];
  const plex = {
    async *listItems(_section: string, type: PlexItemType) {
      yield* items.filter(i => i.type === type);
    },
    async setSummary(sectionKey: string, item: Pick<PlexItem, 'ratingKey'>, summary: string, locked: boolean) {
      writes.push({ sectionKey, ratingKey: item.ratingKey, summary, locked });
    },
  } as unknown as PlexClient;
  return { plex, writes };
}

const found = (summary: string, externalId = 'tmdb://105'): SourceLookup => ({ status: 'found', summary, externalId });

let store: Store;
beforeEach(() => (store = new Store(':memory:')));
afterEach(() => store.close());

describe('SummarySync', () => {
  it('uses the first source with a summary', async () => {
    const { plex } = fakePlex();
    const sync = new SummarySync(plex, store, [
      source('tmdb', { '10': { status: 'not-found', externalId: 'tmdb://105' } }),
      source('omdb', { '10': found('IMDb plot.', 'imdb://tt0088763') }),
    ]);
    const { winner, lookups } = await sync.resolve(movie());
    expect(winner).toEqual({ source: 'omdb', summary: 'IMDb plot.', externalId: 'imdb://tt0088763' });
    expect(lookups.map(l => l.source)).toEqual(['tmdb', 'omdb']);
  });

  it('does not write in a dry run', async () => {
    const { plex, writes } = fakePlex();
    const sync = new SummarySync(plex, store, [source('tmdb', { '10': found('Human text.') })]);
    const outcome = await sync.syncItem(movie(), '1', { write: false });
    expect(outcome).toMatchObject({ action: 'write', written: false });
    expect(writes).toEqual([]);
    expect(store.getItem('10')).toBeUndefined();
  });

  it('writes, locks and records the original, then is unchanged on the next run', async () => {
    const { plex, writes } = fakePlex();
    const sync = new SummarySync(plex, store, [source('tmdb', { '10': found('Human text.') })]);

    const outcome = await sync.syncItem(movie(), '1', { write: true });
    expect(outcome).toMatchObject({ action: 'write', written: true });
    expect(writes).toEqual([{ sectionKey: '1', ratingKey: '10', summary: 'Human text.', locked: true }]);
    expect(store.getItem('10')).toMatchObject({
      writtenSummary: 'Human text.',
      originalSummary: 'AI slop.',
      originalLocked: false,
      status: 'synced',
      source: 'tmdb',
    });

    const again = await sync.syncItem(movie({ summary: 'Human text.', summaryLocked: true }), '1', { write: true });
    expect(again.action).toBe('unchanged');
    expect(writes).toHaveLength(1);
  });

  it('records a manual edit as user-owned and never writes it', async () => {
    const { plex, writes } = fakePlex();
    const sync = new SummarySync(plex, store, [source('tmdb', { '10': found('Human text.') })]);
    const edited = movie({ summary: 'My words.', summaryLocked: true });

    expect((await sync.syncItem(edited, '1', { write: true })).action).toBe('user-owned');
    expect(store.getItem('10')?.status).toBe('user-owned');
    expect(writes).toEqual([]);
  });

  it('restores the original summary and lock state, then forgets the item', async () => {
    const { plex, writes } = fakePlex();
    const sync = new SummarySync(plex, store, [source('tmdb', { '10': found('Human text.') })]);
    await sync.syncItem(movie(), '1', { write: true });

    await expect(sync.restore('10')).resolves.toBe(true);
    expect(writes[1]).toEqual({ sectionKey: '1', ratingKey: '10', summary: 'AI slop.', locked: false });
    expect(store.getItem('10')).toBeUndefined();
    await expect(sync.restore('10')).resolves.toBe(false);
  });

  it('keeps the first backup when rewriting after a rematch', async () => {
    const { plex } = fakePlex();
    const answers: Record<string, SourceLookup> = { '10': found('Human text.') };
    const sync = new SummarySync(plex, store, [source('tmdb', answers)]);
    await sync.syncItem(movie(), '1', { write: true });

    answers['10'] = found('Correct movie text.', 'tmdb://999');
    const rematched = movie({ plexGuid: 'plex://movie/b', summary: 'Human text.', summaryLocked: true });
    const outcome = await sync.syncItem(rematched, '1', { write: true });
    expect(outcome).toMatchObject({ action: 'write', rematched: true, written: true });
    expect(store.getItem('10')).toMatchObject({ originalSummary: 'AI slop.', writtenSummary: 'Correct movie text.', plexGuid: 'plex://movie/b' });
  });

  it('syncs a library, counting outcomes and skipping types without sources', async () => {
    const items = [
      movie({ ratingKey: '1' }),
      movie({ ratingKey: '2', summary: 'Same.' }),
      movie({ ratingKey: '3' }),
      movie({ ratingKey: '4', summary: 'Mine.', summaryLocked: true }),
    ];
    const { plex, writes } = fakePlex(items);
    const sync = new SummarySync(plex, store, [source('tmdb', { '1': found('New.'), '2': found('Same.'), '4': found('X.') })]);

    const sections: PlexSection[] = [
      { key: '1', title: 'Movies', type: 'movie' },
      { key: '2', title: 'TV', type: 'show' },
    ];
    const seen: Outcome[] = [];
    const counts = await sync.syncSections(sections, { write: true, onOutcome: o => seen.push(o) });

    expect(counts).toEqual({ write: 1, lock: 1, unchanged: 0, 'user-owned': 1, 'no-source': 1, errors: 0 });
    expect(writes.map(w => w.ratingKey)).toEqual(['1', '2']);
    expect(seen).toHaveLength(4);
  });

  it('reports a failed write as an error without recording it', async () => {
    const { plex } = fakePlex();
    (plex as unknown as { setSummary: () => Promise<void> }).setSummary = async () => {
      throw new Error('Plex returned 500');
    };
    const sync = new SummarySync(plex, store, [source('tmdb', { '10': found('Human text.') })]);
    const outcome = await sync.syncItem(movie(), '1', { write: true });
    expect(outcome.error).toBe('Plex returned 500');
    expect(store.getItem('10')).toBeUndefined();
  });

  it('spaces writes out by the write interval', async () => {
    const { plex } = fakePlex();
    const sleeps: number[] = [];
    const sync = new SummarySync(plex, store, [source('tmdb', { '1': found('A.'), '2': found('B.') })], async ms => {
      sleeps.push(ms);
    });
    await sync.syncItem(movie({ ratingKey: '1' }), '1', { write: true, writeIntervalMs: 200 });
    await sync.syncItem(movie({ ratingKey: '2' }), '1', { write: true, writeIntervalMs: 200 });
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBeGreaterThan(0);
    expect(sleeps[0]).toBeLessThanOrEqual(200);
  });
});
