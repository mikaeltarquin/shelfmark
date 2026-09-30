import type { Book } from '../types';

export type MissingFormat = 'any' | 'ebook' | 'audiobook';

/**
 * Whether a provider book counts as missing for the chosen format. "any" means the
 * library holds it in no format; a collection that contains it counts as holding it.
 */
export const isMissing = (book: Book, format: MissingFormat): boolean => {
  const library = book.library;
  if (!library) return true;
  if (format === 'any') return !library.ebook && !library.audiobook;
  return !library[format];
};
