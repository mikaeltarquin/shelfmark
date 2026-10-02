import { useState } from 'react';

import { SearchModeProvider } from '../../contexts/SearchModeContext';
import type { Book, ButtonStateInfo, LibraryBook, LibraryFormat } from '../../types';
import { rowAuthors, rowSeries, rowTitle, rowYear, type LibraryRow } from '../../utils/libraryRows';
import { BookActionButton } from '../BookActionButton';
import { LibraryFormatBadges, type LibraryCardActions } from './LibraryBookCard';
import { PlainHeader, rowClass } from './LibraryControls';
import type { LibraryBookActions } from './LibraryMissingSection';

const DEFAULT_BUTTON_STATE: ButtonStateInfo = { text: 'Get', state: 'download' };

const formatDate = (seconds: number | null): string =>
  seconds ? new Date(seconds * 1000).toLocaleDateString() : '—';

const errorText = (err: unknown, fallback: string): string =>
  err instanceof Error ? err.message : fallback;

const FORMAT_WORDS: Record<LibraryFormat, string> = { ebook: 'ebook', audiobook: 'audiobook' };

/** "Missing", or "Missing audiobook" when the library holds the other format. */
const MissingBadge = ({ formats }: { formats: LibraryFormat[] }) => (
  <span className="inline-flex items-center rounded-full border border-dashed border-amber-600/70 px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-amber-700 dark:text-amber-400">
    {formats.length === 1 ? `Missing ${FORMAT_WORDS[formats[0]]}` : 'Missing'}
  </span>
);

const InfoIcon = () => (
  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
    />
  </svg>
);

const iconButtonClass =
  'flex h-7 w-7 items-center justify-center rounded-full hover:bg-(--hover-surface) disabled:opacity-50';

