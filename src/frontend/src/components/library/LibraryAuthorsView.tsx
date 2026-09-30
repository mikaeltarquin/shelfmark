import { useMemo, useState } from 'react';

import type { LibraryBook } from '../../types';
import { lastFirstName } from '../../utils/authorNames';
import {
  defaultAuthorSortDirection,
  groupByAuthor,
  sortAuthorGroups,
  type AuthorSortField,
  type LibraryAuthorGroup,
  type SortDirection,
} from '../../utils/libraryGroups';
import { LibraryFormatBadges } from './LibraryBookCard';
import { LibraryGroupCard } from './LibraryGroupCard';
import { inputClass, segmentClass } from './libraryStyles';

type AuthorView = 'grid' | 'table';

interface AuthorPrefs {
  sort: AuthorSortField;
  direction: SortDirection;
  view: AuthorView;
}

const PREFS_KEY = 'shelfmark.library.authors';
const DEFAULT_PREFS: AuthorPrefs = { sort: 'first', direction: 'asc', view: 'grid' };

const SORT_OPTIONS: Array<{ value: AuthorSortField; label: string }> = [
  { value: 'first', label: 'First Last' },
  { value: 'last', label: 'Last, First' },
  { value: 'books', label: 'Books' },
  { value: 'series', label: 'Series' },
  { value: 'added', label: 'Recently added' },
];

const isSortField = (value: unknown): value is AuthorSortField =>
  SORT_OPTIONS.some((option) => option.value === value);

// Remembered per browser, as a convenience; any problem falls back to the defaults.
const loadPrefs = (): AuthorPrefs => {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null');
    if (raw && typeof raw === 'object') {
      const sort: unknown = Reflect.get(raw, 'sort');
      return {
        sort: isSortField(sort) ? sort : DEFAULT_PREFS.sort,
        direction: Reflect.get(raw, 'direction') === 'desc' ? 'desc' : 'asc',
        view: Reflect.get(raw, 'view') === 'table' ? 'table' : 'grid',
      };
    }
  } catch {
    // Storage blocked or unreadable.
  }
  return DEFAULT_PREFS;
};

const savePrefs = (prefs: AuthorPrefs) => {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Not remembered, which is fine.
  }
};

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

const formatDate = (seconds: number | null): string =>
  seconds ? new Date(seconds * 1000).toLocaleDateString() : '—';

const groupDetail = (group: LibraryAuthorGroup): string =>
  group.seriesCount > 0
    ? `${plural(group.books.length, 'book')} · ${group.seriesCount} series`
    : plural(group.books.length, 'book');

interface SortHeaderProps {
  label: string;
  field: AuthorSortField;
  prefs: AuthorPrefs;
  onSort: (field: AuthorSortField) => void;
  align?: 'left' | 'right';
}

const SortHeader = ({ label, field, prefs, onSort, align = 'left' }: SortHeaderProps) => {
  const active = prefs.sort === field;
  let ariaSort: 'ascending' | 'descending' | 'none' = 'none';
  if (active) ariaSort = prefs.direction === 'asc' ? 'ascending' : 'descending';
  return (
    <th
      scope="col"
      aria-sort={ariaSort}
      className={`px-3 py-2 font-medium ${align === 'right' ? 'text-right' : 'text-left'}`}
    >
      <button
        type="button"
        onClick={() => onSort(field)}
        className={`inline-flex items-center gap-1 hover:underline ${active ? '' : 'opacity-70'}`}
      >
        {label}
        {active && <span aria-hidden="true">{prefs.direction === 'asc' ? '▲' : '▼'}</span>}
      </button>
    </th>
  );
};

