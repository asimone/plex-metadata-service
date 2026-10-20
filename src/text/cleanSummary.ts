/**
 * Normalizes summary text from any source.
 * Returns undefined when there is no usable text.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
};

/** Trailing credits like "(Source: Crunchyroll)" or "[Written by MAL Rewrite]". */
const TRAILING_ATTRIBUTION = /\s*[([](?:source|written by|from)\b[^)\]]*[)\]]\s*$/i;

const NO_VALUE = new Set(['', 'n/a', 'na', 'none', 'null', 'tba', 'tbd']);

export function cleanSummary(text: string | null | undefined): string | undefined {
  if (!text) return undefined;

  let s = text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<[^>]+>/g, '');
  s = decodeEntities(s);

  // Strip repeated trailing attributions, e.g. "... (Source: X) [Written by Y]"
  let previous: string;
  do {
    previous = s;
    s = s.replace(TRAILING_ATTRIBUTION, '');
  } while (s !== previous);

  s = s
    .split(/\n{2,}/)
    .map(p => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n');

  return NO_VALUE.has(s.toLowerCase()) ? undefined : s;
}

/** Compares two summaries ignoring whitespace differences. */
export function sameSummary(a: string | undefined, b: string | undefined): boolean {
  const norm = (x: string | undefined) => (x ?? '').replace(/\s+/g, ' ').trim();
  return norm(a) === norm(b);
}

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] === '#') {
      const code = body[1].toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}
