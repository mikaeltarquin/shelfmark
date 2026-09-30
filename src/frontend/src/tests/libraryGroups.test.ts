import { describe, expect, it } from 'vitest';

import type { LibraryBook } from '../types';
import {
  authorSeriesSections,
  booksByAuthor,
  groupByAuthor,
  groupBySeries,
  seriesNumberValue,
  seriesRangeLabel,
} from '../utils/libraryGroups';
import { libraryPath, parseLibraryRoute } from '../utils/libraryRoute';

const book = (title: string, overrides: Partial<LibraryBook> = {}): LibraryBook => ({
  id: title,
  title,
  authors: ['Brandon Sanderson'],
  series: [],
  formats: ['ebook'],
  narrators: [],
  added_at: null,
  year: null,
  cover: '/api/library/cover/calibre/1',
  sources: ['calibre'],
  ...overrides,
});

const well = book('The Well of Ascension', {
  series: [{ name: 'Mistborn', number: '2' }],
  year: 2007,
  formats: ['audiobook'],
});
const empire = book('The Final Empire', {
  series: [{ name: 'Mistborn', number: '1' }],
  year: 2006,
});
const secret = book('Secret History', {
  series: [{ name: 'mistborn', number: '3.5' }],
  year: 2016,
});
const elantris = book('Elantris', { year: 2005 });
const way = book('The Way of Kings', {
  series: [{ name: 'Stormlight', number: null }],
  year: 2010,
});
const martian = book('The Martian', { authors: ['Andy Weir'], year: 2011 });
const goodOmens = book('Good Omens', { authors: ['Terry Pratchett', 'Neil Gaiman'] });
const all = [well, empire, secret, elantris, way, martian, goodOmens];

describe('groupByAuthor', () => {
  it('groups by author, sorted by surname, books oldest first', () => {
    const groups = groupByAuthor(all);
    expect(groups.map((g) => g.name)).toEqual([
      'Neil Gaiman',
      'Terry Pratchett',
      'Brandon Sanderson',
      'Andy Weir',
    ]);
    const sanderson = groups[2];
    expect(sanderson.books.map((b) => b.title)).toEqual([
      'Elantris',
      'The Final Empire',
      'The Well of Ascension',
      'The Way of Kings',
      'Secret History',
    ]);
    expect(sanderson.formats).toEqual(['ebook', 'audiobook']);
    expect(sanderson.seriesCount).toBe(2);
  });
});

describe('groupBySeries', () => {
  it('orders a series by number, matching names case-insensitively', () => {
    const [mistborn, stormlight] = groupBySeries(all);
    expect(mistborn.name).toBe('Mistborn');
    expect(mistborn.books.map((b) => b.title)).toEqual([
      'The Final Empire',
      'The Well of Ascension',
      'Secret History',
    ]);
    expect(mistborn.authors).toEqual(['Brandon Sanderson']);
    expect(seriesRangeLabel(mistborn)).toBe('#1–3.5');
    expect(seriesRangeLabel(stormlight)).toBeNull();
  });
});

describe('author pages', () => {
  it('finds an author by name regardless of case', () => {
    expect(booksByAuthor(all, 'neil gaiman')).toEqual([goodOmens]);
  });

  it('splits an author into series sections, other books last', () => {
    const sections = authorSeriesSections(booksByAuthor(all, 'Brandon Sanderson'));
    expect(sections.map((s) => s.series)).toEqual(['Mistborn', 'Stormlight', null]);
    expect(sections[2].books).toEqual([elantris]);
  });
});

describe('helpers', () => {
  it('series numbers', () => {
    expect(seriesNumberValue('2.5')).toBe(2.5);
    expect(seriesNumberValue(null)).toBe(Number.POSITIVE_INFINITY);
  });

  it('library routes round-trip names', () => {
    expect(parseLibraryRoute('/library')).toEqual({ tab: 'all', name: null });
    expect(parseLibraryRoute('/library/series')).toEqual({ tab: 'series', name: null });
    const path = libraryPath('authors', 'Ursula K. Le Guin / AC/DC');
    expect(parseLibraryRoute(path)).toEqual({ tab: 'authors', name: 'Ursula K. Le Guin / AC/DC' });
    expect(parseLibraryRoute('/library/nonsense')).toEqual({ tab: 'all', name: null });
  });
});
