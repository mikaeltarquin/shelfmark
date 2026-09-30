import { useState } from 'react';

import type { LibraryBook, LibraryFormat } from '../../types';
import { withBasePath } from '../../utils/basePath';
import { seriesLabel } from '../../utils/libraryBrowser';

const FORMAT_LABELS: Record<LibraryFormat, string> = {
  ebook: 'Ebook',
  audiobook: 'Audiobook',
};

const FormatIcon = ({ format }: { format: LibraryFormat }) => (
  <svg
    className="h-3.5 w-3.5"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth="1.8"
    stroke="currentColor"
    aria-hidden="true"
  >
    {format === 'audiobook' ? (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 18v-6a9 9 0 0 1 18 0v6M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3v5ZM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3v5Z"
      />
    ) : (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25"
      />
    )}
  </svg>
);

export const LibraryFormatBadges = ({ formats }: { formats: LibraryFormat[] }) => (
  <div className="flex gap-1">
    {formats.map((format) => (
      <span
        key={format}
        className="flex items-center gap-1 rounded-full bg-emerald-600/90 px-2 py-0.5 text-[11px] font-medium text-white shadow"
        title={`${FORMAT_LABELS[format]} in your library`}
      >
        <FormatIcon format={format} />
        <span className="max-sm:hidden">{FORMAT_LABELS[format]}</span>
      </span>
    ))}
  </div>
);

interface LibraryBookCardProps {
  book: LibraryBook;
}

export const LibraryBookCard = ({ book }: LibraryBookCardProps) => {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const series = seriesLabel(book);
  const authors = book.authors.join(', ') || 'Unknown author';

  return (
    <article
      className="flex flex-col overflow-hidden rounded-xl"
      style={{ background: 'var(--bg-soft)' }}
    >
      <div className="relative w-full" style={{ aspectRatio: '2/3' }}>
        {!imageError ? (
          <>
            {!imageLoaded && (
              <div className="absolute inset-0 animate-pulse bg-linear-to-r from-gray-300 via-gray-200 to-gray-300 dark:from-gray-700 dark:via-gray-600 dark:to-gray-700" />
            )}
            <img
              src={withBasePath(book.cover)}
              alt={book.title}
              loading="lazy"
              className="h-full w-full"
              style={{
                opacity: imageLoaded ? 1 : 0,
                transition: 'opacity 0.3s ease-in-out',
                objectFit: 'cover',
                objectPosition: 'top',
              }}
              onLoad={() => setImageLoaded(true)}
              onError={() => setImageError(true)}
            />
          </>
        ) : (
          <div
            className="flex h-full w-full items-center justify-center p-3 text-center text-sm font-medium opacity-60"
            style={{ background: 'var(--border-muted)' }}
          >
            {book.title}
          </div>
        )}
        <div className="absolute right-2 bottom-2">
          <LibraryFormatBadges formats={book.formats} />
        </div>
      </div>
      <div className="space-y-0.5 p-3">
        <h3 className="line-clamp-2 text-sm leading-tight font-semibold" title={book.title}>
          {book.title}
        </h3>
        <p className="truncate text-xs opacity-80" title={authors}>
          {authors}
        </p>
        {series && (
          <p className="truncate text-xs opacity-60" title={series}>
            {series}
          </p>
        )}
      </div>
    </article>
  );
};
