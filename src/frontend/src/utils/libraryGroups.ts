import type { LibraryBook, LibraryFormat } from '../types';
import { firstLastName, firstLastSortKey, lastFirstSortKey } from './authorNames';
import { authorSortKey } from './libraryBrowser';

export interface LibraryAuthorGroup {
  name: string; // "First Last", however the library wrote it
  books: LibraryBook[];
  formats: LibraryFormat[];
  seriesCount: number;
  ebookCount: number;
  audiobookCount: number;
  latestAdded: number | null; // Unix time the newest book was added
}

export interface LibrarySeriesGroup {
  name: string;
  authors: string[]; // "First Last"
  books: LibraryBook[]; // In series order
  formats: LibraryFormat[];
  latestAdded: number | null; // Unix time the newest book was added
}

export interface LibrarySeriesSection {
  series: string | null; // null: books outside any series
  books: LibraryBook[];
}

const fold = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

export const sameName = (a: string, b: string): boolean => fold(a) === fold(b);

/** Same author, whether written "First Last" or "Last, First". */
export const sameAuthor = (a: string, b: string): boolean =>
  sameName(firstLastName(a), firstLastName(b));

// "2.5" -> 2.5; unnumbered books go last.
export const seriesNumberValue = (number: string | null | undefined): number => {
  const value = Number.parseFloat(number ?? '');
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
};

export const seriesNumberIn = (book: LibraryBook, series: string): string | null =>
  book.series.find((entry) => sameName(entry.name, series))?.number ?? null;

const collectFormats = (books: LibraryBook[]): LibraryFormat[] => {
  const formats = new Set(books.flatMap((book) => book.formats));
  return (['ebook', 'audiobook'] as const).filter((format) => formats.has(format));
};

const byTitle = (a: LibraryBook, b: LibraryBook): number => a.title.localeCompare(b.title);

const newestAdded = (books: LibraryBook[]): number | null =>
  books.reduce<number | null>(
    (latest, book) =>
      book.added_at !== null && (latest === null || book.added_at > latest)
        ? book.added_at
        : latest,
    null,
  );

// Oldest first, as an author's bibliography reads; undated books after, by title.
const byYear = (a: LibraryBook, b: LibraryBook): number =>
  (a.year ?? Number.POSITIVE_INFINITY) - (b.year ?? Number.POSITIVE_INFINITY) || byTitle(a, b);

export const sortInSeries = (books: LibraryBook[], series: string): LibraryBook[] =>
  books.toSorted(
    (a, b) =>
      seriesNumberValue(seriesNumberIn(a, series)) - seriesNumberValue(seriesNumberIn(b, series)) ||
      byTitle(a, b),
  );

export const groupByAuthor = (books: LibraryBook[]): LibraryAuthorGroup[] => {
  const groups = new Map<string, { name: string; books: LibraryBook[] }>();
  for (const book of books) {
    // "Weir, Andy" and "Andy Weir" are the same author.
    for (const author of book.authors) {
      const name = firstLastName(author);
      const key = fold(name);
      if (!key) continue;
      const group = groups.get(key) ?? { name, books: [] };
      if (!group.books.includes(book)) group.books.push(book);
      groups.set(key, group);
    }
  }
  return [...groups.values()]
    .map((group) => ({
      name: group.name,
      books: group.books.toSorted(byYear),
      formats: collectFormats(group.books),
      seriesCount: new Set(group.books.flatMap((book) => book.series.map((s) => fold(s.name))))
        .size,
      ebookCount: group.books.filter((book) => book.formats.includes('ebook')).length,
      audiobookCount: group.books.filter((book) => book.formats.includes('audiobook')).length,
      latestAdded: newestAdded(group.books),
    }))
    .toSorted((a, b) => authorSortKey(a.name).localeCompare(authorSortKey(b.name)));
};

export const groupBySeries = (books: LibraryBook[]): LibrarySeriesGroup[] => {
  const groups = new Map<string, { name: string; books: LibraryBook[] }>();
  for (const book of books) {
    for (const entry of book.series) {
      const key = fold(entry.name);
      if (!key) continue;
      const group = groups.get(key) ?? { name: entry.name, books: [] };
      group.books.push(book);
      groups.set(key, group);
    }
  }
  return [...groups.values()]
    .map((group) => {
      const authors: string[] = [];
      for (const book of group.books) {
        for (const author of book.authors) {
          if (!authors.some((known) => sameAuthor(known, author))) {
            authors.push(firstLastName(author));
          }
        }
      }
      return {
        name: group.name,
        authors,
        books: sortInSeries(group.books, group.name),
        formats: collectFormats(group.books),
        latestAdded: newestAdded(group.books),
      };
    })
    .toSorted((a, b) => fold(a.name).localeCompare(fold(b.name)));
};

