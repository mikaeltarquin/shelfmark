import { useState } from 'react';

import { useBookActivity } from '../../contexts/BookActivityContext';
import { useSavedItems } from '../../contexts/SavedItemsContext';
import { SearchModeProvider } from '../../contexts/SearchModeContext';
import type { Book, ButtonStateInfo, LibraryBook, LibraryFormat } from '../../types';
import type { ActivityBookRef } from '../../utils/bookActivity';
import { copyBadges } from '../../utils/libraryCopies';
import { rowAuthors, rowSeries, rowTitle, rowYear, type LibraryRow } from '../../utils/libraryRows';
import { SAVED_STAGE_LABELS, pickLabel, savedStage } from '../../utils/savedItems';
import { BookActionButton } from '../BookActionButton';
import { BookmarkIcon } from '../SaveForLaterButton';
import { ActivityChips, activityRef } from '../shared';
import { FormatIcon, type LibraryCardActions } from './LibraryBookCard';
import { PlainHeader, rowClass } from './LibraryControls';
import type { LibraryBookActions } from './LibraryMissingSection';

/** A library book has no provider key (unless the provider's list named it): by title. */
const rowActivityRef = (row: LibraryRow): ActivityBookRef =>
  row.kind === 'owned'
    ? {
        key: row.match ? activityRef(row.match).key : null,
        title: row.book.title,
        authors: row.book.authors,
      }
    : activityRef(row.book);

const DEFAULT_BUTTON_STATE: ButtonStateInfo = { text: 'Get', state: 'download' };

const formatDate = (seconds: number | null): string =>
  seconds ? new Date(seconds * 1000).toLocaleDateString() : '—';

const errorText = (err: unknown, fallback: string): string =>
  err instanceof Error ? err.message : fallback;

const FORMAT_WORDS: Record<LibraryFormat, string> = { ebook: 'ebook', audiobook: 'audiobook' };

const badgeClass =
  'flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium';

// Under its column "Missing" is enough; on a phone, without columns, it names the format.
const MissingBadge = ({ format, compact }: { format: LibraryFormat; compact: boolean }) => (
  <span
    className={`${badgeClass} w-fit border border-dashed border-amber-600/70 whitespace-nowrap text-amber-700 dark:text-amber-400`}
    title={`No ${FORMAT_WORDS[format]} in your library`}
  >
    {compact ? `Missing ${FORMAT_WORDS[format]}` : 'Missing'}
  </span>
);

interface CellBadge {
  key: string;
  text: string;
  title: string;
  tone: 'held' | 'queued' | 'downloading';
}

const TONES: Record<CellBadge['tone'], string> = {
  held: 'bg-emerald-600/90',
  queued: 'bg-sky-600/90',
  downloading: 'bg-indigo-600/90',
};

/** What is on its way in a format: queued picks (by narrator or format), a download. */
const usePendingBadges = (row: LibraryRow, format: LibraryFormat): CellBadge[] => {
  const activity = useBookActivity();
  if (!activity) return [];
  const ref = rowActivityRef(row);
  const badges: CellBadge[] = [];
  const download = activity.downloadFor(ref);
  if (download?.state === 'active' && download.formats.includes(format)) {
    badges.push({
      key: 'downloading',
      text: 'Downloading',
      title: `The ${FORMAT_WORDS[format]} is downloading`,
      tone: 'downloading',
    });
  }
  const saved = activity.savedFor(ref);
  if (saved && savedStage(saved) === 'queued') {
    saved.releases
      .filter((pick) => pick.content_type === format)
      .forEach((pick, index) => {
        const text = pickLabel(pick);
        const fullText = pickLabel(pick, { full: true });
        badges.push({
          key: `queued:${index}`,
          text,
          title:
            format === 'audiobook' && text !== 'Audiobook'
              ? `Queued for download: the audiobook read by ${fullText}`
              : `Queued for download: the ${FORMAT_WORDS[format]} (${fullText})`,
          tone: 'queued',
        });
      });
  }
  return badges;
};

const heldBadges = (row: LibraryRow, format: LibraryFormat): CellBadge[] => {
  if (row.kind === 'owned') {
    if (!row.book.formats.includes(format)) return [];
    return copyBadges(row.book, format).map(({ key, text, title }) => ({
      key,
      text,
      title,
      tone: 'held',
    }));
  }
  if (row.missingFormats.includes(format)) return [];
  // The provider's book, held in this format under another author or title.
  return [
    {
      key: 'held',
      text: 'In library',
      title: `The ${FORMAT_WORDS[format]} is in your library`,
      tone: 'held',
    },
  ];
};

/**
 * What the library holds of a book in one format, a badge per copy (an audiobook by its
 * narrator), then what's on its way: queued picks in blue, a download in indigo. Else
 * "Missing" when the provider lists it as lacking, or a dash.
 */
