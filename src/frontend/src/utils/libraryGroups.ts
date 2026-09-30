import type { LibraryBook, LibraryFormat } from '../types';
import { authorSortKey } from './libraryBrowser';

export interface LibraryAuthorGroup {
  name: string;
  books: LibraryBook[];
  formats: LibraryFormat[];
  seriesCount: number;
}

export interface LibrarySeriesGroup {
  name: string;
  authors: string[];
  books: LibraryBook[]; // In series order
  formats: LibraryFormat[];
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
    for (const author of book.authors) {
      const key = fold(author);
      if (!key) continue;
      const group = groups.get(key) ?? { name: author, books: [] };
      group.books.push(book);
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
          if (!authors.some((known) => sameName(known, author))) authors.push(author);
        }
      }
      return {
        name: group.name,
        authors,
        books: sortInSeries(group.books, group.name),
        formats: collectFormats(group.books),
      };
    })
    .toSorted((a, b) => fold(a.name).localeCompare(fold(b.name)));
};

export const booksByAuthor = (books: LibraryBook[], author: string): LibraryBook[] =>
  books.filter((book) => book.authors.some((name) => sameName(name, author))).toSorted(byYear);

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
