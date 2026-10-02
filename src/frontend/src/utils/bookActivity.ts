/**
 * Whether a book is already in the Saved list or the Downloads list, wherever it shows.
 *
 * Downloads made for a metadata book carry its key ("hardcover:446681"); older ones, and
 * books in the library (which have no provider id), are matched by title and author.
 */

import type { ContentType, StatusData } from '../types';
import type { SavedItem } from './savedItems';

/** One download, reduced to the book it was for and where it stands. */
export interface BookDownloadEntry {
  id: string;
  book_key: string | null;
  title: string | null;
  author: string | null;
  content_type: string | null;
  status: string; // A queue bucket: queued, downloading, complete, error, cancelled…
}

type BookDownloadState = 'active' | 'complete' | 'error';

/** Where a book stands in Downloads: the most advanced state, and for which formats. */
export interface BookDownloadSummary {
  state: BookDownloadState;
  formats: ContentType[];
}

/** What the activity marks know about a book. */
export interface ActivityBookRef {
  key?: string | null; // "provider:provider_id", when the book has one
  title: string;
  authors: string[];
}

const ACTIVE = new Set(['queued', 'resolving', 'locating', 'downloading']);

const STATUS_BUCKETS = [
  'queued',
  'resolving',
  'locating',
  'downloading',
  'complete',
  'error',
  'cancelled',
] as const satisfies readonly (keyof StatusData)[];

const fold = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** "The Martian: A Novel" and "Martian" are the same title for matching. */
export const titleKey = (title: string): string =>
  fold(title.split(/[:([]/)[0] ?? title)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/^(the|a|an) /, '');

/** "Andy Weir", "Weir, Andy" -> "weir". */
const surnameKey = (author: string): string => {
  const name = fold(author).trim();
  if (name.includes(',')) return name.split(',')[0].trim();
  const words = name
    .replace(/[^\p{L}\p{N}' -]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  return words.at(-1) ?? '';
};

const authorList = (author: string | null): string[] =>
  (author ?? '')
    .split(/\s*(?:;|&| and )\s*/)
    .map((name) => name.trim())
    .filter(Boolean);

const sameAuthors = (a: string[], b: string[]): boolean => {
  if (a.length === 0 || b.length === 0) return true; // Nothing to tell them apart
  const surnames = new Set(a.map(surnameKey));
  return b.some((name) => surnames.has(surnameKey(name)));
};

const providerOf = (key: string): string => key.split(':')[0];

/**
 * Whether a list entry recorded for `entryKey` may still be `book` by title: when either
 * has no provider key, or the keys are from different providers. Another key from the
 * same provider is another book, whatever its title.
 */
const titleMatchAllowed = (book: ActivityBookRef, entryKey: string | null): boolean =>
  !book.key ||
  !entryKey ||
  entryKey.startsWith('id:') ||
  providerOf(entryKey) !== providerOf(book.key);

/** Whether a title and author (as a download recorded them) are this book. */
export const isSameBook = (book: ActivityBookRef, title: string, author: string | null): boolean =>
  titleKey(book.title) === titleKey(title) && sameAuthors(book.authors, authorList(author));

/** "hardcover:42" as provider and id; null for keys that aren't a metadata book. */
export const parseBookKey = (
  key: string | null | undefined,
): { provider: string; providerId: string } | null => {
  if (!key) return null;
  const separator = key.indexOf(':');
  const provider = key.slice(0, separator);
  const providerId = key.slice(separator + 1);
  if (separator <= 0 || !providerId || provider === 'id' || provider === 'manual') return null;
  return { provider, providerId };
};

const formatOf = (contentType: string | null): ContentType =>
  contentType && fold(contentType).includes('audio') ? 'audiobook' : 'ebook';

const rank = (status: string): number => {
  if (ACTIVE.has(status)) return 3;
  if (status === 'complete') return 2;
  if (status === 'error') return 1;
  return 0; // Cancelled downloads say nothing about the book
};

/**
 * The downloads to mark books with: the full history read once, overlaid with the live
 * status, which has every download queued since and the current state of each.
 */
export const mergeDownloads = (
  history: readonly BookDownloadEntry[],
  status: StatusData,
): BookDownloadEntry[] => {
  const byId = new Map(history.map((entry) => [entry.id, entry]));
  for (const bucket of STATUS_BUCKETS) {
    for (const [id, book] of Object.entries(status[bucket] ?? {})) {
      const previous = byId.get(id);
      byId.set(id, {
        id,
        book_key: book.book_key ?? previous?.book_key ?? null,
        title: book.title || previous?.title || null,
        author: book.author || previous?.author || null,
        content_type: book.content_type ?? previous?.content_type ?? null,
        status: bucket,
      });
    }
  }
  return [...byId.values()];
};

export interface DownloadIndex {
  byKey: Map<string, BookDownloadEntry[]>;
  byTitle: Map<string, BookDownloadEntry[]>; // Downloads with no book key, by title
}

const push = <K, V>(map: Map<K, V[]>, key: K, value: V) => {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
};

export const indexDownloads = (entries: readonly BookDownloadEntry[]): DownloadIndex => {
  const index: DownloadIndex = { byKey: new Map(), byTitle: new Map() };
  for (const entry of entries) {
    if (rank(entry.status) === 0) continue;
    if (entry.book_key) push(index.byKey, entry.book_key, entry);
    // Library books have no provider key, so every download is also findable by title.
    if (entry.title) push(index.byTitle, titleKey(entry.title), entry);
  }
  return index;
};

/** Where a book stands in Downloads, or null when it was never downloaded. */
export const downloadSummary = (
  index: DownloadIndex,
  book: ActivityBookRef,
): BookDownloadSummary | null => {
  const keyed = book.key ? (index.byKey.get(book.key) ?? []) : [];
  const byTitle = (index.byTitle.get(titleKey(book.title)) ?? []).filter(
    (entry) =>
      titleMatchAllowed(book, entry.book_key) &&
      sameAuthors(book.authors, authorList(entry.author)),
  );
  const matches = [...new Set([...keyed, ...byTitle])];
  if (matches.length === 0) return null;
  const best = Math.max(...matches.map((entry) => rank(entry.status)));
  const top = matches.filter((entry) => rank(entry.status) === best);
  let state: BookDownloadState = 'error';
  if (best === 3) state = 'active';
  else if (best === 2) state = 'complete';
  const formats = (['ebook', 'audiobook'] as const).filter((format) =>
    top.some((entry) => formatOf(entry.content_type) === format),
  );
  return { state, formats };
};

/** The saved item for a book: by its key, or (library books) by title and author. */
export const savedItemFor = (
  items: readonly SavedItem[],
  book: ActivityBookRef,
): SavedItem | undefined => {
  if (book.key) {
    const keyed = items.find((item) => item.book_key === book.key);
    if (keyed) return keyed;
  }
  const title = titleKey(book.title);
  return items.find(
    (item) =>
      titleMatchAllowed(book, item.book_key) &&
      titleKey(item.title) === title &&
      sameAuthors(book.authors, authorList(item.author)),
  );
};

/** "Downloading", "Downloaded audiobook", "Download failed" for a summary. */
export const downloadLabel = (summary: BookDownloadSummary): string => {
  const what = summary.formats.length === 1 ? ` ${summary.formats[0]}` : '';
  if (summary.state === 'active') return `Downloading${what}`;
  if (summary.state === 'complete') return `Downloaded${what}`;
  return `Download failed${what}`;
};
