import { describe, expect, it } from 'vitest';

import { parseSuggestionOptions } from '../services/api';

describe('parseSuggestionOptions', () => {
  it('keeps what each suggestion is, and ignores unknown kinds', () => {
    expect(
      parseSuggestionOptions([
        {
          value: 'id:997',
          label: 'The Stormlight Archive',
          description: '10 books',
          kind: 'series',
        },
        { value: 'Elantris', label: 'Elantris', kind: 'book' },
        { value: 'id:1', label: 'Brandon Sanderson', kind: 'author' },
        { value: 'x', label: 'X', kind: 'narrator' },
        { value: '', label: 'empty' },
      ]),
    ).toEqual([
      { value: 'id:997', label: 'The Stormlight Archive', description: '10 books', kind: 'series' },
      { value: 'Elantris', label: 'Elantris', kind: 'book' },
      { value: 'id:1', label: 'Brandon Sanderson', kind: 'author' },
      { value: 'x', label: 'X' },
    ]);
  });
});
