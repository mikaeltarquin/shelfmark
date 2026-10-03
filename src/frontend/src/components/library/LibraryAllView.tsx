import { useMemo, useState } from 'react';

import type { LibraryBook } from '../../types';
import {
  filterLibraryBooks,
  sortLibraryBooks,
  type LibraryFormatFilter,
  type LibrarySort,
} from '../../utils/libraryBrowser';
import { ALL_SORT_OPTIONS, loadLibraryDefaults } from '../../utils/libraryDefaults';
import { loadStoredPrefs, saveStoredPrefs } from '../../utils/libraryPrefs';
import { ownedRow } from '../../utils/libraryRows';
import type { LibraryCardActions } from './LibraryBookCard';
import { LibraryBookGrid } from './LibraryBookGrid';
import { LibraryBookTable } from './LibraryBookTable';
import {
  FormatSelect,
  LayoutToggle,
  isLayout,
  tableShellClass,
  tableShellStyle,
  type LibraryLayout,
} from './LibraryControls';
import type { LibraryBookActions } from './LibraryMissingSection';
import { inputClass } from './libraryStyles';

const PREFS_KEY = 'shelfmark.library.all';
const TABLE_PAGE_SIZE = 200;

const SORT_OPTIONS = ALL_SORT_OPTIONS;

const isSort = (value: string): value is LibrarySort =>
  SORT_OPTIONS.some((option) => option.value === value);

const loadView = (): LibraryLayout => {
  const view: unknown = Reflect.get(loadStoredPrefs(PREFS_KEY) ?? {}, 'view');
  return isLayout(view) ? view : 'grid';
};

// The sort chosen under My Account, else the one last used, else by title.
const loadSort = (): LibrarySort => {
  const chosen = loadLibraryDefaults().allSort;
  if (chosen) return chosen;
  const sort: unknown = Reflect.get(loadStoredPrefs(PREFS_KEY) ?? {}, 'sort');
  return typeof sort === 'string' && isSort(sort) ? sort : 'title';
};

interface LibraryAllViewProps {
  books: LibraryBook[];
  onAuthorClick: (author: string) => void;
  onSeriesClick: (series: string) => void;
  cardActions: LibraryCardActions;
  actions: LibraryBookActions;
}

/** Every book, as covers or a table, with a text filter, a format filter and sorting. */
export const LibraryAllView = ({
  books,
  onAuthorClick,
  onSeriesClick,
  cardActions,
  actions,
}: LibraryAllViewProps) => {
  const [query, setQuery] = useState('');
  const [format, setFormat] = useState<LibraryFormatFilter>('any');
  const [sort, setSort] = useState<LibrarySort>(loadSort);
  const [view, setView] = useState<LibraryLayout>(loadView);
  const [shown, setShown] = useState(TABLE_PAGE_SIZE);

  const visible = useMemo(
    () => sortLibraryBooks(filterLibraryBooks(books, { query, format }), sort),
    [books, query, format, sort],
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setShown(TABLE_PAGE_SIZE);
          }}
          placeholder="Filter by title, author, series or narrator"
          aria-label="Filter books"
          className={`${inputClass} w-full sm:w-auto sm:max-w-sm sm:flex-1`}
        />
        <FormatSelect
          value={format}
          onChange={(next) => {
            setFormat(next);
            setShown(TABLE_PAGE_SIZE);
          }}
        />
        <select
          value={sort}
          onChange={(event) => {
            const value = event.target.value;
            if (isSort(value)) {
              setSort(value);
              saveStoredPrefs(PREFS_KEY, { view, sort: value });
            }
          }}
          aria-label="Sort by"
          className={inputClass}
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              Sort: {option.label}
            </option>
          ))}
        </select>
        <LayoutToggle
          value={view}
          onChange={(next) => {
            setView(next);
            saveStoredPrefs(PREFS_KEY, { view: next, sort });
          }}
        />
        {(query || format !== 'any') && (
          <span className="text-xs opacity-60">
            {visible.length} of {books.length}
          </span>
        )}
      </div>
      {visible.length === 0 && <p className="text-sm opacity-60">No books match these filters.</p>}
      {visible.length > 0 && view === 'table' && (
        <>
          <div className={tableShellClass} style={tableShellStyle}>
            <LibraryBookTable
              rows={visible.slice(0, shown).map(ownedRow)}
              showAdded
              cardActions={cardActions}
              actions={actions}
              onAuthorClick={onAuthorClick}
              onSeriesClick={onSeriesClick}
            />
          </div>
          {visible.length > shown && (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => setShown((count) => count + TABLE_PAGE_SIZE)}
                className="rounded-lg border border-(--border-muted) bg-(--bg-soft) px-4 py-2 text-sm font-medium transition-colors hover:bg-(--hover-surface)"
              >
                Show more ({visible.length - shown} left)
              </button>
            </div>
          )}
        </>
      )}
      {visible.length > 0 && view === 'grid' && (
        // Keyed so a new filter starts from the first page again.
        <LibraryBookGrid
          key={`${query}|${format}|${sort}`}
          books={visible}
          onAuthorClick={onAuthorClick}
          onSeriesClick={onSeriesClick}
          cardActions={cardActions}
        />
      )}
    </div>
  );
};
