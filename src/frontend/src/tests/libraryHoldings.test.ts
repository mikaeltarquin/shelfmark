import { describe, expect, it } from 'vitest';

import {
  formatBytes,
  formatDuration,
  holdingFormatText,
  openLinkText,
} from '../components/shared/LibraryHoldings';
import type { LibraryHoldingItem } from '../types';

const holding = (overrides: Partial<LibraryHoldingItem> = {}): LibraryHoldingItem => ({
  source: 'audiobookshelf',
  library: 'Audiobookshelf',
  item_id: 'li_1',
  title: 'Example Book',
  authors: ['Jane Author'],
  narrators: [],
  year: null,
  formats: ['audiobook'],
  holding: 'owned',
  path: null,
  size: null,
  duration: null,
  file_formats: [],
  audio_files: 1,
  url: null,
  ...overrides,
});

describe('formatBytes', () => {
  it('scales to the largest whole unit', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(812_000_000)).toBe('774 MB');
    expect(formatBytes(2 * 1024 ** 3)).toBe('2.0 GB');
  });

  it('is empty for no size', () => {
    expect(formatBytes(null)).toBeNull();
    expect(formatBytes(0)).toBeNull();
  });
});

describe('formatDuration', () => {
  it('gives hours and minutes', () => {
    expect(formatDuration(42_120)).toBe('11h 42m');
    expect(formatDuration(7200)).toBe('2h');
    expect(formatDuration(2280)).toBe('38m');
    expect(formatDuration(null)).toBeNull();
  });
});

describe('holdingFormatText', () => {
  it('names the format, file types and audio file count', () => {
    expect(holdingFormatText(holding({ audio_files: 24 }))).toBe('Audiobook · 24 audio files');
    expect(holdingFormatText(holding({ audio_files: 1 }))).toBe('Audiobook');
    expect(holdingFormatText(holding({ formats: ['ebook'], file_formats: ['azw3', 'epub'] }))).toBe(
      'Ebook · AZW3, EPUB',
    );
    expect(
      holdingFormatText(holding({ formats: ['audiobook', 'ebook'], file_formats: ['epub'] })),
    ).toBe('Audiobook + ebook · EPUB');
  });
});

describe('openLinkText', () => {
  it('names the app the link opens', () => {
    expect(openLinkText(holding())).toBe('Open in Audiobookshelf');
    expect(openLinkText(holding({ source: 'calibre', library: 'Calibre' }))).toBe(
      'Open in Calibre-Web',
    );
  });
});
