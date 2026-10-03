import { describe, expect, it } from 'vitest';

import type { LibraryBook } from '../types';
import { copyBadges } from '../utils/libraryCopies';

const book = (overrides: Partial<LibraryBook> = {}): LibraryBook => ({
  id: 'calibre:1',
  title: 'Project Hail Mary',
  authors: ['Andy Weir'],
  series: [],
  formats: ['ebook', 'audiobook'],
  narrators: ['Ray Porter'],
  added_at: null,
  year: null,
  cover: '/api/library/cover/calibre/1',
  sources: ['audiobookshelf', 'calibre'],
  ...overrides,
});

describe('copyBadges', () => {
  it('names each audiobook by its narrators and each ebook by its files', () => {
    const held = book({
      copies: [
        {
          source: 'calibre',
          item_id: '1',
          formats: ['ebook'],
          narrators: [],
          file_formats: ['epub', 'azw3'],
        },
        {
          source: 'audiobookshelf',
          item_id: 'a',
          formats: ['audiobook', 'ebook'],
          narrators: ['Ray Porter'],
          file_formats: ['epub', 'm4b'],
        },
        {
          source: 'audiobookshelf',
          item_id: 'b',
          formats: ['audiobook'],
          narrators: [],
          file_formats: [],
        },
      ],
    });
    expect(copyBadges(held, 'audiobook').map((badge) => badge.text)).toEqual([
      'Ray Porter',
      'Audiobook',
    ]);
    expect(copyBadges(held, 'ebook').map((badge) => badge.text)).toEqual(['EPUB, AZW3', 'EPUB']);
    expect(copyBadges(held, 'audiobook')[0].title).toBe(
      'Audiobook read by Ray Porter in Audiobookshelf',
    );
  });

  it('treats a book from an older server as one copy', () => {
    expect(copyBadges(book(), 'audiobook').map((badge) => badge.text)).toEqual(['Ray Porter']);
    expect(copyBadges(book({ formats: ['ebook'] }), 'audiobook')).toEqual([]);
  });
});
