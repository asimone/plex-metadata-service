import { idHints, normalizeTitle, rank, scoreCandidate, yearFromFilename } from '../src/providers/match';

describe('idHints', () => {
  it('reads the guid hint', () => {
    expect(idHints('imdb://tt0088763')).toEqual({ imdb: 'tt0088763' });
    expect(idHints('tvdb://81189?lang=en')).toEqual({ tvdb: '81189' });
    expect(idHints('plex://movie/abc')).toEqual({});
  });

  it('reads filename tags in common styles, guid first', () => {
    expect(idHints(undefined, 'Movies/Back to the Future (1985) {tmdb-105}/BTTF.mkv')).toEqual({ tmdb: '105' });
    expect(idHints(undefined, 'Movies/BTTF [imdbid-tt0088763].mkv')).toEqual({ imdb: 'tt0088763' });
    expect(idHints('tmdb://1', 'X {tmdb-2} {tvdb-3}.mkv')).toEqual({ tmdb: '1', tvdb: '3' });
  });
});

describe('yearFromFilename', () => {
  it('finds a bracketed year', () => {
    expect(yearFromFilename('/Movies/Back to the Future (1985)/file.mkv')).toBe(1985);
    expect(yearFromFilename('Blade Runner 2049 [2017].mkv')).toBe(2017);
    expect(yearFromFilename('Blade Runner 2049.mkv')).toBeUndefined();
  });
});

describe('normalizeTitle', () => {
  it('ignores case, accents, punctuation, "&" and leading articles', () => {
    expect(normalizeTitle('The Lord of the Rings: The Return of the King')).toBe('lord of the rings the return of the king');
    expect(normalizeTitle('Amélie')).toBe('amelie');
    expect(normalizeTitle('Fast & Furious')).toBe(normalizeTitle('Fast and Furious'));
  });
});

describe('ranking', () => {
  it('prefers the exact title in the right year over a more popular remake', () => {
    const wanted = { title: 'Dune', year: 1984 };
    const ranked = rank(wanted, [
      { title: 'Dune', year: 2021, popularity: 900 },
      { title: 'Dune', year: 1984, popularity: 40 },
      { title: 'Dune: Part Two', year: 2024, popularity: 800 },
    ]);
    expect(ranked.map(r => r.year)).toEqual([1984, 2021, 2024]);
  });

  it('treats titles that differ only in spacing as exact', () => {
    expect(scoreCandidate({ title: 'OJ Made in America' }, { title: 'O.J.: Made in America' })).toBeGreaterThanOrEqual(100);
    expect(scoreCandidate({ title: 'SWAT' }, { title: 'S.W.A.T.' })).toBeGreaterThanOrEqual(100);
    expect(scoreCandidate({ title: 'Made in America' }, { title: 'O.J.: Made in America' })).toBeLessThan(100);
  });

  it('accepts an off-by-one year and matches original titles', () => {
    expect(scoreCandidate({ title: 'Amelie', year: 2002 }, { title: 'Amélie', year: 2001 })).toBeGreaterThan(110);
    expect(scoreCandidate({ title: 'Le Fabuleux Destin d’Amélie Poulain' }, { title: 'Amélie', originalTitle: 'Le Fabuleux Destin d’Amélie Poulain' })).toBeGreaterThanOrEqual(100);
  });
});
