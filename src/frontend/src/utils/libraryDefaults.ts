// The Library page's starting tab and each tab's starting sort, chosen under My Account.
// Kept per browser, like the theme. A sort left on "Last used" opens as it was left.

import type { SelectFieldConfig } from '../types/settings';
import type { LibrarySort } from './libraryBrowser';
import type { AuthorSortField, SeriesSortField } from './libraryGroups';
import { loadStoredPrefs, saveStoredPrefs } from './libraryPrefs';
import type { LibraryTab } from './libraryRoute';

const DEFAULTS_KEY = 'shelfmark.library.defaults';
const LAST_USED = 'last';

export const ALL_SORT_OPTIONS: Array<{ value: LibrarySort; label: string }> = [
  { value: 'title', label: 'Title' },
  { value: 'author', label: 'Author' },
  { value: 'added', label: 'Recently added' },
];

export const AUTHOR_SORT_OPTIONS: Array<{ value: AuthorSortField; label: string }> = [
  { value: 'first', label: 'Author (First Last)' },
  { value: 'last', label: 'Author (Last, First)' },
  { value: 'series_order', label: 'Author (First Last) › Series › Book' },
  { value: 'series_order_last', label: 'Author (Last, First) › Series › Book' },
  { value: 'books', label: 'Book Count' },
  { value: 'added', label: 'Recently added' },
];

export const SERIES_SORT_OPTIONS: Array<{ value: SeriesSortField; label: string }> = [
  { value: 'name', label: 'Series name' },
  { value: 'author_first', label: 'Author (First Last)' },
  { value: 'author_last', label: 'Author (Last, First)' },
  { value: 'books', label: 'Book Count' },
  { value: 'added', label: 'Recently added' },
];

const TAB_OPTIONS: Array<{ value: LibraryTab; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'authors', label: 'Authors' },
  { value: 'series', label: 'Series' },
];

export interface LibraryDefaults {
  tab: LibraryTab;
  allSort: LibrarySort | null; // null: last used
  authorsSort: AuthorSortField | null;
  seriesSort: SeriesSortField | null;
}

export type LibraryDefaultKey = keyof LibraryDefaults;

const pick = <T extends string>(options: ReadonlyArray<{ value: T }>, value: unknown): T | null =>
  options.find((option) => option.value === value)?.value ?? null;

export const loadLibraryDefaults = (): LibraryDefaults => {
  const raw = loadStoredPrefs(DEFAULTS_KEY) ?? {};
  return {
    tab: pick(TAB_OPTIONS, Reflect.get(raw, 'tab')) ?? 'all',
    allSort: pick(ALL_SORT_OPTIONS, Reflect.get(raw, 'allSort')),
    authorsSort: pick(AUTHOR_SORT_OPTIONS, Reflect.get(raw, 'authorsSort')),
    seriesSort: pick(SERIES_SORT_OPTIONS, Reflect.get(raw, 'seriesSort')),
  };
};

/** Store one choice from its settings field; "Last used" clears a sort. */
export const setLibraryDefault = (key: LibraryDefaultKey, value: string): void => {
  saveStoredPrefs(DEFAULTS_KEY, {
    ...loadLibraryDefaults(),
    [key]: value === LAST_USED ? null : value,
  });
};

/** The settings field's value for one choice. */
export const libraryDefaultValue = (defaults: LibraryDefaults, key: LibraryDefaultKey): string =>
  defaults[key] ?? LAST_USED;

const lastUsed = { value: LAST_USED, label: 'Last used' };

export const LIBRARY_DEFAULT_FIELDS: Array<{ key: LibraryDefaultKey; field: SelectFieldConfig }> = [
  {
    key: 'tab',
    field: {
      type: 'SelectField',
      key: '_LIBRARY_TAB',
      label: 'Library: default view',
      description: 'The tab the Library opens on.',
      value: 'all',
      options: TAB_OPTIONS,
    },
  },
  {
    key: 'allSort',
    field: {
      type: 'SelectField',
      key: '_LIBRARY_ALL_SORT',
      label: 'Library: All sort',
      description: 'The sort the All tab opens with.',
      value: LAST_USED,
      options: [lastUsed, ...ALL_SORT_OPTIONS],
    },
  },
  {
    key: 'authorsSort',
    field: {
      type: 'SelectField',
      key: '_LIBRARY_AUTHORS_SORT',
      label: 'Library: Authors sort',
      description: 'The sort the Authors tab opens with.',
      value: LAST_USED,
      options: [lastUsed, ...AUTHOR_SORT_OPTIONS],
    },
  },
  {
    key: 'seriesSort',
    field: {
      type: 'SelectField',
      key: '_LIBRARY_SERIES_SORT',
      label: 'Library: Series sort',
      description: 'The sort the Series tab opens with.',
      value: LAST_USED,
      options: [lastUsed, ...SERIES_SORT_OPTIONS],
    },
  },
];
