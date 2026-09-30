import { describe, expect, it } from 'vitest';

import type { Book, Release } from '../types';
import {
  isPartRelease,
  isReleaseSelected,
  releaseNarrators,
  toggleReleaseSelection,
} from '../utils/combinedSelection';
import { buildReleaseDownloadPayload } from '../utils/releasePayload';

const release = (sourceId: string, extra: Record<string, unknown> = {}): Release => ({
  source: 'prowlarr',
  source_id: sourceId,
  title: `Release ${sourceId}`,
  extra,
});

const pike = release('1', { narrators: ['Rosamund Pike'], narrator: 'Rosamund Pike' });
const kramer = release('2', { narrator: 'Kate Reading, Michael Kramer' });
const unnamed = release('3');

describe('toggleReleaseSelection', () => {
  it('adds and removes releases when several can be picked', () => {
    const both = toggleReleaseSelection(toggleReleaseSelection([], pike, true), kramer, true);
    expect(both).toEqual([pike, kramer]);
    expect(toggleReleaseSelection(both, pike, true)).toEqual([kramer]);
  });

  it('replaces the pick, and keeps it when clicked again, for a single choice', () => {
    expect(toggleReleaseSelection([pike], kramer, false)).toEqual([kramer]);
    expect(toggleReleaseSelection([pike], pike, false)).toEqual([pike]);
  });

  it('matches releases by source and id', () => {
    const sameIdOtherSource = { ...pike, source: 'audiobookbay' };
    expect(isReleaseSelected([pike], { ...pike })).toBe(true);
    expect(isReleaseSelected([pike], sameIdOtherSource)).toBe(false);
  });
});

describe('releaseNarrators', () => {
  it('prefers the narrator list, then the joined string', () => {
    expect(releaseNarrators(pike)).toEqual(['Rosamund Pike']);
    expect(releaseNarrators(kramer)).toBe('Kate Reading, Michael Kramer');
    expect(releaseNarrators(unnamed)).toBeNull();
  });
});

describe('companion audiobook narrators in the ebook payload', () => {
  const book: Book = { id: 'b', title: 'The Eye of the World', author: 'Robert Jordan' };

  it('is sent when audiobooks are downloaded with the ebook', () => {
    const payload = buildReleaseDownloadPayload(book, release('e'), 'ebook', {
      companionAudiobookNarrators: [pike, kramer, unnamed].map(releaseNarrators),
    });
    expect(payload.companion_audiobook_narrators).toEqual([
      ['Rosamund Pike'],
      'Kate Reading, Michael Kramer',
      null,
    ]);
  });

  it('is left out otherwise', () => {
    const payload = buildReleaseDownloadPayload(book, release('e'), 'ebook', {
      companionAudiobookNarrators: [],
    });
    expect(payload).not.toHaveProperty('companion_audiobook_narrators');
  });
});

const part = (title: string, series = 'Stormlight Archive #2'): Release => ({
  source: 'prowlarr',
  source_id: title,
  title,
  extra: { series, narrators: ['GraphicAudio'] },
});

describe('books published in parts', () => {
  it('recognizes parts by title or MyAnonamouse series', () => {
    expect(isPartRelease(part('Words of Radiance (Part 1 of 5)'))).toBe(true);
    expect(isPartRelease(part('Elantris', 'Elantris #1p2'))).toBe(true);
    expect(isPartRelease(part('Elantris [2/3]', ''))).toBe(true);
    expect(isPartRelease(part('Words of Radiance'))).toBe(false);
    expect(isPartRelease(part('Part-Time Indian', ''))).toBe(false);
  });

  it('sends the release title, which names the part', () => {
    const book: Book = { id: 'b', title: 'Words of Radiance', author: 'Brandon Sanderson' };
    const payload = buildReleaseDownloadPayload(
      book,
      part('Words of Radiance (Part 1 of 5)'),
      'audiobook',
    );
    expect(payload.title).toBe('Words of Radiance');
    expect(payload.release_title).toBe('Words of Radiance (Part 1 of 5)');
  });
});