export const booksByAuthor = (books: LibraryBook[], author: string): LibraryBook[] =>
  books.filter((book) => book.authors.some((name) => sameAuthor(name, author))).toSorted(byYear);

/** An author's books split by series (alphabetical), then the books outside any series. */
export const authorSeriesSections = (books: LibraryBook[]): LibrarySeriesSection[] => {
  const sections = groupBySeries(books).map((group) => ({
    series: group.name,
    books: group.books,
  }));
  const standalone = books.filter((book) => book.series.length === 0);
  return standalone.length > 0 ? [...sections, { series: null, books: standalone }] : sections;
};

/** "#1–5", "#2", or null when no book in the group is numbered. */
export const seriesRangeLabel = (group: LibrarySeriesGroup): string | null => {
  const numbers = group.books
    .map((book) => seriesNumberValue(seriesNumberIn(book, group.name)))
    .filter((value) => Number.isFinite(value));
  if (numbers.length === 0) return null;
  const low = Math.min(...numbers);
  const high = Math.max(...numbers);
  return low === high ? `#${low}` : `#${low}–${high}`;
};

/**
 * How authors are ordered. "series" is the series count (a table column); "series_order"
 * is Author › Series › Book: authors by last name, each one's books by series, then number.
 */
export type AuthorSortField = 'first' | 'last' | 'books' | 'series' | 'series_order' | 'added';
export type SortDirection = 'asc' | 'desc';

/** The direction a field starts in: names A–Z, counts and dates biggest first. */
export const defaultAuthorSortDirection = (field: AuthorSortField): SortDirection =>
  field === 'first' || field === 'last' || field === 'series_order' ? 'asc' : 'desc';

const isNameSort = (field: AuthorSortField): boolean =>
  field === 'first' || field === 'last' || field === 'series_order';

const authorNameKey = (group: LibraryAuthorGroup, field: AuthorSortField): string =>
  field === 'first' ? firstLastSortKey(group.name) : lastFirstSortKey(group.name);

/** Authors sorted by a field; ties fall back to the name (First Last). */
export const sortAuthorGroups = (
  groups: LibraryAuthorGroup[],
  field: AuthorSortField,
  direction: SortDirection,
): LibraryAuthorGroup[] => {
  const sign = direction === 'asc' ? 1 : -1;
  const value = (group: LibraryAuthorGroup): number => {
    if (field === 'books') return group.books.length;
    if (field === 'series') return group.seriesCount;
    return group.latestAdded ?? 0;
  };
  return groups.toSorted((a, b) => {
    if (isNameSort(field)) {
      return sign * authorNameKey(a, field).localeCompare(authorNameKey(b, field));
    }
    return (
      sign * (value(a) - value(b)) ||
      firstLastSortKey(a.name).localeCompare(firstLastSortKey(b.name))
    );
  });
};

export type SeriesSortField = 'name' | 'author_first' | 'author_last' | 'books' | 'added';

/** The direction a field starts in: names A–Z, counts and dates biggest first. */
export const defaultSeriesSortDirection = (field: SeriesSortField): SortDirection =>
  field === 'books' || field === 'added' ? 'desc' : 'asc';

const seriesNameKey = (group: LibrarySeriesGroup): string =>
  group.name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^(the|a|an)\s+/, '');

/** Series sorted by a field; ties (an author's several series) fall back to the series name. */
export const sortSeriesGroups = (
  groups: LibrarySeriesGroup[],
  field: SeriesSortField,
  direction: SortDirection,
): LibrarySeriesGroup[] => {
  const sign = direction === 'asc' ? 1 : -1;
  const byName = (a: LibrarySeriesGroup, b: LibrarySeriesGroup) =>
    seriesNameKey(a).localeCompare(seriesNameKey(b));
  return groups.toSorted((a, b) => {
    if (field === 'author_first' || field === 'author_last') {
      const key = field === 'author_last' ? lastFirstSortKey : firstLastSortKey;
      return sign * key(a.authors[0] ?? '').localeCompare(key(b.authors[0] ?? '')) || byName(a, b);
    }
    if (field === 'books') return sign * (a.books.length - b.books.length) || byName(a, b);
    if (field === 'added')
      return sign * ((a.latestAdded ?? 0) - (b.latestAdded ?? 0)) || byName(a, b);
    return sign * byName(a, b);
  });
};