const FormatCell = ({
  row,
  format,
  compact = false,
}: {
  row: LibraryRow;
  format: LibraryFormat;
  compact?: boolean; // Badges under the title on a phone: nothing for an unknown format
}) => {
  const badges = [...heldBadges(row, format), ...usePendingBadges(row, format)];
  if (badges.length > 0) {
    return (
      <span className={`flex items-start gap-1 ${compact ? 'flex-wrap' : 'flex-col'}`}>
        {badges.map((badge) => (
          <span
            key={badge.key}
            className={`${badgeClass} ${TONES[badge.tone]} text-white shadow`}
            title={badge.title}
          >
            <FormatIcon format={format} />
            <span className="truncate">{badge.text}</span>
          </span>
        ))}
      </span>
    );
  }
  if (row.missingFormats.includes(format)) {
    return <MissingBadge format={format} compact={compact} />;
  }
  return compact ? null : <span className="opacity-30">—</span>;
};

/**
 * Save the book for later, or take it off the list: outlined when not saved, filled when
 * saved for later, and blue once queued for download (its releases picked).
 */
const RowBookmark = ({
  row,
  cardActions,
}: {
  row: LibraryRow;
  cardActions: LibraryCardActions;
}) => {
  const saved = useSavedItems();
  const activity = useBookActivity();
  const [busy, setBusy] = useState(false);
  if (!saved) return null;
  const item = activity?.savedFor(rowActivityRef(row));
  const stage = item ? savedStage(item) : null;

  const toggle = async () => {
    setBusy(true);
    try {
      if (item) {
        await saved.remove(item);
        return;
      }
      let book = row.kind === 'missing' ? row.book : row.match;
      if (!book && row.kind === 'owned') book = await cardActions.lookup(row.book);
      if (!book) return;
      // A book held in one format is wanted in the other.
      const wanted = row.missingFormats.length === 1 ? row.missingFormats[0] : saved.contentType;
      await saved.saveBook(book, wanted);
    } catch (err: unknown) {
      cardActions.onShowToast?.(errorText(err, `Could not look up ${row.book.title}`), 'error');
    } finally {
      setBusy(false);
    }
  };

  let label = 'Save for later';
  let tone = 'opacity-40 hover:opacity-100';
  if (stage) {
    label = `${SAVED_STAGE_LABELS[stage]}: click to remove`;
    tone = stage === 'queued' ? 'text-sky-600 dark:text-sky-400' : 'text-amber-500';
  }
  return (
    <button
      type="button"
      className={`${iconButtonClass} ${tone}`}
      onClick={() => void toggle()}
      disabled={busy}
      aria-label={`${label}: ${row.book.title}`}
      aria-pressed={Boolean(item)}
      title={label}
    >
      <BookmarkIcon filled={Boolean(item)} className="h-4 w-4" />
    </button>
  );
};

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
const OwnedActions = ({
  book,
  match,
  actions,
}: {
  book: LibraryBook;
  match: Book | null; // Known already when the provider's list named the book
  actions: LibraryCardActions;
}) => {
  const [lookedUp, setFound] = useState<Book | null>(null);
  const [busy, setBusy] = useState<'details' | 'releases' | null>(null);
  const found = lookedUp ?? match;

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
    <table className="w-full text-sm">
      <thead className="border-b border-(--border-muted) text-xs">
        <tr>
          <th scope="col" className="w-9 pl-1">
            <span className="sr-only">Saved</span>
          </th>
          {series !== undefined && <PlainHeader label="#" align="right" className="w-14" />}
          <PlainHeader label="Title" className="w-full" />
          {showAuthor && <PlainHeader label="Author" className="min-w-40 max-md:hidden" />}
          {series === undefined && showSeries && (
            <PlainHeader label="Series" className="min-w-40 max-sm:hidden" />
          )}
          <PlainHeader label="Year" align="right" className="w-16 max-sm:hidden" />
          <PlainHeader label="Ebook" className="w-32 max-sm:hidden" />
          <PlainHeader label="Audiobook" className="w-48 max-sm:hidden" />
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
              <td className="py-1.5 pl-1">
                <RowBookmark row={row} cardActions={cardActions} />
              </td>
              {series !== undefined && (
                <td className="px-3 py-1.5 text-right tabular-nums opacity-70">
                  {entry?.number ?? ''}
                </td>
              )}
              <td className="min-w-48 px-3 py-1.5 wrap-break-word">
                <span className={missing ? 'opacity-75' : 'font-medium'}>{rowTitle(row)}</span>
                <ActivityChips
                  book={rowActivityRef(row)}
                  className="pt-0.5"
                  showDownloaded={false}
                />
                {/* Phones have no room for the format columns: the badges go here. */}
                <span className="flex flex-wrap items-start gap-1 pt-1 sm:hidden">
                  <FormatCell row={row} format="ebook" compact />
                  <FormatCell row={row} format="audiobook" compact />
                </span>
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
              <td className="px-3 py-1.5 max-sm:hidden">
                <FormatCell row={row} format="ebook" />
              </td>
              <td className="px-3 py-1.5 max-sm:hidden">
                <FormatCell row={row} format="audiobook" />
              </td>
              {showAdded && (
                <td className="px-3 py-1.5 text-right whitespace-nowrap tabular-nums max-md:hidden">
                  {row.kind === 'owned' ? formatDate(row.book.added_at) : ''}
                </td>
              )}
              <td className="px-3 py-1.5">
                {row.kind === 'owned' ? (
                  <OwnedActions book={row.book} match={row.match} actions={cardActions} />
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
