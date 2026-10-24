/**
 * Matching helpers: ID hints from Plex's guid and filename, title normalization and ranking.
 */

export interface IdHints {
  tmdb?: string;
  imdb?: string;
  tvdb?: string;
}

/**
 * Collects external IDs from Plex's `guid` hint (e.g. "imdb://tt0088763") and from
 * tags in the filename/path (e.g. "{tmdb-105}", "[imdbid-tt0088763]", "{tvdb-81189}").
 */
export function idHints(guid?: string, filename?: string): IdHints {
  const hints: IdHints = {};
  const fromGuid = guid?.match(/^(tmdb|imdb|tvdb):\/\/([^/?#]+)/i);
  if (fromGuid) {
    hints[fromGuid[1].toLowerCase() as keyof IdHints] = fromGuid[2];
  }
  if (filename) {
    const tag = /[{[](tmdb|imdb|tvdb)(?:id)?[-=]([a-z0-9]+)[}\]]/gi;
    for (const m of filename.matchAll(tag)) {
      const scheme = m[1].toLowerCase() as keyof IdHints;
      hints[scheme] ??= m[2];
    }
  }
  return hints;
}

/** A 4-digit year in parentheses or brackets in a filename/path, e.g. "Back to the Future (1985).mkv". */
export function yearFromFilename(filename?: string): number | undefined {
  const m = filename?.match(/[([](19\d{2}|20\d{2})[)\]]/);
  return m ? parseInt(m[1], 10) : undefined;
}

/** Lowercase, no accents, "&" → "and", no punctuation, no leading article. */
export function normalizeTitle(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^(the|a|an) /, '');
}

function tokenOverlap(a: string, b: string): number {
  const ta = new Set(a.split(' ').filter(Boolean));
  const tb = new Set(b.split(' ').filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / Math.max(ta.size, tb.size);
}

export interface Candidate {
  title: string;
  originalTitle?: string;
  /** Other known names (translations, aliases). */
  alternateTitles?: string[];
  year?: number;
  popularity?: number;
}

/**
 * Scores how well a candidate fits the requested title and year (higher is better, max ~130).
 */
export function scoreCandidate(wanted: { title: string; year?: number }, c: Candidate): number {
  const want = normalizeTitle(wanted.title);
  const titles = [c.title, c.originalTitle, ...(c.alternateTitles ?? [])].filter((t): t is string => Boolean(t)).map(normalizeTitle);
  // Spacing alone doesn't make titles different: "O.J." normalizes to "o j", "OJ" to "oj".
  const squash = (t: string) => t.replace(/ /g, '');
  const exact = titles.some(t => t === want || squash(t) === squash(want));
  let score = exact ? 100 : Math.max(0, ...titles.map(t => tokenOverlap(want, t))) * 60;

  if (wanted.year && c.year) {
    const diff = Math.abs(wanted.year - c.year);
    score += diff === 0 ? 30 : diff === 1 ? 15 : -20;
  }
  // Popularity only breaks ties.
  score += Math.min(Math.log10((c.popularity ?? 0) + 1), 3);
  return score;
}

/** Sorts candidates best-first by score. */
export function rank<T extends Candidate>(wanted: { title: string; year?: number }, candidates: T[]): T[] {
  return candidates
    .map(c => ({ c, s: scoreCandidate(wanted, c) }))
    .sort((a, b) => b.s - a.s)
    .map(x => x.c);
}
