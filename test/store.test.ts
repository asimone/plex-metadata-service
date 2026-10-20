import { Store } from '../src/store/Store';

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

});
