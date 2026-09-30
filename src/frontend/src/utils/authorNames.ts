// Author names as libraries write them: "Ursula K. Le Guin", "Martin Luther King Jr.",
// "Weir, Andy". Sorting and "Last, First" display both need the surname split out.

// Lower-case words that belong to the surname when they come before it.
const SURNAME_PARTICLES = new Set([
  'da',
  'de',
  'del',
  'della',
  'den',
  'der',
  'di',
  'du',
  'la',
  'le',
  'st',
  'st.',
  'ten',
  'ter',
  'van',
  'von',
]);

const SUFFIXES = new Set(['jr', 'jr.', 'sr', 'sr.', 'ii', 'iii', 'iv', 'phd', 'md']);

export interface AuthorNameParts {
  first: string; // Given names ("Ursula K."), empty for a one-word name
  last: string; // Surname with its particles ("Le Guin")
  suffix: string; // "Jr.", "III"...
}

export const splitAuthorName = (name: string): AuthorNameParts => {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  // Already "Last, First" (a trailing ", Jr." is a suffix, not a surname).
  const commaParts = trimmed.split(',').map((part) => part.trim());
  if (commaParts.length >= 2 && !SUFFIXES.has(commaParts[1].toLowerCase())) {
    return { first: commaParts[1], last: commaParts[0], suffix: commaParts.slice(2).join(', ') };
  }
  const words = commaParts.join(' ').split(' ').filter(Boolean);
  const suffixWords: string[] = [];
  while (words.length > 1 && SUFFIXES.has(words[words.length - 1].toLowerCase())) {
    suffixWords.unshift(words.pop() ?? '');
  }
  if (words.length <= 1) {
    return { first: '', last: words[0] ?? '', suffix: suffixWords.join(' ') };
  }
  let lastStart = words.length - 1;
  while (lastStart > 1 && SURNAME_PARTICLES.has(words[lastStart - 1].toLowerCase())) {
    lastStart -= 1;
  }
  return {
    first: words.slice(0, lastStart).join(' '),
    last: words.slice(lastStart).join(' '),
    suffix: suffixWords.join(' '),
  };
};

/** "Andy Weir" -> "Weir, Andy"; "Martin Luther King Jr." -> "King, Martin Luther, Jr." */
export const lastFirstName = (name: string): string => {
  const { first, last, suffix } = splitAuthorName(name);
  return [last, first, suffix].filter(Boolean).join(', ');
};

/** "Weir, Andy" -> "Andy Weir", for names a library stores surname first. */
export const firstLastName = (name: string): string => {
  const { first, last, suffix } = splitAuthorName(name);
  return [first, last, suffix].filter(Boolean).join(' ');
};

const fold = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

export const lastFirstSortKey = (name: string): string => fold(lastFirstName(name));

export const firstLastSortKey = (name: string): string => fold(firstLastName(name));
