import type { Book, LibraryBook, LibraryFormat } from '../types';
import { matchesFormat, type LibraryFormatFilter } from './libraryBrowser';
import { sameName, seriesNumberIn, seriesNumberValue } from './libraryGroups';
import { isMissing } from './libraryMissing';

/** Which books a list shows: the library's own, the provider's missing ones, or both. */
export type OwnershipFilter = 'owned' | 'missing' | 'all';

/**
 * One row of a library book table: a book in the library, or one the metadata provider
 * lists for an author or series that the library lacks (in some format).
 */
export type LibraryRow =
  | { kind: 'owned'; key: string; book: LibraryBook }
  | { kind: 'missing'; key: string; book: Book; missingFormats: LibraryFormat[] };

const FORMATS: readonly LibraryFormat[] = ['ebook', 'audiobook'];

export const ownedRow = (book: LibraryBook): LibraryRow => ({
  kind: 'owned',
  key: `owned:${book.id}`,
  book,
});

export const missingRow = (book: Book): LibraryRow => ({
  kind: 'missing',
  key: `missing:${book.id}`,
  book,
  missingFormats: FORMATS.filter((format) => isMissing(book, format)),
});

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
      ? row.book.series.find((candidate) => sameName(candidate.name, series))
      : row.book.series[0];
    return entry ? { name: entry.name, number: entry.number } : null;
  }
  const name = row.book.series_name;
  if (!name) return series ? { name: series, number: missingNumber(row.book) } : null;
  if (series && !sameName(name, series)) return { name: series, number: null };
  return { name, number: missingNumber(row.book) };
};

const missingNumber = (book: Book): string | null =>
  book.series_position != null ? String(book.series_position) : null;

/**
 * Whether a row passes the ownership and format filters. An owned row needs the format;
 * a missing row must lack it ("any": held in no format; "both": lacking either).
 */
export const rowMatches = (
  row: LibraryRow,
  ownership: OwnershipFilter,
  format: LibraryFormatFilter,
): boolean => {
  if (row.kind === 'owned') return ownership !== 'missing' && matchesFormat(row.book, format);
  if (ownership === 'owned') return false;
  if (format === 'any') return row.missingFormats.length === FORMATS.length;
  if (format === 'both') return row.missingFormats.length > 0;
  return row.missingFormats.includes(format);
};

const fold = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/^(the|a|an)\s+/, '');

const byTitle = (a: LibraryRow, b: LibraryRow): number =>
  fold(rowTitle(a)).localeCompare(fold(rowTitle(b)));

const byYear = (a: LibraryRow, b: LibraryRow): number =>
  (rowYear(a) ?? Number.POSITIVE_INFINITY) - (rowYear(b) ?? Number.POSITIVE_INFINITY) ||
  byTitle(a, b);

const numberIn = (row: LibraryRow, series: string): number =>
  row.kind === 'owned'
    ? seriesNumberValue(seriesNumberIn(row.book, series))
    : seriesNumberValue(rowSeries(row, series)?.number);

/** Reading order within one series; unnumbered books last, by title. */
export const sortRowsInSeries = (rows: LibraryRow[], series: string): LibraryRow[] =>
  rows.toSorted((a, b) => numberIn(a, series) - numberIn(b, series) || byTitle(a, b));

/** Oldest first, as a bibliography reads; undated books after, by title. */
export const sortRowsByYear = (rows: LibraryRow[]): LibraryRow[] => rows.toSorted(byYear);

export interface LibraryRowSection {
  series: string | null; // null: books outside any series
  rows: LibraryRow[];
}

/** Series › book: each series (A–Z) in reading order, then the books outside any series. */
export const rowSeriesSections = (rows: LibraryRow[]): LibraryRowSection[] => {
  const sections = new Map<string, LibraryRowSection>();
  const standalone: LibraryRow[] = [];
  for (const row of rows) {
    const series = rowSeries(row);
    if (!series) {
      standalone.push(row);
      continue;
    }
    const key = fold(series.name);
    const section = sections.get(key) ?? { series: series.name, rows: [] };
    section.rows.push(row);
    sections.set(key, section);
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
