/** Saved for later: books, and the releases picked for them, to download later. */

import type { DownloadReleasePayload } from '../services/api';
import type { Book, ContentType, Release } from '../types';
import { isPartRelease, releaseNarrators } from './combinedSelection';
import { narratorNames, shortNarrators } from './narrators';
import { buildReleaseDownloadPayload } from './releasePayload';

export type SavedKind = 'book' | 'release' | 'combined';

export interface SavedPick {
  content_type: ContentType; // What this release is: the ebook or an audiobook
  release: Release;
}

/** Per-item conditions from before the one ratio rule; still reported, no longer used. */
interface SavedConditions {
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
  queue_position: number | null; // Place in the download queue, as the user ordered it
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

/**
 * Where a saved item stands: queued for download once its releases are picked and set to
 * go on their own, else saved for later (a book alone, or picks to get by hand).
 */
export type SavedStage = 'queued' | 'later';

export const savedStage = (item: Pick<SavedItem, 'releases' | 'auto_get'>): SavedStage =>
  item.releases.length > 0 && item.auto_get ? 'queued' : 'later';

/**
 * Items queued to download on their own, in the order they get first claim on room:
 * the ones the user placed, then the rest oldest first (as the server checks them).
 */
export const queueOrder = <T extends Pick<SavedItem, 'id' | 'queue_position' | 'created_at'>>(
  items: readonly T[],
): T[] =>
  items.toSorted((a, b) => {
    const aPos = a.queue_position ?? Number.POSITIVE_INFINITY;
    const bPos = b.queue_position ?? Number.POSITIVE_INFINITY;
    if (aPos !== bPos) return aPos - bPos;
    if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
    return a.id - b.id;
  });

export const SAVED_STAGE_LABELS: Record<SavedStage, string> = {
  queued: 'Queued for download',
  later: 'Saved for later',
};

/** Whether any pick is a MyAnonamouse torrent: only those wait for room or the ratio. */
export const hasMamPick = (item: Pick<SavedItem, 'releases'>): boolean =>
  item.releases.some((pick) => Boolean(pick.release.extra?.mam_torrent_id));

/** The key a book is saved under, as the server works it out: one saved item per book. */
export const savedBookKey = (book: Pick<Book, 'id' | 'provider' | 'provider_id'>): string =>
  book.provider && book.provider_id ? `${book.provider}:${book.provider_id}` : `id:${book.id}`;

const formatLabel = (release: Release): string => (release.format ?? '').toUpperCase();

const narratorsOf = (release: Release): string[] =>
  narratorNames(release.extra?.narrators ?? release.extra?.narrator);

/**
 * One pick as a badge names it: an audiobook by its narrators, the first and how many
 * more ("Andrew Scott +9"), or all of them with `full`; an ebook by its format.
 */
export const pickLabel = (pick: SavedPick, { full = false }: { full?: boolean } = {}): string => {
  if (pick.content_type === 'audiobook') {
    const names = narratorsOf(pick.release);
    if (names.length === 0) return 'Audiobook';
    return full ? names.join(', ') : shortNarrators(names);
  }
  return formatLabel(pick.release) || 'Ebook';
};

/**
 * What a saved item will download, one line per release: "Ebook, EPUB", "Audiobook,
 * Narrator Name +2"; `full` names every narrator. Empty for a book with none picked.
 */
export const savedPickLines = (
  item: Pick<SavedItem, 'kind' | 'releases'>,
  { full = false }: { full?: boolean } = {},
): string[] => {
  if (item.kind === 'book') return [];
  return item.releases.map((pick) => {
    if (pick.content_type === 'audiobook') {
      const names = narratorsOf(pick.release);
      if (names.length === 0) return 'Audiobook';
      return `Audiobook, ${full ? names.join(', ') : shortNarrators(names)}`;
    }
    const format = formatLabel(pick.release);
    return format ? `Ebook, ${format}` : 'Ebook';
  });
};

/**
 * What a queued item waits for, from the last automatic check's status: "2 unsatisfied
 * slots", "Freeleech or ratio 2.00: …". Null before its first check.
 */
export const waitingFor = (item: Pick<SavedItem, 'auto_status'>): string | null => {
  const status = item.auto_status?.trim();
  if (!status) return null;
  const reason = status.replace(/^waiting for\s+/i, '');
  return reason.charAt(0).toUpperCase() + reason.slice(1);
};

/**
 * What a saved item will download: "Ebook EPUB + audiobook, Narrator Name +2", or "Book
 * only"; `full` names every narrator.
 */
export const describeSavedPick = (
  item: Pick<SavedItem, 'kind' | 'releases'>,
  { full = false }: { full?: boolean } = {},
): string => {
  if (item.kind === 'book' || item.releases.length === 0) return 'Book only, pick a release later';
  const parts = item.releases.map((pick) => {
    if (pick.content_type === 'audiobook') {
      const names = narratorsOf(pick.release);
      if (names.length === 0) return 'audiobook';
      return `audiobook, ${full ? names.join(', ') : shortNarrators(names)}`;
    }
    const format = formatLabel(pick.release);
    return format ? `ebook ${format}` : 'ebook';
  });
  const text = parts.join(' + ');
  return text.charAt(0).toUpperCase() + text.slice(1);
};
