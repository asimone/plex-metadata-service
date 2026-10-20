import { PlexClient } from '../src/plex/PlexClient';
import { PlexItem, PlexItemType, PlexSection } from '../src/plex/types';
import { selectSections } from '../src/sync/libraries';
import { displayTitle, formatItem, formatReport, idScheme, runDryRun } from '../src/sync/dryRun';

const sections: PlexSection[] = [
  { key: '1', title: 'Movies', type: 'movie' },
  { key: '2', title: 'TV Shows', type: 'show' },
  { key: '3', title: 'Music', type: 'artist' },
];

function item(partial: Partial<PlexItem> & Pick<PlexItem, 'type'>): PlexItem {
  return { ratingKey: '1', title: 'T', summary: 'S', summaryLocked: false, externalIds: [], ...partial };
}

/** A fake PlexClient whose listItems yields canned items per section and type. */
function fakeClient(items: Record<string, Partial<Record<PlexItemType, PlexItem[]>>>): PlexClient {
  return {
    async *listItems(sectionKey: string, type: PlexItemType) {
      yield* items[sectionKey]?.[type] ?? [];
    },
  } as unknown as PlexClient;
}

describe('selectSections', () => {
  it('defaults to every movie and show library', () => {
    expect(selectSections(sections, []).map(s => s.title)).toEqual(['Movies', 'TV Shows']);
  });

  it('matches by name (case-insensitive) or key, without duplicates', () => {
    expect(selectSections(sections, ['tv shows', '1', 'Movies']).map(s => s.key)).toEqual(['2', '1']);
  });

  it('rejects unknown and unsupported libraries', () => {
    expect(() => selectSections(sections, ['Anime'])).toThrow(/not found.*"Movies" \(1\)/);
    expect(() => selectSections(sections, ['Music'])).toThrow(/artist library/);
  });
});

describe('runDryRun', () => {
  it('counts IDs, locks and empty summaries per type', async () => {
    const client = fakeClient({
      '1': {
        movie: [
          item({ type: 'movie', externalIds: ['imdb://tt0088763', 'tmdb://105'] }),
          item({ type: 'movie', externalIds: ['plex://movie/x'], summary: ' ', summaryLocked: true }),
        ],
      },
      '2': {
        show: [item({ type: 'show', externalIds: ['tvdb://81189', 'tmdb://1396'] })],
        season: [item({ type: 'season', externalIds: [] })],
        episode: [item({ type: 'episode', externalIds: ['tvdb://349232', 'tvdb://349232'] })],
      },
    });

    const seen: string[] = [];
    const reports = await runDryRun(client, sections.slice(0, 2), { onItem: i => seen.push(i.type) });

    expect(seen).toEqual(['movie', 'movie', 'show', 'season', 'episode']);
    expect(reports[0].types.movie).toEqual({
      total: 2,
      withId: { tvdb: 0, tmdb: 1, imdb: 1 },
      noUsableId: 1,
      summaryLocked: 1,
      emptySummary: 1,
    });
    expect(reports[1].types.season?.noUsableId).toBe(1);
    expect(reports[1].types.episode?.withId.tvdb).toBe(1);

    const table = formatReport(reports);
    expect(table).toContain('Movies (section 1, movie');
    expect(table).toMatch(/episode\s+1\s+1\s+0\s+0/);
  });
});

describe('formatting', () => {
  it('recognises ID schemes', () => {
    expect(idScheme('tvdb://1')).toBe('tvdb');
    expect(idScheme('plex://movie/1')).toBeUndefined();
  });

  it('titles each type', () => {
    expect(displayTitle(item({ type: 'movie', title: 'Back to the Future', year: 1985 }))).toBe('Back to the Future (1985)');
    expect(displayTitle(item({ type: 'season', title: 'Season 2', parentTitle: 'Breaking Bad' }))).toBe('Breaking Bad / Season 2');
    expect(displayTitle(item({ type: 'episode', title: 'Pilot', grandparentTitle: 'Breaking Bad', parentIndex: 1, index: 1 }))).toBe(
      'Breaking Bad S01E01 Pilot'
    );
  });

  it('flags locked and empty summaries', () => {
    const line = formatItem(item({ type: 'movie', ratingKey: '42', summary: '', summaryLocked: true }));
    expect(line).toContain('(no external IDs)');
    expect(line).toContain('[locked, no-summary]');
  });
});