/** Details and Get for a library book, once the metadata provider's record is found. */
const OwnedActions = ({ book, actions }: { book: LibraryBook; actions: LibraryCardActions }) => {
  const [found, setFound] = useState<Book | null>(null);
  const [busy, setBusy] = useState<'details' | 'releases' | null>(null);

  const run = async (kind: 'details' | 'releases') => {
    setBusy(kind);
    try {
      const record = found ?? (await actions.lookup(book));
      setFound(record);
      await (kind === 'details' ? actions.onShowDetails(record) : actions.onGetReleases(record));
    } catch (err: unknown) {
      actions.onShowToast?.(errorText(err, `Could not look up ${book.title}`), 'error');
    } finally {
      setBusy(null);
    }
  };

  const buttonBook: Book = found ?? {
    id: book.id,
    title: book.title,
    author: book.authors.join(', '),
  };
  return (
    <div className="flex items-center justify-end gap-1">
      <button
        type="button"
        className={iconButtonClass}
        onClick={() => void run('details')}
        disabled={busy !== null}
        aria-label={`Details: ${book.title}`}
        title="Details"
      >
        {busy === 'details' ? (
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : (
          <InfoIcon />
        )}
      </button>
      <BookActionButton
        book={buttonBook}
        buttonState={found ? actions.getButtonState(found.id) : DEFAULT_BUTTON_STATE}
        onDownload={() => run('releases')}
        onGetReleases={() => void run('releases')}
        isLoadingReleases={busy === 'releases'}
        size="sm"
      />
    </div>
  );
};

const MissingActions = ({ book, actions }: { book: Book; actions: LibraryBookActions }) => (
  <div className="flex items-center justify-end gap-1">
    <button
      type="button"
      className={iconButtonClass}
      onClick={() => void actions.onShowDetails(book)}
      aria-label={`Details: ${book.title}`}
      title="Details"
    >
      <InfoIcon />
    </button>
    <BookActionButton
      book={book}
      buttonState={actions.getButtonState(book.id)}
      onDownload={actions.onGetReleases}
      onGetReleases={(target) => void actions.onGetReleases(target)}
      size="sm"
    />
  </div>
);

interface LibraryBookTableProps {
  rows: LibraryRow[];
  // Within one series: a "#" column with each book's number in it, and no series column.
  series?: string;
  showAdded?: boolean;
  cardActions: LibraryCardActions;
  actions: LibraryBookActions;
  onAuthorClick?: (author: string) => void;
  onSeriesClick?: (series: string) => void;
  // Off under an author's row, where every book is theirs.
  showAuthor?: boolean;
  // Off for a list of books outside any series.
  showSeries?: boolean;
}

/** Books as table rows: the library's own and, inline, the ones it lacks. */
export const LibraryBookTable = ({
  rows,
  series,
  showAdded = false,
  cardActions,
  actions,
  onAuthorClick,
  onSeriesClick,
  showAuthor = true,
  showSeries = true,
}: LibraryBookTableProps) => (
  <SearchModeProvider searchMode="universal">
    <table className="w-full table-fixed text-sm">
      <thead className="border-b border-(--border-muted) text-xs">
        <tr>
          {series !== undefined && <PlainHeader label="#" align="right" className="w-14" />}
          <PlainHeader label="Title" />
          {showAuthor && <PlainHeader label="Author" className="w-1/5 max-md:hidden" />}
          {series === undefined && showSeries && (
            <PlainHeader label="Series" className="w-1/5 max-sm:hidden" />
          )}
          <PlainHeader label="Year" align="right" className="w-16 max-sm:hidden" />
          <PlainHeader label="Formats" className="w-28 sm:w-52" />
          {showAdded && <PlainHeader label="Added" align="right" className="w-28 max-md:hidden" />}
          <th scope="col" className="w-28 px-3 py-2">
            <span className="sr-only">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const entry = rowSeries(row, series);
          const authors = rowAuthors(row);
          const missing = row.kind === 'missing';
          return (
            <tr key={row.key} className={rowClass}>
              {series !== undefined && (
                <td className="px-3 py-1.5 text-right tabular-nums opacity-70">
                  {entry?.number ?? ''}
                </td>
              )}
              <td className={`px-3 py-1.5 ${missing ? 'opacity-75' : 'font-medium'}`}>
                {rowTitle(row)}
              </td>
              {showAuthor && (
                <td className="px-3 py-1.5 max-md:hidden">
                  <span className="flex flex-wrap gap-x-1">
                    {authors.map((author, index) =>
                      onAuthorClick ? (
                        <button
                          key={author}
                          type="button"
                          className="text-left hover:underline"
                          onClick={() => onAuthorClick(author)}
                        >
                          {author}
                          {index < authors.length - 1 ? ',' : ''}
                        </button>
                      ) : (
                        <span key={author}>
                          {author}
                          {index < authors.length - 1 ? ',' : ''}
                        </span>
                      ),
                    )}
                  </span>
                </td>
              )}
              {series === undefined && showSeries && (
                <td className="px-3 py-1.5 max-sm:hidden">
                  {entry &&
                    (onSeriesClick ? (
                      <button
                        type="button"
                        className="text-left hover:underline"
                        onClick={() => onSeriesClick(entry.name)}
                      >
                        {entry.name}
                        {entry.number ? ` #${entry.number}` : ''}
                      </button>
                    ) : (
                      <span>
                        {entry.name}
                        {entry.number ? ` #${entry.number}` : ''}
                      </span>
                    ))}
                </td>
              )}
              <td className="px-3 py-1.5 text-right tabular-nums max-sm:hidden">
                {rowYear(row) ?? ''}
              </td>
              <td className="px-3 py-1.5">
                {row.kind === 'owned' ? (
                  <LibraryFormatBadges formats={row.book.formats} />
                ) : (
                  <MissingBadge formats={row.missingFormats} />
                )}
              </td>
              {showAdded && (
                <td className="px-3 py-1.5 text-right whitespace-nowrap tabular-nums max-md:hidden">
                  {row.kind === 'owned' ? formatDate(row.book.added_at) : ''}
                </td>
              )}
              <td className="px-3 py-1.5">
                {row.kind === 'owned' ? (
                  <OwnedActions book={row.book} actions={cardActions} />
                ) : (
                  <MissingActions book={row.book} actions={actions} />
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </SearchModeProvider>
);
