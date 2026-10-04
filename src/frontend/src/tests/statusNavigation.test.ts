import { describe, expect, it } from 'vitest';

import { newDownloadPage } from '../hooks/app/useStatusChangeNotifications';
import type { Book, StatusData } from '../types';

const book = (id: string): Book => ({ id, title: id, author: '' });
const bucket = (...ids: string[]): Record<string, Book> =>
  Object.fromEntries(ids.map((id) => [id, book(id)]));

describe('newDownloadPage', () => {
  it('points a new download waiting to start at Queued, one under way at Downloads', () => {
    const prev: StatusData = { downloading: bucket('a') };
    expect(newDownloadPage(prev, { downloading: bucket('a'), queued: bucket('b') })).toBe('queued');
    expect(newDownloadPage(prev, { downloading: bucket('a', 'b') })).toBe('downloads');
  });

  it('ignores a download moving back to the queue to wait for a slot', () => {
    const prev: StatusData = { resolving: bucket('a') };
    expect(newDownloadPage(prev, { queued: bucket('a') })).toBeNull();
  });

  it('ignores downloads finishing or failing', () => {
    const prev: StatusData = { downloading: bucket('a', 'b') };
    expect(newDownloadPage(prev, { complete: bucket('a'), error: bucket('b') })).toBeNull();
  });
});
