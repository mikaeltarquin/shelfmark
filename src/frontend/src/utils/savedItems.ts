/** Saved for later: books, and the releases picked for them, to download later. */

import type { Book, ContentType, Release } from '../types';

export type SavedKind = 'book' | 'release' | 'combined';

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
  created_at: string;
  updated_at: string;
}

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
