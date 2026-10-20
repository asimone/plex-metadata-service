import { PlexItem } from '../src/plex/types';
import { ItemRecord } from '../src/store/Store';
import { decide, Winner } from '../src/sync/decide';

const item = (over: Partial<PlexItem> = {}): PlexItem => ({
  ratingKey: '1',
  type: 'movie',
  title: 'Movie',
  summary: 'AI slop.',
  summaryLocked: false,
  plexGuid: 'plex://movie/a',
  externalIds: ['tmdb://105'],
  ...over,
});

const record = (over: Partial<ItemRecord> = {}): ItemRecord => ({
  ratingKey: '1',
  sectionKey: '1',
  type: 'movie',
  title: 'Movie',
  plexGuid: 'plex://movie/a',
  externalId: 'tmdb://105',
  source: 'tmdb',
  writtenSummary: 'Human text.',
  writtenAt: '2026-10-20T00:00:00Z',
  originalSummary: 'AI slop.',
  originalLocked: false,
  status: 'synced',
  ...over,
});

const winner: Winner = { source: 'tmdb', summary: 'Human text.', externalId: 'tmdb://105' };

describe('decide', () => {
  it('writes when the source differs from Plex', () => {
    expect(decide(item(), undefined, winner)).toEqual({ action: 'write', rematched: false });
  });

  it('only locks when Plex already has the same text', () => {
    expect(decide(item({ summary: 'Human  text.' }), undefined, winner).action).toBe('lock');
  });

  it('is unchanged when our text is already there and locked', () => {
    expect(decide(item({ summary: 'Human text.', summaryLocked: true }), record(), winner).action).toBe('unchanged');
  });

  it('leaves Plex alone when no source has a summary', () => {
    expect(decide(item(), undefined, undefined).action).toBe('no-source');
  });

  it('treats a locked summary we never wrote as a manual edit', () => {
    expect(decide(item({ summaryLocked: true }), undefined, winner).action).toBe('user-owned');
  });

  it('treats a locked summary that differs from what we wrote as a manual edit', () => {
    const edited = item({ summary: 'My own words.', summaryLocked: true });
    expect(decide(edited, record(), winner).action).toBe('user-owned');
  });

  it('keeps user-owned items user-owned', () => {
    expect(decide(item(), record({ status: 'user-owned' }), winner).action).toBe('user-owned');
  });

  it('rewrites after a rematch when the locked text is ours from the old match', () => {
    const rematched = item({ plexGuid: 'plex://movie/b', summary: 'Human text.', summaryLocked: true });
    const newWinner = { ...winner, summary: 'The right movie.' };
    expect(decide(rematched, record(), newWinner)).toEqual({ action: 'write', rematched: true });
  });

  it('re-evaluates a user-owned item after a rematch, but still respects a manual lock', () => {
    const unlocked = item({ plexGuid: 'plex://movie/b' });
    expect(decide(unlocked, record({ status: 'user-owned' }), winner).action).toBe('write');

    const locked = item({ plexGuid: 'plex://movie/b', summary: 'Mine.', summaryLocked: true });
    expect(decide(locked, record({ status: 'user-owned', writtenSummary: '' }), winner).action).toBe('user-owned');
  });
});
