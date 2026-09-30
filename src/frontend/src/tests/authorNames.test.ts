import { describe, expect, it } from 'vitest';

import { firstLastName, lastFirstName, splitAuthorName } from '../utils/authorNames';

describe('author names', () => {
  it('flips first and last names', () => {
    expect(lastFirstName('Andy Weir')).toBe('Weir, Andy');
    expect(lastFirstName('Plato')).toBe('Plato');
    expect(lastFirstName('Ursula K. Le Guin')).toBe('Le Guin, Ursula K.');
    expect(lastFirstName('Ludwig van Beethoven')).toBe('van Beethoven, Ludwig');
    expect(lastFirstName('Martin Luther King Jr.')).toBe('King, Martin Luther, Jr.');
  });

  it('reads names already written surname first', () => {
    expect(splitAuthorName('Weir, Andy')).toEqual({ first: 'Andy', last: 'Weir', suffix: '' });
    expect(firstLastName('Weir, Andy')).toBe('Andy Weir');
    expect(lastFirstName('Weir, Andy')).toBe('Weir, Andy');
    // A trailing ", Jr." is a suffix, not a surname-first name.
    expect(lastFirstName('Martin Luther King, Jr.')).toBe('King, Martin Luther, Jr.');
  });
});
