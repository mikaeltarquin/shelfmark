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

// Mirrors shelfmark/core/release_parts.py: "#1p2" in the series, "Part 2", "Pt. 2",
// "(2 of 5)" or "[2/5]" in the title.
const SERIES_PART = /#\s*\d+(?:\.\d+)?\s*(?:p|pt\.?|part)\s*\d+\b/i;
const TITLE_PARTS = [/\b(?:part|pt\.?)\s*\d+\b/i, /[([]\s*\d+\s*(?:of|\/)\s*\d+\s*[)\]]/i];

/**
 * Whether a release is one part of a book published in parts (GraphicAudio). Each part
 * is filed as its own book, "Title (1 of 5)", so an ebook downloaded with it has no
 * single audiobook folder to go into.
 */
export const isPartRelease = (release: Release): boolean => {
  const series: unknown = release.extra?.series;
  if (typeof series === 'string' && SERIES_PART.test(series)) return true;
  return TITLE_PARTS.some((pattern) => pattern.test(release.title));
};
