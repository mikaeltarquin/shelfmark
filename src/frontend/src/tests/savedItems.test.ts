import { describe, expect, it } from 'vitest';

import type { Release } from '../types';
import {
  combinedPicks,
  describeSavedPick,
  hasMamPick,
  savedBookKey,
  savedPayloads,
} from '../utils/savedItems';

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

describe('savedPayloads', () => {
  const book = { id: 'b', title: 'Book Title', author: 'Firstname Lastname' };

  it('builds one download payload per pick, in order', () => {
    const payloads = savedPayloads(book, [
      { content_type: 'ebook', release: release({ source_id: 'e', format: 'epub' }) },
      {
        content_type: 'audiobook',
        release: release({ source_id: 'a', extra: { narrators: ['Narrator One'] } }),
      },
    ]);
    expect(payloads.map((p) => [p.source_id, p.content_type])).toEqual([
      ['e', 'ebook'],
      ['a', 'audiobook'],
    ]);
    // The ebook goes into its audiobook's narrator folder, as a manual combined Get does.
    expect(payloads[0].companion_audiobook_narrators).toEqual([['Narrator One']]);
    expect(payloads[1].companion_audiobook_narrators).toBeUndefined();
  });

  it('leaves parts of a book published in parts out of the ebook folder', () => {
    const [ebook] = savedPayloads(book, [
      { content_type: 'ebook', release: release({ source_id: 'e' }) },
      { content_type: 'audiobook', release: release({ source_id: 'p', title: 'Book (1 of 5)' }) },
    ]);
    expect(ebook.companion_audiobook_narrators).toBeUndefined();
  });
});

describe('hasMamPick', () => {
  it('is true when a pick is a MyAnonamouse torrent', () => {
    expect(
      hasMamPick({
        releases: [{ content_type: 'ebook', release: release({ extra: { mam_torrent_id: 7 } }) }],
      }),
    ).toBe(true);
    expect(hasMamPick({ releases: [{ content_type: 'ebook', release: release({}) }] })).toBe(false);
  });
});
