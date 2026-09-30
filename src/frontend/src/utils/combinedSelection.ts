import type { Release } from '../types';

/** Release identity within one search: the same torrent can come from several sources. */
const isSameRelease = (a: Release, b: Release): boolean =>
  a.source === b.source && a.source_id === b.source_id;

/**
 * Click on a release row while picking releases in the combined book + audiobook flow.
 * The audiobook step picks any number (one per narration); the book step picks one.
 */
export const toggleReleaseSelection = (
  selected: Release[],
  release: Release,
  multiple: boolean,
): Release[] => {
  if (selected.some((entry) => isSameRelease(entry, release))) {
    return multiple ? selected.filter((entry) => !isSameRelease(entry, release)) : selected;
  }
  return multiple ? [...selected, release] : [release];
};

export const isReleaseSelected = (selected: Release[], release: Release): boolean =>
  selected.some((entry) => isSameRelease(entry, release));

/**
 * The narrators a release names (MyAnonamouse enrichment), as the backend reads them:
 * a list, a joined string, or null when the release names none.
 */
export const releaseNarrators = (release: Release): string[] | string | null => {
  const narrators: unknown = release.extra?.narrators;
  if (Array.isArray(narrators)) {
    return narrators.filter((name): name is string => typeof name === 'string');
  }
  const narrator: unknown = release.extra?.narrator;
  return typeof narrator === 'string' && narrator.trim() ? narrator : null;
};
