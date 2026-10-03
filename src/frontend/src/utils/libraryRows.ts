import type { Book, LibraryBook, LibraryFormat } from '../types';
import { isSameBook } from './bookActivity';
import { matchesFormat, type LibraryFormatFilter } from './libraryBrowser';
import { seriesNumberValue } from './libraryGroups';
import { isMissing } from './libraryMissing';

/** Which books a list shows: the library's own, the provider's missing ones, or both. */
export type OwnershipFilter = 'owned' | 'missing' | 'all';

/**
 * One row of a library book table: a book in the library, or one the metadata provider
 * lists for an author or series that the library lacks (in some format). A library book
 * the provider lists as lacking a format carries that record and the formats it lacks.
 */
export type LibraryRow =
  | {
      kind: 'owned';
      key: string;
      book: LibraryBook;
      match: Book | null; // The provider's record, when its list named this book
      missingFormats: LibraryFormat[];
    }
  | { kind: 'missing'; key: string; book: Book; missingFormats: LibraryFormat[] };

const FORMATS: readonly LibraryFormat[] = ['ebook', 'audiobook'];

export const ownedRow = (book: LibraryBook): LibraryRow => ({
  kind: 'owned',
  key: `owned:${book.id}`,
  book,
  match: null,
  missingFormats: [],
});

export const missingRow = (book: Book): LibraryRow => ({
  kind: 'missing',
  key: `missing:${book.id}`,
  book,
  missingFormats: FORMATS.filter((format) => isMissing(book, format)),
});

const providerAuthors = (book: Book): string[] => {
  if (book.authors && book.authors.length > 0) return book.authors;
  return book.author ? [book.author] : [];
};

/**
 * The library's books with the provider's missing ones: a book held in one format that the
 * provider lists as lacking the other joins the library's row for it, so each book is one
 * row whatever it lacks. The rest are rows of their own.
 */
export const combineRows = (
  owned: readonly LibraryBook[],
  missing: readonly Book[],
): LibraryRow[] => {
  const rows = owned.map(ownedRow);
  const extra: LibraryRow[] = [];
  for (const book of missing) {
    const row = missingRow(book);
    const partly = row.missingFormats.length < FORMATS.length;
    const target = partly
      ? rows.find(
          (candidate) =>
            candidate.kind === 'owned' &&
            candidate.match === null &&
            isSameBook(
              { title: candidate.book.title, authors: candidate.book.authors },
              book.title,
              providerAuthors(book).join('; ') || null,
            ),
        )
      : undefined;
    if (target?.kind === 'owned') {
      target.match = book;
      target.missingFormats = row.missingFormats.filter(
        (format) => !target.book.formats.includes(format),
      );
    } else {
      extra.push(row);
    }
  }
  return [...rows, ...extra];
};

export const rowTitle = (row: LibraryRow): string => row.book.title;

export const rowAuthors = (row: LibraryRow): string[] => {
  if (row.kind === 'owned') return row.book.authors;
  if (row.book.authors && row.book.authors.length > 0) return row.book.authors;
  return row.book.author ? [row.book.author] : [];
};

export const rowYear = (row: LibraryRow): number | null => {
  if (row.kind === 'owned') return row.book.year;
  const year = Number.parseInt(row.book.year ?? '', 10);
  return Number.isFinite(year) ? year : null;
};

/** The row's series, or the named one when the book is in it; its number as text. */
export const rowSeries = (
  row: LibraryRow,
  series?: string,
): { name: string; number: string | null } | null => {
  if (row.kind === 'owned') {
    const entry = series
      ? row.book.series.find((candidate) => sameSeries(candidate.name, series))
      : row.book.series[0];
    if (entry) return { name: entry.name, number: entry.number };
    // A series the library doesn't record, but the provider's record of the book does.
    return row.match ? missingSeries(row.match, series) : null;
  }
  return missingSeries(row.book, series);
};

