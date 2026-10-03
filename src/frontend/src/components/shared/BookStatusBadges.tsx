import { useBookActivity } from '../../contexts/BookActivityContext';
import type { Book, LibraryOwnership, LibrarySources, Release } from '../../types';
import {
  downloadLabel,
  type ActivityBookRef,
  type BookDownloadState,
  type BookDownloadSummary,
} from '../../utils/bookActivity';
import { savedStage, type SavedItem } from '../../utils/savedItems';
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

type Tone = 'saved' | 'queued' | 'active' | 'complete' | 'error';

const OVERLAY: Record<Tone, string> = {
  saved: 'border-amber-600 bg-amber-500 text-white',
  queued: 'border-sky-700 bg-sky-600 text-white',
  active: 'border-indigo-700 bg-indigo-600 text-white',
  complete: 'border-violet-700 bg-violet-600 text-white',
  error: 'border-red-700 bg-red-600 text-white',
};

const INLINE: Record<Tone, string> = {
  saved: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  queued: 'bg-sky-600/15 text-sky-700 dark:text-sky-300',
  active: 'bg-indigo-600/15 text-indigo-700 dark:text-indigo-300',
  complete: 'bg-violet-600/15 text-violet-700 dark:text-violet-300',
  error: 'bg-red-600/15 text-red-700 dark:text-red-300',
};

const ICONS: Record<Tone, string> = {
  // Bookmark
  saved:
    'M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z',
  // Clock
  queued: 'M12 7v5l3 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
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
  // Off where the library itself shows what's held: a finished download says nothing more.
  showDownloaded?: boolean;
}

const SavedChip = ({ item, overlay }: { item: SavedItem; overlay: boolean }) =>
  savedStage(item) === 'queued' ? (
    <Chip
      tone="queued"
      text="Queued"
      label="Queued for download: it downloads on its own once there's room"
      overlay={overlay}
    />
  ) : (
    <Chip
      tone="saved"
      text="Saved for later"
      label="Saved for later (in Activity › Saved)"
      overlay={overlay}
    />
  );

/**
 * "Saved for later" or "Queued", and "Downloaded" (or downloading, or failed) chips for a
 * book; nothing if neither.
 */
export const ActivityChips = ({
  book,
  overlay = false,
  className = '',
  showDownloaded = true,
}: ActivityChipsProps) => {
  const activity = useBookActivity();
  if (!activity) return null;
  const saved = activity.savedFor(book);
  const found = activity.downloadFor(book);
  const download = found && (showDownloaded || found.state !== 'complete') ? found : null;
  if (!saved && !download) return null;
  return (
    <span className={`flex flex-wrap items-center gap-1 ${className}`}>
      {saved && <SavedChip item={saved} overlay={overlay} />}
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

const RELEASE_DOWNLOAD: Record<BookDownloadState, { text: string; label: string }> = {
  active: { text: 'Downloading', label: 'This release is downloading' },
  complete: { text: 'Downloaded', label: 'You downloaded this release' },
  error: { text: 'Failed', label: 'This release failed to download (see Activity › History)' },
};

/**
 * Marks for one release in a release list: queued or saved for later when it's a saved
 * pick for its book, and downloaded (or downloading, or failed) when it was downloaded.
 */
export const ReleaseChips = ({
  book,
  release,
  className = '',
}: {
  book: Book | undefined;
  release: Pick<Release, 'source' | 'source_id'>;
  className?: string;
}) => {
  const activity = useBookActivity();
  if (!activity) return null;
  const saved = book ? activity.savedFor(activityRef(book)) : undefined;
  const picked = saved?.releases.some(
    (pick) =>
      pick.release.source === release.source && pick.release.source_id === release.source_id,
  );
  const download = activity.releaseDownloadFor(release.source_id);
  if (!picked && !download) return null;
  return (
    <span className={`flex flex-wrap items-center gap-1 ${className}`}>
      {picked && saved && <SavedChip item={saved} overlay={false} />}
      {download && (
        <Chip
          tone={download}
          text={RELEASE_DOWNLOAD[download].text}
          label={RELEASE_DOWNLOAD[download].label}
          overlay={false}
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
