export type LibraryTab = 'all' | 'authors' | 'series';

export interface LibraryRoute {
  tab: LibraryTab;
  name: string | null; // An author or series page, else the list
}

const decode = (segment: string): string => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

/**
 * /library/all, /library/authors[/<name>], /library/series[/<name>]. Bare /library is
 * the tab the user chose to open on.
 */
export const parseLibraryRoute = (
  pathname: string,
  defaultTab: LibraryTab = 'all',
): LibraryRoute => {
  const [, tab, ...rest] = pathname.split('/').filter(Boolean);
  const name = rest.length > 0 ? decode(rest.join('/')) : null;
  if (tab === 'authors' || tab === 'series') return { tab, name };
  if (tab === undefined) return { tab: defaultTab, name: null };
  return { tab: 'all', name: null };
};

export const libraryPath = (tab: LibraryTab, name?: string): string =>
  name && tab !== 'all' ? `/library/${tab}/${encodeURIComponent(name)}` : `/library/${tab}`;
