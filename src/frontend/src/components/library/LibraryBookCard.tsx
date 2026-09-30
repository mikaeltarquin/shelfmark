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
  // The number in this series, shown as a badge on series pages.
  seriesPosition?: string | null;
  onAuthorClick?: (author: string) => void;
  onSeriesClick?: (series: string) => void;
  // Find releases of this book in one format: the missing one, a better copy, another narrator.
  onGet?: (book: LibraryBook, format: LibraryFormat) => Promise<void>;
}

const GET_FORMATS: LibraryFormat[] = ['ebook', 'audiobook'];

const GetFormatButton = ({
  format,
  owned,
  busy,
  disabled,
  onClick,
}: {
  format: LibraryFormat;
  owned: boolean;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={
      owned
        ? `You have the ${FORMAT_LABELS[format].toLowerCase()}. Find another release (a better copy, another narrator)`
        : `Get the ${FORMAT_LABELS[format].toLowerCase()}`
    }
    className={`flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors disabled:cursor-wait disabled:opacity-60 ${
      owned
        ? 'border border-(--border-muted) hover:bg-(--hover-surface)'
        : 'bg-emerald-600 text-white hover:bg-emerald-700'
    }`}
  >
    {busy ? (
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
    ) : (
      <span aria-hidden="true">{owned ? '↻' : '+'}</span>
    )}
    {FORMAT_LABELS[format]}
  </button>
);

const linkClass = 'truncate text-left hover:underline focus-visible:underline';

export const LibraryBookCard = ({
  book,
  seriesPosition,
  onAuthorClick,
  onSeriesClick,
  onGet,
}: LibraryBookCardProps) => {
  const [busyFormat, setBusyFormat] = useState<LibraryFormat | null>(null);
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
        {seriesPosition && (
          <div className="absolute top-2 left-2 rounded-md border border-emerald-700 bg-emerald-600 px-2 py-1 text-xs font-bold text-white shadow">
            #{seriesPosition}
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
        <p className="flex min-w-0 gap-1 text-xs opacity-80" title={authors}>
          {onAuthorClick && book.authors.length > 0 ? (
            book.authors.map((author, index) => (
              <button
                key={author}
                type="button"
                className={linkClass}
                onClick={() => onAuthorClick(author)}
              >
                {author}
                {index < book.authors.length - 1 ? ',' : ''}
              </button>
            ))
          ) : (
            <span className="truncate">{authors}</span>
          )}
        </p>
        {series && book.series[0] && (
          <p className="flex min-w-0 text-xs opacity-60" title={series}>
            {onSeriesClick ? (
              <button
                type="button"
                className={linkClass}
                onClick={() => onSeriesClick(book.series[0].name)}
              >
                {series}
              </button>
            ) : (
              <span className="truncate">{series}</span>
            )}
          </p>
        )}
      </div>
      {onGet && (
        <div className="mt-auto flex gap-1.5 px-3 pb-3">
          {GET_FORMATS.map((format) => (
            <GetFormatButton
              key={format}
              format={format}
              owned={book.formats.includes(format)}
              busy={busyFormat === format}
              disabled={busyFormat !== null}
              onClick={() => {
                setBusyFormat(format);
                void onGet(book, format).finally(() => setBusyFormat(null));
              }}
            />
          ))}
        </div>
      )}
    </article>
  );
};
