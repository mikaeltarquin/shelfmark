import { useMemo, useState } from 'react';

import { useMountEffect } from '../../hooks/useMountEffect';
import { getLibraryBooks } from '../../services/api';
import type { LibraryBooksResponse } from '../../types';
import {
  filterLibraryBooks,
  sortLibraryBooks,
  type LibraryFormatFilter,
  type LibrarySort,
} from '../../utils/libraryBrowser';
import { LibraryBookCard } from './LibraryBookCard';

const PAGE_SIZE = 120;

const FORMAT_OPTIONS: Array<{ value: LibraryFormatFilter; label: string }> = [
  { value: 'any', label: 'All formats' },
  { value: 'ebook', label: 'Ebook' },
  { value: 'audiobook', label: 'Audiobook' },
  { value: 'both', label: 'Both' },
];

const SORT_OPTIONS: Array<{ value: LibrarySort; label: string }> = [
  { value: 'title', label: 'Title' },
  { value: 'author', label: 'Author' },
  { value: 'added', label: 'Recently added' },
];

const isFormatFilter = (value: string): value is LibraryFormatFilter =>
  FORMAT_OPTIONS.some((option) => option.value === value);

const isSort = (value: string): value is LibrarySort =>
  SORT_OPTIONS.some((option) => option.value === value);

const selectClass =
  'rounded-lg border border-(--border-muted) bg-(--bg-soft) px-3 py-2 text-sm focus:border-sky-500 focus:outline-hidden';

interface LibraryPageProps {
  onBack: () => void;
}

/** Browse the books already in the user's libraries (Audiobookshelf, Calibre). */
export const LibraryPage = ({ onBack }: LibraryPageProps) => {
  const [data, setData] = useState<LibraryBooksResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [format, setFormat] = useState<LibraryFormatFilter>('any');
  const [sort, setSort] = useState<LibrarySort>('title');
  const [shown, setShown] = useState(PAGE_SIZE);

  useMountEffect(() => {
    getLibraryBooks()
      .then(setData)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Could not load the library');
      });
  });

  const books = useMemo(
    () => sortLibraryBooks(filterLibraryBooks(data?.books ?? [], { query, format }), sort),
    [data, query, format, sort],
  );

  const updateFilter = (apply: () => void) => {
    apply();
    setShown(PAGE_SIZE);
  };

  let body;
  if (error) {
    body = <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  } else if (!data) {
    body = <p className="text-sm opacity-60">Loading your library…</p>;
  } else if (!data.enabled) {
    body = (
      <p className="text-sm opacity-80">
        No library is connected. Turn one on under Settings → Libraries (Audiobookshelf or Calibre).
      </p>
    );
  } else if (books.length === 0) {
    body = (
      <p className="text-sm opacity-60">
        {data.books.length === 0 ? 'Your library is empty.' : 'No books match these filters.'}
      </p>
    );
  } else {
    body = (
      <>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {books.slice(0, shown).map((book) => (
            <LibraryBookCard key={book.id} book={book} />
          ))}
        </div>
        {books.length > shown && (
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => setShown((count) => count + PAGE_SIZE)}
              className="rounded-lg border border-(--border-muted) bg-(--bg-soft) px-4 py-2 text-sm font-medium transition-colors hover:bg-(--hover-surface)"
            >
              Show more ({books.length - shown} left)
            </button>
          </div>
        )}
      </>
    );
  }

  const sourceNames = data?.sources.map((source) => source.display_name).join(' and ');

  return (
    <section className="space-y-5" aria-labelledby="library-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <button
            type="button"
            onClick={onBack}
            className="mb-1 text-xs font-medium opacity-60 hover:opacity-100"
          >
            ← Back to search
          </button>
          <h1 id="library-title" className="text-2xl font-semibold">
            Library
          </h1>
          {data?.enabled && (
            <p className="text-sm opacity-60">
              {data.books.length} {data.books.length === 1 ? 'book' : 'books'} in {sourceNames}
            </p>
          )}
        </div>
      </div>

      {data?.enabled && data.books.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={(event) => updateFilter(() => setQuery(event.target.value))}
            placeholder="Filter by title, author, series or narrator"
            aria-label="Filter books"
            className={`${selectClass} w-full sm:w-auto sm:max-w-sm sm:flex-1`}
          />
          <select
            value={format}
            onChange={(event) => {
              const value = event.target.value;
              if (isFormatFilter(value)) updateFilter(() => setFormat(value));
            }}
            aria-label="Format"
            className={selectClass}
          >
            {FORMAT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <select
            value={sort}
            onChange={(event) => {
              const value = event.target.value;
              if (isSort(value)) setSort(value);
            }}
            aria-label="Sort by"
            className={selectClass}
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                Sort: {option.label}
              </option>
            ))}
          </select>
          {(query || format !== 'any') && (
            <span className="text-xs opacity-60">
              {books.length} of {data.books.length}
            </span>
          )}
        </div>
      )}

      {body}
    </section>
  );
};
