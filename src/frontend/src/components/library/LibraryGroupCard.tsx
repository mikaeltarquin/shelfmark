import type { LibraryBook, LibraryFormat } from '../../types';
import { LibraryFormatBadges } from './LibraryBookCard';
import { LibraryCoverThumb } from './LibraryCoverThumb';

interface LibraryGroupCardProps {
  title: string;
  subtitle?: string;
  detail: string;
  books: LibraryBook[]; // The first few give the cover strip
  formats: LibraryFormat[];
  onOpen: () => void;
}

/** An author or a series in the list views: a strip of covers and a count. */
export const LibraryGroupCard = ({
  title,
  subtitle,
  detail,
  books,
  formats,
  onOpen,
}: LibraryGroupCardProps) => (
  <button
    type="button"
    onClick={onOpen}
    className="flex flex-col gap-3 rounded-xl p-3 text-left transition-shadow hover:shadow-lg focus-visible:shadow-lg"
    style={{ background: 'var(--bg-soft)' }}
  >
    <div className="flex gap-2">
      {books.slice(0, 3).map((book) => (
        <LibraryCoverThumb key={book.id} book={book} className="w-1/3" />
      ))}
      {books.length < 3 &&
        Array.from({ length: 3 - books.length }, (_, index) => (
          <div key={index} className="w-1/3" aria-hidden="true" />
        ))}
    </div>
    <div className="min-w-0 space-y-0.5">
      <h3 className="truncate text-sm font-semibold" title={title}>
        {title}
      </h3>
      {subtitle && (
        <p className="truncate text-xs opacity-70" title={subtitle}>
          {subtitle}
        </p>
      )}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs opacity-60">{detail}</span>
        <LibraryFormatBadges formats={formats} />
      </div>
    </div>
  </button>
);