const missingSeries = (
  book: Book,
  series?: string,
): { name: string; number: string | null } | null => {
  const name = book.series_name;
  if (!name) return series ? { name: series, number: missingNumber(book) } : null;
  if (series && !sameSeries(name, series)) return { name: series, number: null };
  return { name, number: missingNumber(book) };
};

/** Every series the row is in: the library's own, plus one only the provider's record names. */
const rowSeriesNames = (row: LibraryRow): string[] => {
  const names = row.kind === 'owned' ? row.book.series.map((entry) => entry.name) : [];
  const provider = row.kind === 'owned' ? row.match?.series_name : row.book.series_name;
  if (provider && !names.some((name) => sameSeries(name, provider))) names.push(provider);
  return names.filter((name) => fold(name));
};

const missingNumber = (book: Book): string | null =>
  book.series_position != null ? String(book.series_position) : null;

const lacks = (missingFormats: LibraryFormat[], format: LibraryFormatFilter): boolean => {
  if (format === 'any') return missingFormats.length === FORMATS.length;
  if (format === 'both') return missingFormats.length > 0;
  return missingFormats.includes(format);
};

/**
 * Whether a row passes the ownership and format filters. A book counts as owned when the
 * library has the format, and as missing when it lacks it ("any": held in no format;
 * "both": lacking either). A library book lacking a format can be both.
 */
export const rowMatches = (
  row: LibraryRow,
  ownership: OwnershipFilter,
  format: LibraryFormatFilter,
): boolean => {
  const owned = row.kind === 'owned' && matchesFormat(row.book, format);
  const missing = row.missingFormats.length > 0 && lacks(row.missingFormats, format);
  if (ownership === 'owned') return owned;
  if (ownership === 'missing') return missing;
  return owned || missing;
};

const fold = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/^(the|a|an)\s+/, '');

// "The Expanse" and "Expanse" are one series, however each book's record writes it.
const sameSeries = (a: string, b: string): boolean => fold(a) === fold(b);

const byTitle = (a: LibraryRow, b: LibraryRow): number =>
  fold(rowTitle(a)).localeCompare(fold(rowTitle(b)));

const byYear = (a: LibraryRow, b: LibraryRow): number =>
  (rowYear(a) ?? Number.POSITIVE_INFINITY) - (rowYear(b) ?? Number.POSITIVE_INFINITY) ||
  byTitle(a, b);

const numberIn = (row: LibraryRow, series: string): number =>
  seriesNumberValue(rowSeries(row, series)?.number);

/** Reading order within one series; unnumbered books last, by title. */
export const sortRowsInSeries = (rows: LibraryRow[], series: string): LibraryRow[] =>
  rows.toSorted((a, b) => numberIn(a, series) - numberIn(b, series) || byTitle(a, b));

/** Oldest first, as a bibliography reads; undated books after, by title. */
export const sortRowsByYear = (rows: LibraryRow[]): LibraryRow[] => rows.toSorted(byYear);

export interface LibraryRowSection {
  series: string | null; // null: books outside any series
  rows: LibraryRow[];
}

/**
 * Series › book: each series (A–Z) in reading order, then the books outside any series.
 * A book in several series (Stormlight and the Cosmere) appears under each of them.
 */
export const rowSeriesSections = (rows: LibraryRow[]): LibraryRowSection[] => {
  const sections = new Map<string, LibraryRowSection>();
  const standalone: LibraryRow[] = [];
  for (const row of rows) {
    const names = rowSeriesNames(row);
    if (names.length === 0) {
      standalone.push(row);
      continue;
    }
    for (const name of names) {
      const key = fold(name);
      const section = sections.get(key) ?? { series: name, rows: [] };
      if (!section.rows.includes(row)) section.rows.push(row);
      sections.set(key, section);
    }
  }
  const ordered = [...sections.values()]
    .toSorted((a, b) => fold(a.series ?? '').localeCompare(fold(b.series ?? '')))
    .map((section) => ({
      series: section.series,
      rows: sortRowsInSeries(section.rows, section.series ?? ''),
    }));
  return standalone.length > 0
    ? [...ordered, { series: null, rows: sortRowsByYear(standalone) }]
    : ordered;
};