/** Every author, as cards or a sortable table. */
export const LibraryAuthorsView = ({
  books,
  onOpen,
}: {
  books: LibraryBook[];
  onOpen: (author: string) => void;
}) => {
  const [query, setQuery] = useState('');
  const [prefs, setPrefs] = useState<AuthorPrefs>(loadPrefs);
  const groups = useMemo(() => groupByAuthor(books), [books]);

  const lastFirst = prefs.sort === 'last';
  const displayName = (group: LibraryAuthorGroup) =>
    lastFirst ? lastFirstName(group.name) : group.name;

  const needle = query.trim().toLowerCase();
  const visible = sortAuthorGroups(
    groups.filter(
      (group) =>
        group.name.toLowerCase().includes(needle) ||
        lastFirstName(group.name).toLowerCase().includes(needle),
    ),
    prefs.sort,
    prefs.direction,
  );

  const update = (next: Partial<AuthorPrefs>) => {
    const merged = { ...prefs, ...next };
    setPrefs(merged);
    savePrefs(merged);
  };
  // Picking a field starts it in its natural direction; picking it again flips it.
  const sortBy = (field: AuthorSortField) =>
    update(
      field === prefs.sort
        ? { direction: prefs.direction === 'asc' ? 'desc' : 'asc' }
        : { sort: field, direction: defaultAuthorSortDirection(field) },
    );
  const nameField: AuthorSortField = lastFirst ? 'last' : 'first';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter authors"
          aria-label="Filter authors"
          className={`${inputClass} w-full sm:w-auto sm:max-w-sm sm:flex-1`}
        />
        <select
          value={prefs.sort}
          onChange={(event) => {
            const value = event.target.value;
            if (isSortField(value)) {
              update({ sort: value, direction: defaultAuthorSortDirection(value) });
            }
          }}
          aria-label="Sort authors by"
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
        <div className="flex gap-1" role="group" aria-label="Layout">
          <button
            type="button"
            className={segmentClass(prefs.view === 'grid')}
            aria-pressed={prefs.view === 'grid'}
            onClick={() => update({ view: 'grid' })}
          >
            Grid
          </button>
          <button
            type="button"
            className={segmentClass(prefs.view === 'table')}
            aria-pressed={prefs.view === 'table'}
            onClick={() => update({ view: 'table' })}
          >
            Table
          </button>
        </div>
      </div>

      {visible.length === 0 && <p className="text-sm opacity-60">No authors match.</p>}

      {visible.length > 0 && prefs.view === 'grid' && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {visible.map((group) => (
            <LibraryGroupCard
              key={group.name}
              title={displayName(group)}
              detail={groupDetail(group)}
              books={group.books}
              formats={group.formats}
              onOpen={() => onOpen(group.name)}
            />
          ))}
        </div>
      )}

      {visible.length > 0 && prefs.view === 'table' && (
        <div className="overflow-x-auto rounded-xl" style={{ background: 'var(--bg-soft)' }}>
          <table className="w-full text-sm">
            <thead className="border-b border-(--border-muted)">
              <tr>
                <SortHeader
                  label={lastFirst ? 'Author (Last, First)' : 'Author'}
                  field={nameField}
                  prefs={prefs}
                  onSort={sortBy}
                />
                <SortHeader
                  label="Books"
                  field="books"
                  prefs={prefs}
                  onSort={sortBy}
                  align="right"
                />
                <th scope="col" className="px-3 py-2 text-right font-medium opacity-70">
                  Ebooks
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium opacity-70">
                  Audiobooks
                </th>
                <SortHeader
                  label="Series"
                  field="series"
                  prefs={prefs}
                  onSort={sortBy}
                  align="right"
                />
                <th
                  scope="col"
                  className="px-3 py-2 text-left font-medium opacity-70 max-sm:hidden"
                >
                  Formats
                </th>
                <SortHeader
                  label="Last added"
                  field="added"
                  prefs={prefs}
                  onSort={sortBy}
                  align="right"
                />
              </tr>
            </thead>
            <tbody>
              {visible.map((group) => (
                <tr
                  key={group.name}
                  className="border-b border-(--border-muted) last:border-0 hover:bg-(--hover-surface)"
                >
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => onOpen(group.name)}
                      className="text-left font-medium hover:underline"
                    >
                      {displayName(group)}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{group.books.length}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{group.ebookCount}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{group.audiobookCount}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{group.seriesCount}</td>
                  <td className="px-3 py-2 max-sm:hidden">
                    <LibraryFormatBadges formats={group.formats} />
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                    {formatDate(group.latestAdded)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
