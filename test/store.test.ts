import { ItemRecord, Store } from '../src/store/Store';

describe('Store', () => {
  let now: number;
  let store: Store;

  beforeEach(() => {
    now = Date.parse('2026-10-20T23:59:00Z');
    store = new Store(':memory:', () => now);
  });
  afterEach(() => store.close());

  it('caches values until they expire, including null for not-found', () => {
    store.cacheSet('a', 'text', 1000);
    store.cacheSet('b', null, 1000);
    expect(store.cacheGet('a')).toEqual({ value: 'text' });
    expect(store.cacheGet('b')).toEqual({ value: null });
    expect(store.cacheGet('c')).toBeUndefined();
    expect(store.cacheSize()).toBe(2);

    now += 1000;
    expect(store.cacheGet('a')).toBeUndefined();
  });

  it('counts budget per source per UTC day', () => {
    store.budgetSpend('omdb');
    store.budgetSpend('omdb');
    store.budgetSpend('other');
    expect(store.budgetUsed('omdb')).toBe(2);

    now += 60 * 1000; // past UTC midnight
    expect(store.budgetUsed('omdb')).toBe(0);
  });

  it('saves, reads, lists and deletes item records', () => {
    const record: ItemRecord = {
      ratingKey: '42',
      sectionKey: '1',
      type: 'movie',
      title: 'Back to the Future',
      plexGuid: 'plex://movie/x',
      externalId: 'tmdb://105',
      source: 'tmdb',
      writtenSummary: 'Ours',
      writtenAt: '2026-10-20T00:00:00Z',
      originalSummary: 'Theirs',
      originalLocked: true,
      status: 'synced',
    };
    store.saveItem(record);
    expect(store.getItem('42')).toEqual(record);
    expect(store.allItems()).toEqual([record]);

    store.saveItem({ ...record, status: 'user-owned' });
    expect(store.getItem('42')?.status).toBe('user-owned');

    store.deleteItem('42');
    expect(store.getItem('42')).toBeUndefined();
  });
});
