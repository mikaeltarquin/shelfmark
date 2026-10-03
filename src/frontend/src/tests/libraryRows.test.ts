import { describe, expect, it } from 'vitest';

import type { Book, LibraryBook } from '../types';
import {
  combineRows,
  missingRow,
  ownedRow,
  rowMatches,
  rowSeries,
  rowSeriesSections,
  rowTitle,
  sortRowsInSeries,
} from '../utils/libraryRows';

const owned = (title: string, overrides: Partial<LibraryBook> = {}): LibraryBook => ({
  id: title,
  title,
  authors: ['Jane Author'],
  series: [],
  formats: ['ebook'],
  narrators: [],
  added_at: null,
  year: null,
  cover: '/api/library/cover/calibre/1',
  sources: ['calibre'],
  ...overrides,
});

const provider = (title: string, overrides: Partial<Book> = {}): Book => ({
  id: `hardcover:${title}`,
  title,
  author: 'Jane Author',
  library: { ebook: null, audiobook: null },
  ...overrides,
});

const one = owned('Book One', { series: [{ name: 'The Saga', number: '1' }], year: 2001 });
const three = owned('Book Three', {
  series: [{ name: 'The Saga', number: '3' }],
  formats: ['audiobook'],
});
const standalone = owned('Standalone', { year: 1999, formats: ['ebook', 'audiobook'] });
const two = provider('Book Two', { series_name: 'The Saga', series_position: 2, year: '2002' });
// Owned as the audiobook only, so missing as an ebook.
const threeEbook = provider('Book Three', {
  series_name: 'The Saga',
  series_position: 3,
  library: { ebook: null, audiobook: 'owned' },
});
const other = provider('Other Series Book', { series_name: 'Another', series_position: 1 });

const rows = [one, three, standalone].map(ownedRow);
const missing = [two, threeEbook, other].map(missingRow);

const titles = (
  ownership: 'owned' | 'missing' | 'all',
  format: 'any' | 'ebook' | 'audiobook' | 'both',
) =>
  [...rows, ...missing]
    .filter((row) => rowMatches(row, ownership, format))
    .map((row) => `${row.kind}:${rowTitle(row)}`);

describe('rowMatches', () => {
  it('shows owned books in the format, missing ones lacking it', () => {
    expect(titles('owned', 'any')).toEqual([
      'owned:Book One',
      'owned:Book Three',
      'owned:Standalone',
    ]);
    expect(titles('missing', 'any')).toEqual(['missing:Book Two', 'missing:Other Series Book']);
    expect(titles('missing', 'ebook')).toEqual([
      'missing:Book Two',
      'missing:Book Three',
      'missing:Other Series Book',
    ]);
    expect(titles('all', 'audiobook')).toEqual([
      'owned:Book Three',
      'owned:Standalone',
      'missing:Book Two',
      'missing:Other Series Book',
    ]);
    expect(titles('all', 'both')).toContain('missing:Book Three');
    expect(titles('all', 'both')).not.toContain('owned:Book Three');
  });

  it('says which format a missing book lacks', () => {
    const row = missingRow(threeEbook);
    expect(row.kind === 'missing' ? row.missingFormats : null).toEqual(['ebook']);
  });
});

describe('series order', () => {
  it('puts owned and missing books in reading order', () => {
    const sorted = sortRowsInSeries([...rows, missing[0]], 'The Saga').map(rowTitle);
    expect(sorted.slice(0, 3)).toEqual(['Book One', 'Book Two', 'Book Three']);
    expect(rowSeries(missing[0], 'The Saga')).toEqual({ name: 'The Saga', number: '2' });
  });

  it('groups by series A–Z (ignoring "The"), books outside any series last', () => {
    const sections = rowSeriesSections([...rows, ...missing]);
    expect(sections.map((section) => section.series)).toEqual(['Another', 'The Saga', null]);
    expect(sections[1].rows.map(rowTitle)).toEqual([
      'Book One',
      'Book Two',
      'Book Three',
      'Book Three',
    ]);
    expect(sections[2].rows.map(rowTitle)).toEqual(['Standalone']);
  });
});

describe('combineRows', () => {
  it('joins a book held in one format to its library row', () => {
    const combined = combineRows([one, three], [two, threeEbook]);
    expect(combined.map((row) => `${row.kind}:${rowTitle(row)}`)).toEqual([
      'owned:Book One',
      'owned:Book Three',
      'missing:Book Two',
    ]);
    const joined = combined[1];
    expect(joined.kind === 'owned' && joined.match?.id).toBe('hardcover:Book Three');
    expect(joined.missingFormats).toEqual(['ebook']);
    // Held as the audiobook and lacking the ebook: owned and missing alike.
    expect(rowMatches(joined, 'owned', 'audiobook')).toBe(true);
    expect(rowMatches(joined, 'missing', 'ebook')).toBe(true);
    expect(rowMatches(joined, 'missing', 'audiobook')).toBe(false);
  });

  it('numbers books whose records name the series with or without "The"', () => {
    const first = owned('First', { series: [{ name: 'The Expanse', number: '1' }] });
    const second = owned('Second', { series: [{ name: 'Expanse', number: '2' }] });
    const third = owned('A Third', { series: [{ name: 'Expanse', number: '3' }] });
    const [section] = rowSeriesSections([third, second, first].map(ownedRow));
    expect(section.rows.map(rowTitle)).toEqual(['First', 'Second', 'A Third']);
  });
});
