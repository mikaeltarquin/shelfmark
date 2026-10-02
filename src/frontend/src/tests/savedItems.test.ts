import { describe, expect, it } from 'vitest';

import type { Release } from '../types';
import { combinedPicks, describeSavedPick, savedBookKey } from '../utils/savedItems';

const release = (extra: Partial<Release>): Release => ({
  source: 'prowlarr',
  source_id: 'r',
  title: 'Book Title',
  ...extra,
});

describe('savedBookKey', () => {
  it('keys a book by its provider record, as the server does', () => {
    expect(savedBookKey({ id: 'x', provider: 'hardcover', provider_id: '42' })).toBe(
      'hardcover:42',
    );
    expect(savedBookKey({ id: 'md5abc' })).toBe('id:md5abc');
  });
});

describe('describeSavedPick', () => {
  it('says a book saved on its own has no release yet', () => {
    expect(describeSavedPick({ kind: 'book', releases: [] })).toBe(
      'Book only, pick a release later',
    );
  });

  it('names the picked ebook format and audiobook narrators', () => {
    expect(
      describeSavedPick({
        kind: 'combined',
        releases: [
          { content_type: 'ebook', release: release({ format: 'epub' }) },
          {
            content_type: 'audiobook',
            release: release({ extra: { narrators: ['Narrator One', 'Narrator Two'] } }),
          },
        ],
      }),
    ).toBe('Ebook EPUB + audiobook, Narrator One, Narrator Two');
    expect(
      describeSavedPick({
        kind: 'release',
        releases: [{ content_type: 'audiobook', release: release({}) }],
      }),
    ).toBe('Audiobook');
  });
});

describe('combinedPicks', () => {
  it('keeps the ebook first, then every audiobook, as the hold-back prompt saves them', () => {
    const ebook = release({ source_id: 'e' });
    const first = release({ source_id: 'a1' });
    const second = release({ source_id: 'a2' });
    expect(combinedPicks(ebook, [first, second])).toEqual([
      { content_type: 'ebook', release: ebook },
      { content_type: 'audiobook', release: first },
      { content_type: 'audiobook', release: second },
    ]);
  });

  it('leaves out a missing ebook', () => {
    const audiobook = release({ source_id: 'a' });
    expect(combinedPicks(undefined, [audiobook])).toEqual([
      { content_type: 'audiobook', release: audiobook },
    ]);
    expect(combinedPicks(null, [])).toEqual([]);
  });
});
