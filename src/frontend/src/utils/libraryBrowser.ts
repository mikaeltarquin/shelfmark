import type { LibraryBook, LibraryFormat } from '../types';

export type LibrarySort = 'title' | 'author' | 'added';
export type LibraryFormatFilter = 'any' | LibraryFormat | 'both';

export interface LibraryFilters {
  query: string;
  format: LibraryFormatFilter;
}

const fold = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

// Leading articles are ignored when sorting titles, as libraries do.
const sortableTitle = (title: string): string => fold(title).replace(/^(the|a|an)\s+/, '');

// "Andy Weir" sorts under Weir.
export const authorSortKey = (author: string): string => {
  const parts = fold(author).trim().split(/\s+/);
  return parts.length > 1 ? `${parts[parts.length - 1]} ${parts.slice(0, -1).join(' ')}` : parts[0];
};

export const matchesFormat = (book: LibraryBook, format: LibraryFormatFilter): boolean => {
  if (format === 'any') return true;
  if (format === 'both') {
    return book.formats.includes('ebook') && book.formats.includes('audiobook');
  }
  return book.formats.includes(format);
};

export const matchesQuery = (book: LibraryBook, query: string): boolean => {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = fold(
    [book.title, ...book.authors, ...book.series.map((s) => s.name), ...book.narrators].join(' '),
  );
  return words.every((word) => haystack.includes(word));
};

export const filterLibraryBooks = (books: LibraryBook[], filters: LibraryFilters): LibraryBook[] =>
  books.filter((book) => matchesFormat(book, filters.format) && matchesQuery(book, filters.query));

const compareText = (a: string, b: string): number => a.localeCompare(b);

const byTitle = (a: LibraryBook, b: LibraryBook): number =>
  compareText(sortableTitle(a.title), sortableTitle(b.title));

export const sortLibraryBooks = (books: LibraryBook[], sort: LibrarySort): LibraryBook[] => {
  if (sort === 'author') {
    return books.toSorted(
      (a, b) =>
        compareText(authorSortKey(a.authors[0] ?? ''), authorSortKey(b.authors[0] ?? '')) ||
        byTitle(a, b),
    );
  }
  if (sort === 'added') {
    return books.toSorted((a, b) => (b.added_at ?? 0) - (a.added_at ?? 0) || byTitle(a, b));
  }
  return books.toSorted(byTitle);
};

export const seriesLabel = (book: LibraryBook): string | null => {
  const series = book.series[0];
  if (!series) return null;
  return series.number ? `${series.name} #${series.number}` : series.name;
};
