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

/** /library, /library/authors[/<name>], /library/series[/<name>] */
export const parseLibraryRoute = (pathname: string): LibraryRoute => {
  const [, tab, ...rest] = pathname.split('/').filter(Boolean);
  const name = rest.length > 0 ? decode(rest.join('/')) : null;
  if (tab === 'authors' || tab === 'series') return { tab, name };
  return { tab: 'all', name: null };
};

export const libraryPath = (tab: 'authors' | 'series', name?: string): string =>
  name ? `/library/${tab}/${encodeURIComponent(name)}` : `/library/${tab}`;
