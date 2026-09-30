import { useState } from 'react';

import type { LibraryBook, LibraryFormat } from '../../types';
import { seriesNumberIn } from '../../utils/libraryGroups';
import { LibraryBookCard } from './LibraryBookCard';

const PAGE_SIZE = 120;

interface LibraryBookGridProps {
  books: LibraryBook[];
  // On a series page: show each book's number in this series.
  series?: string;
  onAuthorClick?: (author: string) => void;
  onSeriesClick?: (series: string) => void;
  onGet?: (book: LibraryBook, format: LibraryFormat) => Promise<void>;
}

export const LibraryBookGrid = ({
  books,
  series,
  onAuthorClick,
  onSeriesClick,
  onGet,
}: LibraryBookGridProps) => {
  const [shown, setShown] = useState(PAGE_SIZE);
  return (
    <>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {books.slice(0, shown).map((book) => (
          <LibraryBookCard
            key={book.id}
            book={book}
            seriesPosition={series ? seriesNumberIn(book, series) : null}
            onAuthorClick={onAuthorClick}
            onSeriesClick={onSeriesClick}
            onGet={onGet}
          />
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
};
