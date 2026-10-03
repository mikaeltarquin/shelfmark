import type { LibraryBook, LibraryCopy, LibraryFormat } from '../types';
import { shortNarrators } from './narrators';

/** One version of a book the library holds, as a table badge shows it. */
export interface CopyBadge {
  key: string;
  text: string; // An audiobook's narrators ("Andrew Scott +9"), an ebook's file formats
  title: string; // On hover: every narrator, and where the copy is
}

// Audio files an Audiobookshelf item may list beside its ebook.
const AUDIO_FORMATS = new Set(['m4b', 'm4a', 'mp3', 'aac', 'flac', 'ogg', 'opus', 'wav', 'wma']);

const SOURCE_NAMES: Record<string, string> = {
  audiobookshelf: 'Audiobookshelf',
  calibre: 'Calibre',
};

const sourceName = (source: string): string => SOURCE_NAMES[source] ?? source;

// Servers from before copies were listed: the whole book as one copy.
const copiesOf = (book: LibraryBook): LibraryCopy[] =>
  book.copies ?? [
    {
      source: book.sources[0] ?? '',
      item_id: book.id,
      formats: book.formats,
      narrators: book.narrators,
      file_formats: [],
    },
  ];

const badgeFor = (copy: LibraryCopy, format: LibraryFormat): CopyBadge => {
  const key = `${copy.source}:${copy.item_id}`;
  const where = copy.source ? ` in ${sourceName(copy.source)}` : '';
  if (format === 'audiobook') {
    const narrators = copy.narrators.join(', ');
    return narrators
      ? {
          key,
          text: shortNarrators(copy.narrators),
          title: `Audiobook read by ${narrators}${where}`,
        }
      : { key, text: 'Audiobook', title: `Audiobook${where}` };
  }
  const files = copy.file_formats
    .filter((file) => !AUDIO_FORMATS.has(file.toLowerCase()))
    .map((file) => file.toUpperCase());
  return files.length > 0
    ? { key, text: files.join(', '), title: `Ebook (${files.join(', ')})${where}` }
    : { key, text: 'Ebook', title: `Ebook${where}` };
};

/**
 * A badge for each copy holding the format: one per audiobook, named by its narrators
 * ("Ray Porter", or "Audiobook" when none is known), one per ebook by its files ("EPUB").
 */
export const copyBadges = (book: LibraryBook, format: LibraryFormat): CopyBadge[] =>
  copiesOf(book)
    .filter((copy) => copy.formats.includes(format))
    .map((copy) => badgeFor(copy, format));
