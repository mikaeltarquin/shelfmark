import { useMemo, useState } from 'react';

import type { LibraryBook, LibraryFormat } from '../../types';
import {
  filterLibraryBooks,
  sortLibraryBooks,
  type LibraryFormatFilter,
  type LibrarySort,
} from '../../utils/libraryBrowser';
import { LibraryBookGrid } from './LibraryBookGrid';
import { inputClass } from './libraryStyles';

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

interface LibraryAllViewProps {
  books: LibraryBook[];
  onAuthorClick: (author: string) => void;
  onSeriesClick: (series: string) => void;
  onGet: (book: LibraryBook, format: LibraryFormat) => Promise<void>;
}

/** Every book, with a text filter, a format filter and sorting. */
export const LibraryAllView = ({
  books,
  onAuthorClick,
  onSeriesClick,
  onGet,
}: LibraryAllViewProps) => {
  const [query, setQuery] = useState('');
  const [format, setFormat] = useState<LibraryFormatFilter>('any');
  const [sort, setSort] = useState<LibrarySort>('title');

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
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter by title, author, series or narrator"
          aria-label="Filter books"
          className={`${inputClass} w-full sm:w-auto sm:max-w-sm sm:flex-1`}
        />
        <select
          value={format}
          onChange={(event) => {
            const value = event.target.value;
            if (isFormatFilter(value)) setFormat(value);
          }}
          aria-label="Format"
          className={inputClass}
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
          className={inputClass}
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              Sort: {option.label}
            </option>
          ))}
        </select>
        {(query || format !== 'any') && (
          <span className="text-xs opacity-60">
            {visible.length} of {books.length}
          </span>
        )}
      </div>
      {visible.length === 0 ? (
        <p className="text-sm opacity-60">No books match these filters.</p>
      ) : (
        // Keyed so a new filter starts from the first page again.
        <LibraryBookGrid
          key={`${query}|${format}|${sort}`}
          books={visible}
          onAuthorClick={onAuthorClick}
          onSeriesClick={onSeriesClick}
          onGet={onGet}
        />
      )}
    </div>
  );
};
