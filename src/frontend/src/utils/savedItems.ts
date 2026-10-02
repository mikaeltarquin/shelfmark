/** Saved for later: books, and the releases picked for them, to download later. */

import type { DownloadReleasePayload } from '../services/api';
import type { Book, ContentType, Release } from '../types';
import { isPartRelease, releaseNarrators } from './combinedSelection';
import { buildReleaseDownloadPayload } from './releasePayload';

export type SavedKind = 'book' | 'release' | 'combined';

// Ratio an automatic download keeps by default (matches the server).
export const DEFAULT_MIN_RATIO = 2.0;

export interface SavedPick {
  content_type: ContentType; // What this release is: the ebook or an audiobook
  release: Release;
}

export interface SavedConditions {
  freeleech_only: boolean;
  min_ratio_enabled: boolean;
  min_ratio: number; // Ratio the account keeps after the download
}

export interface SavedItem {
  id: number;
  book_key: string;
  kind: SavedKind;
  content_type: ContentType | 'combined';
  title: string;
  author: string | null;
  book: Book;
  releases: SavedPick[];
  has_payloads: boolean;
  auto_get: boolean;
  conditions: SavedConditions;
  last_error: string | null;
  auto_status: string | null; // Why an automatic download is still waiting
  auto_checked_at: string | null;
  created_at: string;
  updated_at: string;
}

/** A combined selection as saved picks: the ebook (if any) first, then each audiobook. */
export const combinedPicks = (
  ebook: Release | null | undefined,
  audiobooks: readonly Release[],
): SavedPick[] => [
  ...(ebook ? [{ content_type: 'ebook' as const, release: ebook }] : []),
  ...audiobooks.map((release) => ({ content_type: 'audiobook' as const, release })),
];

/**
 * The download payloads for saved picks, one per pick, as a manual Get would send them:
 * an ebook picked with audiobooks goes into their narrators' folders.
 */
export const savedPayloads = (
  book: Book,
  picks: readonly SavedPick[],
): DownloadReleasePayload[] => {
  const companionAudiobookNarrators = picks
    .filter((pick) => pick.content_type === 'audiobook' && !isPartRelease(pick.release))
    .map((pick) => releaseNarrators(pick.release));
  return picks.map((pick) =>
    buildReleaseDownloadPayload(
      book,
      pick.release,
      pick.content_type,
      pick.content_type === 'ebook' ? { companionAudiobookNarrators } : {},
    ),
  );
};

/** Whether any pick is a MyAnonamouse torrent: only those wait for room or conditions. */
export const hasMamPick = (item: Pick<SavedItem, 'releases'>): boolean =>
  item.releases.some((pick) => Boolean(pick.release.extra?.mam_torrent_id));

/** The key a book is saved under, as the server works it out: one saved item per book. */
export const savedBookKey = (book: Pick<Book, 'id' | 'provider' | 'provider_id'>): string =>
  book.provider && book.provider_id ? `${book.provider}:${book.provider_id}` : `id:${book.id}`;

const formatLabel = (release: Release): string => (release.format ?? '').toUpperCase();

const narratorOf = (release: Release): string | null => {
  const raw = release.extra?.narrators ?? release.extra?.narrator;
  if (Array.isArray(raw)) return raw.filter((n): n is string => typeof n === 'string').join(', ');
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
};

/** What a saved item will download: "Ebook EPUB + audiobook, Narrator Name", or "Book only". */
export const describeSavedPick = (item: Pick<SavedItem, 'kind' | 'releases'>): string => {
  if (item.kind === 'book' || item.releases.length === 0) return 'Book only, pick a release later';
  const parts = item.releases.map((pick) => {
    if (pick.content_type === 'audiobook') {
      const narrator = narratorOf(pick.release);
      return narrator ? `audiobook, ${narrator}` : 'audiobook';
    }
    const format = formatLabel(pick.release);
    return format ? `ebook ${format}` : 'ebook';
  });
  const text = parts.join(' + ');
  return text.charAt(0).toUpperCase() + text.slice(1);
};
