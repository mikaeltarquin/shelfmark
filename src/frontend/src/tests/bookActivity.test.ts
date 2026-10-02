import { describe, expect, it } from 'vitest';

import type { StatusData } from '../types';
import {
  downloadLabel,
  downloadSummary,
  indexDownloads,
  isSameBook,
  mergeDownloads,
  parseBookKey,
  savedItemFor,
  titleKey,
  type BookDownloadEntry,
} from '../utils/bookActivity';
import type { SavedItem } from '../utils/savedItems';

const entry = (overrides: Partial<BookDownloadEntry>): BookDownloadEntry => ({
  id: 'task',
  book_key: null,
  title: 'Example Book',
  author: 'Jane Author',
  content_type: 'ebook',
  status: 'complete',
  ...overrides,
});

const book = { key: 'hardcover:1', title: 'Example Book', authors: ['Jane Author'] };

describe('titleKey', () => {
  it('ignores subtitles, case, accents, punctuation and a leading article', () => {
    expect(titleKey('The Éxample Book: A Novel')).toBe('example book');
    expect(titleKey('Example Book (Unabridged)')).toBe('example book');
  });
});

describe('downloadSummary', () => {
  it('matches by book key, whatever the title', () => {
    const index = indexDownloads([entry({ book_key: 'hardcover:1', title: 'Renamed' })]);
    expect(downloadSummary(index, book)).toEqual({ state: 'complete', formats: ['ebook'] });
  });

  it('falls back to title and author for downloads with no key', () => {
    const index = indexDownloads([entry({ content_type: 'audiobook' })]);
    expect(downloadSummary(index, book)).toEqual({ state: 'complete', formats: ['audiobook'] });
    expect(downloadSummary(index, { ...book, authors: ['Someone Else'] })).toBeNull();
    // A library book has no key: title and author alone.
    expect(
      downloadSummary(index, { key: null, title: 'Example Book', authors: [] }),
    ).not.toBeNull();
  });

  it('does not match another book from the same provider by title', () => {
    const index = indexDownloads([entry({ book_key: 'hardcover:2' })]);
    expect(downloadSummary(index, book)).toBeNull();
    expect(
      downloadSummary(indexDownloads([entry({ book_key: 'openlibrary:9' })]), book),
    ).not.toBeNull();
  });

  it('reports the most advanced state and ignores cancelled downloads', () => {
    const index = indexDownloads([
      entry({ id: 'a', status: 'error' }),
      entry({ id: 'b', status: 'downloading', content_type: 'audiobook' }),
      entry({ id: 'c', status: 'cancelled' }),
    ]);
    const summary = downloadSummary(index, book);
    expect(summary).toEqual({ state: 'active', formats: ['audiobook'] });
    expect(summary && downloadLabel(summary)).toBe('Downloading audiobook');
    expect(downloadSummary(indexDownloads([entry({ status: 'cancelled' })]), book)).toBeNull();
  });
});

describe('mergeDownloads', () => {
  it('overlays live status on the history, adding new downloads', () => {
    const status: StatusData = {
      downloading: { a: { id: 'a', title: 'Example Book', author: 'Jane Author' } },
      queued: { n: { id: 'n', title: 'New', author: '', book_key: 'hardcover:5' } },
    };
    const merged = mergeDownloads([entry({ id: 'a', book_key: 'hardcover:1' })], status);
    expect(merged.map((e) => [e.id, e.status, e.book_key])).toEqual([
      ['a', 'downloading', 'hardcover:1'],
      ['n', 'queued', 'hardcover:5'],
    ]);
  });
});

const saved = (book_key: string, title = 'Example Book'): SavedItem => ({
  id: 1,
  book_key,
  kind: 'book',
  content_type: 'ebook',
  title,
  author: 'Jane Author',
  book: { id: book_key, title, author: 'Jane Author' },
  releases: [],
  has_payloads: false,
  auto_get: false,
  conditions: { freeleech_only: false, min_ratio_enabled: false, min_ratio: 2 },
  last_error: null,
  auto_status: null,
  auto_checked_at: null,
  created_at: '',
  updated_at: '',
});

describe('savedItemFor', () => {
  it('matches by key, or by title for library books', () => {
    expect(savedItemFor([saved('hardcover:1', 'Other')], book)).toBeDefined();
    expect(savedItemFor([saved('hardcover:2')], book)).toBeUndefined();
    expect(
      savedItemFor([saved('hardcover:2')], {
        key: null,
        title: 'Example Book',
        authors: ['Jane Author'],
      }),
    ).toBeDefined();
  });
});

describe('parseBookKey', () => {
  it('splits a metadata book key, and rejects ones that are not', () => {
    expect(parseBookKey('hardcover:42')).toEqual({ provider: 'hardcover', providerId: '42' });
    expect(parseBookKey('openlibrary:OL1:W')).toEqual({
      provider: 'openlibrary',
      providerId: 'OL1:W',
    });
    expect(parseBookKey('id:abc')).toBeNull();
    expect(parseBookKey('manual:1')).toBeNull();
    expect(parseBookKey(':1')).toBeNull();
    expect(parseBookKey(undefined)).toBeNull();
  });
});

describe('isSameBook', () => {
  it('matches title and author loosely', () => {
    expect(
      isSameBook(
        { title: 'The Example Book', authors: ['Jane Author'] },
        'Example Book: A Novel',
        'Author, Jane',
      ),
    ).toBe(true);
    expect(
      isSameBook({ title: 'Example Book', authors: ['Jane Author'] }, 'Example Book', 'Sam Writer'),
    ).toBe(false);
  });
});
