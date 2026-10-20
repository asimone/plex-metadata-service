/**
 * Picks which Plex libraries to sync.
 */

import { PlexSection, ITEM_TYPES_BY_LIBRARY } from '../plex/types';

/** True for library types this service handles (movies and TV). */
export function isSupportedSection(section: PlexSection): boolean {
  return section.type in ITEM_TYPES_BY_LIBRARY;
}

/**
 * Resolves configured library names or section keys against the server's sections.
 * With no selection, returns every movie and show library.
 * Throws if a selected library doesn't exist or isn't a movie/TV library.
 */
export function selectSections(sections: PlexSection[], wanted: string[]): PlexSection[] {
  if (wanted.length === 0) {
    return sections.filter(isSupportedSection);
  }

  const selected: PlexSection[] = [];
  for (const name of wanted) {
    const match = sections.find(s => s.key === name || s.title.toLowerCase() === name.toLowerCase());
    if (!match) {
      const available = sections.map(s => `"${s.title}" (${s.key})`).join(', ');
      throw new Error(`Library "${name}" not found. Available: ${available || 'none'}`);
    }
    if (!isSupportedSection(match)) {
      throw new Error(`Library "${match.title}" is a ${match.type} library; only movie and TV libraries are supported`);
    }
    if (!selected.includes(match)) {
      selected.push(match);
    }
  }
  return selected;
}
