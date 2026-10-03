import { describe, expect, it } from 'vitest';

import { narratorNames, shortNarrators } from '../utils/narrators';

describe('narratorNames', () => {
  it('reads a list, or a string naming several', () => {
    expect(narratorNames(['Andrew Scott', ' ', 'Kate Reading'])).toEqual([
      'Andrew Scott',
      'Kate Reading',
    ]);
    expect(narratorNames('Kate Reading & Michael Kramer, Ray Porter')).toEqual([
      'Kate Reading',
      'Michael Kramer',
      'Ray Porter',
    ]);
    expect(narratorNames(undefined)).toEqual([]);
  });
});

describe('shortNarrators', () => {
  it('names the first and counts the rest', () => {
    const cast = ['Andrew Scott', ...Array.from({ length: 9 }, (_, i) => `Voice ${i}`)];
    expect(shortNarrators(cast)).toBe('Andrew Scott +9');
    expect(shortNarrators(['Ray Porter'])).toBe('Ray Porter');
    expect(shortNarrators([])).toBe('');
  });
});
