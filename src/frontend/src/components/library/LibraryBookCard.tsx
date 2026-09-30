import { useState } from 'react';

import { SearchModeProvider } from '../../contexts/SearchModeContext';
import type { Book, ButtonStateInfo, LibraryBook, LibraryFormat } from '../../types';
import { withBasePath } from '../../utils/basePath';
import { bookSupportsTargets } from '../../utils/bookTargetLoader';
import { seriesLabel } from '../../utils/libraryBrowser';
import { BookActionButton } from '../BookActionButton';
import { BookTargetDropdown } from '../BookTargetDropdown';

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

/** What a library card can do with the book, once the metadata provider knows it. */
export interface LibraryCardActions {
  // The metadata provider's record of the book (cached; rejects when it can't be found).
  lookup: (book: LibraryBook) => Promise<Book>;
  onShowDetails: (book: Book) => Promise<void>;
  onGetReleases: (book: Book) => Promise<void>;
  getButtonState: (bookId: string) => ButtonStateInfo;
  onShowToast?: (message: string, type: 'success' | 'error' | 'info') => void;
}

const DEFAULT_BUTTON_STATE: ButtonStateInfo = { text: 'Get', state: 'download' };

interface LibraryBookCardProps {
  book: LibraryBook;
  // The number in this series, shown as a badge on series pages.
  seriesPosition?: string | null;
  onAuthorClick?: (author: string) => void;
  onSeriesClick?: (series: string) => void;
  actions?: LibraryCardActions;
}

const linkClass = 'truncate text-left hover:underline focus-visible:underline';

const errorText = (err: unknown, fallback: string): string =>
  err instanceof Error ? err.message : fallback;

export const LibraryBookCard = ({
  book,
  seriesPosition,
  onAuthorClick,
  onSeriesClick,
  actions,
}: LibraryBookCardProps) => {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [found, setFound] = useState<Book | null>(null);
  const [lookupStarted, setLookupStarted] = useState(false);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [isLoadingReleases, setIsLoadingReleases] = useState(false);
  const series = seriesLabel(book);
  const authors = book.authors.join(', ') || 'Unknown author';

  // The provider record is fetched on first hover, so the list button is ready by the
  // time the pointer reaches it; details and Get fetch it themselves when needed.
  const resolve = async (): Promise<Book> => {
    if (found) return found;
    if (!actions) throw new Error('Unavailable');
    const record = await actions.lookup(book);
    setFound(record);
    return record;
  };

  const prefetch = () => {
    if (!actions || lookupStarted) return;
    setLookupStarted(true);
    resolve().catch(() => undefined);
  };

  const showDetails = async () => {
    if (!actions) return;
    setIsLoadingDetails(true);
    try {
      await actions.onShowDetails(await resolve());
    } catch (err: unknown) {
      actions.onShowToast?.(errorText(err, `Could not look up ${book.title}`), 'error');
    } finally {
      setIsLoadingDetails(false);
    }
  };

  const getReleases = async () => {
    if (!actions) return;
    setIsLoadingReleases(true);
    try {
      await actions.onGetReleases(await resolve());
    } catch (err: unknown) {
      actions.onShowToast?.(errorText(err, `Could not look up ${book.title}`), 'error');
    } finally {
      setIsLoadingReleases(false);
    }
  };

  const overlayVisible = isHovered || dropdownOpen || isLoadingDetails;
  // Before the lookup the Get button stands for the library book itself.
  const buttonBook: Book = found ?? { id: book.id, title: book.title, author: authors };
  const buttonState = found && actions ? actions.getButtonState(found.id) : DEFAULT_BUTTON_STATE;

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- hover drives the shadow and an early lookup; the buttons inside carry all behavior
    <article
      className="relative flex flex-col rounded-xl transition-shadow duration-300"
      style={{
        background: 'var(--bg-soft)',
        boxShadow: overlayVisible ? '0 10px 30px rgba(0, 0, 0, 0.15)' : 'none',
        zIndex: dropdownOpen ? 20 : undefined,
      }}
      onMouseEnter={() => {
        setIsHovered(true);
        prefetch();
      }}
      onMouseLeave={() => setIsHovered(false)}
      onFocus={prefetch}
    >
      <div className="relative w-full" style={{ aspectRatio: '2/3' }}>
        <div className="absolute inset-0 overflow-hidden rounded-t-xl">
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
        </div>
        {seriesPosition && (
          <div className="absolute top-2 left-2 rounded-md border border-emerald-700 bg-emerald-600 px-2 py-1 text-xs font-bold text-white shadow">
            #{seriesPosition}
          </div>
        )}
        <div className="absolute top-2 right-2">
          <LibraryFormatBadges formats={book.formats} />
        </div>

        {actions && (
          <div
            className="absolute right-2 bottom-2 z-10 flex flex-col gap-1.5 transition-all duration-300 max-sm:pointer-events-auto max-sm:opacity-100"
            style={{
              opacity: overlayVisible ? 1 : 0,
              pointerEvents: overlayVisible ? 'auto' : 'none',
            }}
          >
            {found?.provider && found.provider_id && bookSupportsTargets(found) && (
              <BookTargetDropdown
                provider={found.provider}
                bookId={found.provider_id}
                onShowToast={actions.onShowToast}
                variant="icon"
                className="h-8 w-8 bg-white/95 shadow-lg hover:scale-110 dark:bg-neutral-800/95"
                onOpenChange={setDropdownOpen}
              />
            )}
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-white/95 shadow-lg transition-all duration-300 hover:scale-110 dark:bg-neutral-800/95"
              onClick={(event) => {
                event.stopPropagation();
                void showDetails();
              }}
              disabled={isLoadingDetails}
              aria-label="Book details"
            >
              {isLoadingDetails ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              ) : (
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              )}
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 space-y-0.5 p-3">
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

      {actions && (
        <SearchModeProvider searchMode="universal">
          <BookActionButton
            book={buttonBook}
            buttonState={buttonState}
            onDownload={getReleases}
            onGetReleases={() => {
              void getReleases();
            }}
            isLoadingReleases={isLoadingReleases}
            className="rounded-none"
            fullWidth
            style={{
              borderBottomLeftRadius: '.75rem',
              borderBottomRightRadius: '.75rem',
            }}
          />
        </SearchModeProvider>
      )}
    </article>
  );
};
