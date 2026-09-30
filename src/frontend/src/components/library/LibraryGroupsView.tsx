import { useMemo, useState } from 'react';

import type { LibraryBook } from '../../types';
import { lastFirstName } from '../../utils/authorNames';
import {
  defaultSeriesSortDirection,
  groupBySeries,
  seriesRangeLabel,
  sortSeriesGroups,
  type LibrarySeriesGroup,
  type SeriesSortField,
  type SortDirection,
} from '../../utils/libraryGroups';
import { loadStoredPrefs, saveStoredPrefs } from '../../utils/libraryPrefs';
import { LibraryGroupCard } from './LibraryGroupCard';
import { inputClass } from './libraryStyles';

interface SeriesPrefs {
  sort: SeriesSortField;
  direction: SortDirection;
}

const PREFS_KEY = 'shelfmark.library.series';
const DEFAULT_PREFS: SeriesPrefs = { sort: 'name', direction: 'asc' };

const SORT_OPTIONS: Array<{ value: SeriesSortField; label: string }> = [
  { value: 'name', label: 'Series name' },
  { value: 'author_first', label: 'Author (First Last)' },
  { value: 'author_last', label: 'Author (Last, First)' },
  { value: 'books', label: 'Books' },
  { value: 'added', label: 'Recently added' },
];

const isSortField = (value: unknown): value is SeriesSortField =>
  SORT_OPTIONS.some((option) => option.value === value);

const loadPrefs = (): SeriesPrefs => {
  const raw = loadStoredPrefs(PREFS_KEY);
  if (!raw) return DEFAULT_PREFS;
  const sort: unknown = Reflect.get(raw, 'sort');
  return {
    sort: isSortField(sort) ? sort : DEFAULT_PREFS.sort,
    direction: Reflect.get(raw, 'direction') === 'desc' ? 'desc' : 'asc',
  };
};

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

const fold = (value: string) => value.toLowerCase();

const gridClass = 'grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5';

export const LibrarySeriesView = ({
  books,
  onOpen,
}: {
  books: LibraryBook[];
  onOpen: (series: string) => void;
}) => {
  const [query, setQuery] = useState('');
  const [prefs, setPrefs] = useState<SeriesPrefs>(loadPrefs);
  const groups: LibrarySeriesGroup[] = useMemo(() => groupBySeries(books), [books]);
  const needle = fold(query.trim());
  const visible = sortSeriesGroups(
    groups.filter(
      (group) =>
        fold(group.name).includes(needle) ||
        group.authors.some(
          (author) => fold(author).includes(needle) || fold(lastFirstName(author)).includes(needle),
        ),
    ),
    prefs.sort,
    prefs.direction,
  );
  // Sorting by "Last, First" shows the authors that way too (then ";" separates them).
  const authorLine = (group: LibrarySeriesGroup) =>
    prefs.sort === 'author_last'
      ? group.authors.map(lastFirstName).join('; ')
      : group.authors.join(', ');

  const update = (next: Partial<SeriesPrefs>) => {
    const merged = { ...prefs, ...next };
    setPrefs(merged);
    saveStoredPrefs(PREFS_KEY, merged);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter series or authors"
          aria-label="Filter series or authors"
          className={`${inputClass} w-full sm:w-auto sm:max-w-sm sm:flex-1`}
        />
        <select
          value={prefs.sort}
          onChange={(event) => {
            const value = event.target.value;
            if (isSortField(value)) {
              update({ sort: value, direction: defaultSeriesSortDirection(value) });
            }
          }}
          aria-label="Sort series by"
          className={inputClass}
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              Sort: {option.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => update({ direction: prefs.direction === 'asc' ? 'desc' : 'asc' })}
          className={`${inputClass} hover:bg-(--hover-surface)`}
          aria-label={
            prefs.direction === 'asc'
              ? 'Ascending, switch to descending'
              : 'Descending, switch to ascending'
          }
          title={prefs.direction === 'asc' ? 'Ascending' : 'Descending'}
        >
          {prefs.direction === 'asc' ? '↑ Asc' : '↓ Desc'}
        </button>
      </div>
      {visible.length === 0 ? (
        <p className="text-sm opacity-60">
          {groups.length === 0
            ? 'No book in your library is part of a series.'
            : 'No series match.'}
        </p>
      ) : (
        <div className={gridClass}>
          {visible.map((group) => {
            const range = seriesRangeLabel(group);
            return (
              <LibraryGroupCard
                key={group.name}
                title={group.name}
                subtitle={authorLine(group)}
                detail={
                  range
                    ? `${plural(group.books.length, 'book')} · ${range}`
                    : plural(group.books.length, 'book')
                }
                books={group.books}
                formats={group.formats}
                onOpen={() => onOpen(group.name)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};
