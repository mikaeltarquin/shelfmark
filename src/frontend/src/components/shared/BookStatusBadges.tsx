import { useBookActivity } from '../../contexts/BookActivityContext';
import type { Book, LibraryOwnership, LibrarySources } from '../../types';
import {
  downloadLabel,
  type ActivityBookRef,
  type BookDownloadSummary,
} from '../../utils/bookActivity';
import { LibraryBadge } from './LibraryBadge';

const bookAuthors = (book: Book): string[] => {
  if (book.authors && book.authors.length > 0) return book.authors;
  return book.author ? [book.author] : [];
};

/** What the Saved and Downloads marks match a search result or provider book by. */
export const activityRef = (book: Book): ActivityBookRef => ({
  key:
    book.provider && book.provider_id && book.provider !== 'manual'
      ? `${book.provider}:${book.provider_id}`
      : null,
  title: book.search_title || book.title,
  authors: bookAuthors(book),
});

type Tone = 'saved' | 'active' | 'complete' | 'error';

const OVERLAY: Record<Tone, string> = {
  saved: 'border-amber-600 bg-amber-500 text-white',
  active: 'border-indigo-700 bg-indigo-600 text-white',
  complete: 'border-violet-700 bg-violet-600 text-white',
  error: 'border-red-700 bg-red-600 text-white',
};

const INLINE: Record<Tone, string> = {
  saved: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  active: 'bg-indigo-600/15 text-indigo-700 dark:text-indigo-300',
  complete: 'bg-violet-600/15 text-violet-700 dark:text-violet-300',
  error: 'bg-red-600/15 text-red-700 dark:text-red-300',
};

const ICONS: Record<Tone, string> = {
  // Bookmark
  saved:
    'M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z',
  // Arrow down into a tray
  active: 'M12 4v11m0 0l-4-4m4 4l4-4M5 20h14',
  complete: 'M12 4v11m0 0l-4-4m4 4l4-4M5 20h14',
  // Exclamation
  error: 'M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
};

const Chip = ({
  tone,
  text,
  label,
  overlay,
}: {
  tone: Tone;
  text: string;
  label: string;
  overlay: boolean;
}) => (
  <span
    className={`flex w-fit items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] whitespace-nowrap ${
      overlay ? `border font-bold ${OVERLAY[tone]}` : `font-semibold ${INLINE[tone]}`
    }`}
    style={
      overlay
        ? { boxShadow: '0 2px 8px rgba(0, 0, 0, 0.4), 0 1px 3px rgba(0, 0, 0, 0.3)' }
        : undefined
    }
    title={label}
    aria-label={label}
  >
    <svg
      className="h-3 w-3"
      fill={tone === 'saved' ? 'currentColor' : 'none'}
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={ICONS[tone]} />
    </svg>
    {text}
  </span>
);

const downloadText = (summary: BookDownloadSummary): string => {
  if (summary.state === 'active') return 'Downloading';
  if (summary.state === 'complete') return 'Downloaded';
  return 'Failed';
};

interface ActivityChipsProps {
  book: ActivityBookRef;
  overlay?: boolean;
  className?: string;
}

/** "Saved" and "Downloaded" (or downloading, or failed) chips for a book; nothing if neither. */
export const ActivityChips = ({ book, overlay = false, className = '' }: ActivityChipsProps) => {
  const activity = useBookActivity();
  if (!activity) return null;
  const saved = activity.savedFor(book);
  const download = activity.downloadFor(book);
  if (!saved && !download) return null;
  return (
    <span className={`flex flex-wrap items-center gap-1 ${className}`}>
      {saved && <Chip tone="saved" text="Saved" label="In your Saved list" overlay={overlay} />}
      {download && (
        <Chip
          tone={download.state}
          text={downloadText(download)}
          label={`${downloadLabel(download)} (in your Downloads)`}
          overlay={overlay}
        />
      )}
    </span>
  );
};

interface BookStatusBadgesProps {
  book: Book;
  library?: LibraryOwnership | null;
  sources?: LibrarySources | null;
  /** Solid pills stacked over cover art; otherwise tinted inline pills. */
  overlay?: boolean;
  className?: string;
}

/** Everything known about a book already: in the library, saved, downloaded. */
export const BookStatusBadges = ({
  book,
  library,
  sources,
  overlay = false,
  className = '',
}: BookStatusBadgesProps) => (
  <span
    className={`flex gap-1 ${overlay ? 'flex-col items-end' : 'flex-wrap items-center'} ${className}`}
  >
    <LibraryBadge library={library} sources={sources} overlay={overlay} />
    <ActivityChips
      book={activityRef(book)}
      overlay={overlay}
      className={overlay ? 'flex-col items-end' : ''}
    />
  </span>
);
