import type { MouseEvent } from 'react';
import { useState } from 'react';

import { singlePick, useSavedItems } from '../contexts/SavedItemsContext';
import type { Book, ContentType, Release } from '../types';

// Heroicons' bookmark, outlined when not saved and filled when saved.
const BOOKMARK_PATH =
  'M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z';

export const BookmarkIcon = ({ filled, className }: { filled: boolean; className: string }) => (
  <svg
    className={className}
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill={filled ? 'currentColor' : 'none'}
    stroke="currentColor"
    strokeWidth={1.75}
    aria-hidden="true"
  >
    <path strokeLinecap="round" strokeLinejoin="round" d={BOOKMARK_PATH} />
  </svg>
);

interface SaveForLaterButtonProps {
  book: Book;
  /** What the book is saved for; the search's content type by default. */
  contentType?: ContentType | 'combined';
  /** Save this exact release instead of just the book. */
  release?: Release;
  /** 'card': the round button on a cover; 'row': a release row's icon button;
   *  'inline': a small bordered button beside a card's Details and Get on phones. */
  variant?: 'card' | 'row' | 'inline';
  className?: string;
}

/** Save a book (or one release of it) to download later, or remove it from Saved. */
export const SaveForLaterButton = ({
  book,
  contentType,
  release,
  variant = 'card',
  className = '',
}: SaveForLaterButtonProps) => {
  const saved = useSavedItems();
  const [busy, setBusy] = useState(false);
  if (!saved) return null;
  const savedAs = contentType ?? saved.contentType;

  const item = saved.savedFor(book);
  // A release row is "saved" only when this exact release is the saved pick.
  const isSaved = release
    ? Boolean(
        item?.releases.some(
          (pick) =>
            pick.release.source === release.source && pick.release.source_id === release.source_id,
        ),
      )
    : Boolean(item);

  const releaseType: ContentType = savedAs === 'audiobook' ? 'audiobook' : 'ebook';
  let label = 'Save for later';
  if (isSaved) label = 'Remove from Saved';
  else if (release) label = 'Save this release for later';

  const handleClick = async (event: MouseEvent) => {
    event.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      if (isSaved && item) {
        await saved.remove(item);
      } else if (release) {
        await saved.savePicks(book, releaseType, singlePick(release, releaseType));
      } else {
        await saved.saveBook(book, savedAs);
      }
    } finally {
      setBusy(false);
    }
  };

  const tone = isSaved ? 'text-amber-500 dark:text-amber-400' : '';
  const bases = {
    card: 'flex h-8 w-8 items-center justify-center rounded-full bg-white/95 shadow-lg transition-all duration-300 hover:scale-110 dark:bg-neutral-800/95',
    row: `hover-action flex aspect-square items-center justify-center rounded-full p-2 transition-all duration-200 sm:p-1.5 ${
      isSaved ? '' : 'text-gray-600 dark:text-gray-200'
    }`,
    inline:
      'flex items-center justify-center rounded-sm border border-(--border-muted) px-2.5 py-1.5',
  };
  const base = bases[variant];

  return (
    <button
      type="button"
      onClick={(event) => void handleClick(event)}
      disabled={busy}
      className={`${base} ${tone} ${className}`}
      aria-label={label}
      aria-pressed={isSaved}
      title={label}
    >
      <BookmarkIcon filled={isSaved} className={variant === 'row' ? 'h-5 w-5' : 'h-4 w-4'} />
    </button>
  );
};
