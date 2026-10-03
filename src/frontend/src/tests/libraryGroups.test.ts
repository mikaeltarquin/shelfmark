import { describe, expect, it } from 'vitest';

import type { LibraryBook } from '../types';
import {
  authorSeriesSections,
  sortAuthorGroups,
  sortSeriesGroups,
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

  it('bare /library opens on the chosen tab; /library/all is always All', () => {
    expect(parseLibraryRoute('/library', 'authors')).toEqual({ tab: 'authors', name: null });
    expect(parseLibraryRoute('/library/all', 'authors')).toEqual({ tab: 'all', name: null });
    expect(libraryPath('all')).toBe('/library/all');
  });
});

describe('author sorting', () => {
  const weir = book('Project Hail Mary', { authors: ['Weir, Andy'], added_at: 300 });
  const groups = groupByAuthor([...all, weir]);

  it('merges "Last, First" with "First Last"', () => {
    const andy = groups.find((g) => g.name === 'Andy Weir');
    expect(andy?.books.map((b) => b.title).toSorted()).toEqual([
      'Project Hail Mary',
      'The Martian',
    ]);
    expect(andy?.latestAdded).toBe(300);
    expect(groups.filter((g) => g.name.includes('Weir'))).toHaveLength(1);
  });

  const names = (field: Parameters<typeof sortAuthorGroups>[1], dir: 'asc' | 'desc') =>
    sortAuthorGroups(groups, field, dir).map((g) => g.name);

  it('sorts by first name, last name, counts and direction', () => {
    expect(names('first', 'asc')).toEqual([
      'Andy Weir',
      'Brandon Sanderson',
      'Neil Gaiman',
      'Terry Pratchett',
    ]);
    expect(names('last', 'asc')).toEqual([
      'Neil Gaiman',
      'Terry Pratchett',
      'Brandon Sanderson',
      'Andy Weir',
    ]);
    expect(names('last', 'desc')[0]).toBe('Andy Weir');
    expect(names('books', 'desc')[0]).toBe('Brandon Sanderson');
    expect(names('books', 'asc')[0]).toBe('Neil Gaiman');
    expect(names('added', 'desc')[0]).toBe('Andy Weir');
  });

  it('orders Author › Series › Book by first name, or by last name', () => {
    expect(names('series_order', 'asc')).toEqual(names('first', 'asc'));
    expect(names('series_order_last', 'asc')).toEqual(names('last', 'asc'));
    expect(names('series', 'desc')[0]).toBe('Brandon Sanderson');
  });
});

describe('series sorting', () => {
  const discworld = book('Guards! Guards!', {
    authors: ['Pratchett, Terry'],
    series: [{ name: 'Discworld', number: '8' }],
    added_at: 500,
  });
  const alex = book('Along Came a Spider', {
    authors: ['James Patterson'],
    series: [{ name: 'Alex Cross', number: '1' }],
  });
  const groups = groupBySeries([...all, discworld, alex]);
  const names = (field: Parameters<typeof sortSeriesGroups>[1], dir: 'asc' | 'desc') =>
    sortSeriesGroups(groups, field, dir).map((g) => g.name);

  it('lists series authors as "First Last"', () => {
    expect(groups.find((g) => g.name === 'Discworld')?.authors).toEqual(['Terry Pratchett']);
  });

  it('sorts by series name, author and recency', () => {
    expect(names('name', 'asc')).toEqual(['Alex Cross', 'Discworld', 'Mistborn', 'Stormlight']);
    expect(names('author_first', 'asc')).toEqual([
      'Mistborn',
      'Stormlight',
      'Alex Cross',
      'Discworld',
    ]);
    expect(names('author_last', 'asc')).toEqual([
      'Alex Cross',
      'Discworld',
      'Mistborn',
      'Stormlight',
    ]);
    // An author's several series stay A-Z whichever way the authors go.
    expect(names('author_last', 'desc')).toEqual([
      'Mistborn',
      'Stormlight',
      'Discworld',
      'Alex Cross',
    ]);
    expect(names('books', 'desc')[0]).toBe('Mistborn');
    expect(names('added', 'desc')[0]).toBe('Discworld');
  });
});
