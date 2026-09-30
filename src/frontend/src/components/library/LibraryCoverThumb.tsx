import { useState } from 'react';

import type { LibraryBook } from '../../types';
import { withBasePath } from '../../utils/basePath';

/** A small cover, falling back to a plain tile with the title. */
export const LibraryCoverThumb = ({
  book,
  className = '',
}: {
  book: LibraryBook;
  className?: string;
}) => {
  const [failed, setFailed] = useState(false);
  return (
    <div
      className={`overflow-hidden rounded-md shadow ${className}`}
      style={{ aspectRatio: '2/3', background: 'var(--border-muted)' }}
    >
      {failed ? (
        <div className="flex h-full w-full items-center justify-center p-1 text-center text-[10px] leading-tight opacity-60">
          {book.title}
        </div>
      ) : (
        <img
          src={withBasePath(book.cover)}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover object-top"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
};
