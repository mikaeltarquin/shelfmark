import { beforeEach, describe, expect, it, vi } from 'vitest';

import { downloadToActivityItem } from '../components/activity/activityMappers';
import type { LibraryHoldingItem } from '../types';

const holdings = vi.hoisted(() => ({
  rows: [] as Partial<LibraryHoldingItem>[],
  asked: [] as unknown[],
}));

vi.mock('../services/api', () => ({
  getLibraryHoldings: (book: unknown) => {
    holdings.asked.push(book);
    return Promise.resolve(holdings.rows);
  },
  getMetadataBookInfo: vi.fn(),
  searchMetadata: vi.fn(),
}));

const { findLibraryLink } = await import('../utils/activityBook');

const item = (contentType: string) =>
  downloadToActivityItem(
    {
      id: 't1',
      title: 'Example Book',
      author: 'Jane Author',
      book_key: 'hardcover:42',
      content_type: contentType,
    },
    'complete',
  );

describe('findLibraryLink', () => {
  beforeEach(() => {
    holdings.asked = [];
    holdings.rows = [
      { source: 'calibre', formats: ['ebook'], url: 'http://cwa/book/1' },
      { source: 'audiobookshelf', formats: ['audiobook'], url: 'http://abs/item/li_1' },
    ];
  });

  it('opens the copy in the format downloaded', async () => {
    expect(await findLibraryLink(item('audiobook'))).toBe('http://abs/item/li_1');
    expect(await findLibraryLink(item('ebook'))).toBe('http://cwa/book/1');
    expect(holdings.asked[0]).toMatchObject({
      provider: 'hardcover',
      provider_id: '42',
      title: 'Example Book',
    });
  });

  it('falls back to any linked copy, or none', async () => {
    holdings.rows = [{ source: 'calibre', formats: ['ebook'], url: 'http://cwa/book/1' }];
    expect(await findLibraryLink(item('audiobook'))).toBe('http://cwa/book/1');
    holdings.rows = [{ source: 'calibre', formats: ['ebook'], url: null }];
    expect(await findLibraryLink(item('ebook'))).toBeNull();
  });
});
