import { describe, expect, it } from 'vitest';

import type { Book } from '../types';
import { isMissing } from '../utils/libraryMissing';

const book = (library?: Book['library']): Book => ({
  id: 'x',
  title: 'X',
  author: 'Y',
  library,
});

describe('isMissing', () => {
  it('counts a book missing in any format only when no format is held', () => {
    expect(isMissing(book(), 'any')).toBe(true);
    expect(isMissing(book({ ebook: null, audiobook: null }), 'any')).toBe(true);
    expect(isMissing(book({ ebook: 'owned', audiobook: null }), 'any')).toBe(false);
    expect(isMissing(book({ ebook: null, audiobook: 'collection' }), 'any')).toBe(false);
  });

  it('checks one format at a time', () => {
    const ebookOnly = book({ ebook: 'owned', audiobook: null });
    expect(isMissing(ebookOnly, 'ebook')).toBe(false);
    expect(isMissing(ebookOnly, 'audiobook')).toBe(true);
    // A library that only checks ebooks says nothing about audiobooks.
    expect(isMissing(book({ ebook: 'owned' }), 'audiobook')).toBe(true);
  });
});
