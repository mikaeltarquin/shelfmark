import { describe, expect, it } from 'vitest';

import type { LibraryBook } from '../types';
import {
  authorSortKey,
  filterLibraryBooks,
  seriesLabel,
  sortLibraryBooks,
} from '../utils/libraryBrowser';

const book = (overrides: Partial<LibraryBook>): LibraryBook => ({
  id: overrides.title ?? 'x',
  title: 'Untitled',
  authors: [],
  series: [],
  formats: ['ebook'],
  narrators: [],
  added_at: null,
  year: null,
  cover: '/api/library/cover/calibre/1',
  sources: ['calibre'],
  ...overrides,
});

const martian = book({
  title: 'The Martian',
  authors: ['Andy Weir'],
  series: [{ name: 'Mars', number: '1' }],
  formats: ['ebook', 'audiobook'],
  narrators: ['R. C. Bray'],
  added_at: 100,
});
const dune = book({ title: 'Dune', authors: ['Frank Herbert'], added_at: 300 });
const carl = book({
  title: 'Dungeon Crawler Carl',
  authors: ['Matt Dinniman'],
  formats: ['audiobook'],
  added_at: 200,
});
const all = [martian, dune, carl];

describe('filterLibraryBooks', () => {
  it('matches every word across title, author, series and narrator', () => {
    expect(filterLibraryBooks(all, { query: 'weir mars', format: 'any' })).toEqual([martian]);
    expect(filterLibraryBooks(all, { query: 'bray', format: 'any' })).toEqual([martian]);
    expect(filterLibraryBooks(all, { query: 'DUN', format: 'any' })).toEqual([dune, carl]);
  });

  it('filters by format', () => {
    expect(filterLibraryBooks(all, { query: '', format: 'audiobook' })).toEqual([martian, carl]);
    expect(filterLibraryBooks(all, { query: '', format: 'ebook' })).toEqual([martian, dune]);
    expect(filterLibraryBooks(all, { query: '', format: 'both' })).toEqual([martian]);
  });
});

describe('sortLibraryBooks', () => {
  it('sorts titles without leading articles', () => {
    expect(sortLibraryBooks(all, 'title').map((b) => b.title)).toEqual([
      'Dune',
      'Dungeon Crawler Carl',
      'The Martian',
    ]);
  });

  it('sorts by author surname', () => {
    expect(sortLibraryBooks(all, 'author').map((b) => b.title)).toEqual([
      'Dungeon Crawler Carl',
      'Dune',
      'The Martian',
    ]);
  });

  it('sorts newest first', () => {
    expect(sortLibraryBooks(all, 'added').map((b) => b.title)).toEqual([
      'Dune',
      'Dungeon Crawler Carl',
      'The Martian',
    ]);
  });
});

describe('helpers', () => {
  it('author sort key puts the surname first', () => {
    expect(authorSortKey('Andy Weir')).toBe('weir andy');
    expect(authorSortKey('Plato')).toBe('plato');
  });

  it('series label', () => {
    expect(seriesLabel(martian)).toBe('Mars #1');
    expect(seriesLabel(dune)).toBeNull();
    expect(seriesLabel(book({ series: [{ name: 'Discworld', number: null }] }))).toBe('Discworld');
  });
});
