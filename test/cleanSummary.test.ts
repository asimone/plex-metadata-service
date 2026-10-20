import { cleanSummary, sameSummary } from '../src/text/cleanSummary';

describe('cleanSummary', () => {
  it('strips HTML and decodes entities', () => {
    expect(cleanSummary('<p>Tom &amp; Jerry&#39;s <b>big</b> day&hellip;</p>')).toBe("Tom & Jerry's big day…");
  });

  it('keeps paragraph breaks but collapses other whitespace', () => {
    expect(cleanSummary('First   line\nstill first.<br><br>Second  para.')).toBe('First line still first.\n\nSecond para.');
  });

  it('strips trailing attributions, including several in a row', () => {
    expect(cleanSummary('A story. (Source: Crunchyroll)')).toBe('A story.');
    expect(cleanSummary('A story. [Written by MAL Rewrite]')).toBe('A story.');
    expect(cleanSummary('A story. (Source: X) [Written by Y]')).toBe('A story.');
  });

  it('keeps parentheses that are not attributions', () => {
    expect(cleanSummary('He returns (again).')).toBe('He returns (again).');
  });

  it('treats placeholders and blank text as no value', () => {
    for (const blank of [undefined, null, '', '   ', 'N/A', 'n/a', '<p> </p>', 'TBA']) {
      expect(cleanSummary(blank)).toBeUndefined();
    }
  });
});

describe('sameSummary', () => {
  it('ignores whitespace differences', () => {
    expect(sameSummary(' a  b\nc ', 'a b c')).toBe(true);
    expect(sameSummary('a', 'b')).toBe(false);
    expect(sameSummary(undefined, '')).toBe(true);
  });
});
