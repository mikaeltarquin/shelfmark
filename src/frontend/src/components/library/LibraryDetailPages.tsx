import { useMemo, useState } from 'react';

import type { LibraryBook } from '../../types';
import { firstLastName } from '../../utils/authorNames';
import {
  authorSeriesSections,
  booksByAuthor,
  groupBySeries,
  sameAuthor,
  sameName,
  seriesRangeLabel,
} from '../../utils/libraryGroups';
import type { LibraryCardActions } from './LibraryBookCard';
import { LibraryBookGrid } from './LibraryBookGrid';
import { LibraryMissingSection, type LibraryBookActions } from './LibraryMissingSection';
import { segmentClass } from './libraryStyles';

type AuthorMode = 'all' | 'series';

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

const PageHeading = ({ kind, name, detail }: { kind: string; name: string; detail: string }) => (
  <div>
    <p className="text-xs font-medium tracking-wide uppercase opacity-60">{kind}</p>
    <h2 className="text-xl font-semibold">{name}</h2>
    <p className="text-sm opacity-60">{detail}</p>
  </div>
);

interface DetailProps {
  books: LibraryBook[];
  actions: LibraryBookActions;
  onAuthorClick: (author: string) => void;
  onSeriesClick: (series: string) => void;
  cardActions: LibraryCardActions;
}

/** One author's books, all together or grouped by series. */
export const LibraryAuthorPage = ({
  books,
  actions,
  author,
  onAuthorClick,
  onSeriesClick,
  cardActions,
}: DetailProps & { author: string }) => {
  const own = useMemo(() => booksByAuthor(books, author), [books, author]);
  const sections = useMemo(() => authorSeriesSections(own), [own]);
  const hasSeries = sections.some((section) => section.series !== null);
  const [mode, setMode] = useState<AuthorMode>(hasSeries ? 'series' : 'all');
  const name = firstLastName(own[0]?.authors.find((known) => sameAuthor(known, author)) ?? author);
  const otherAuthor = (clicked: string) => {
    if (!sameAuthor(clicked, author)) onAuthorClick(clicked);
  };

  if (own.length === 0) {
    return (
      <div className="space-y-5">
        <p className="text-sm opacity-60">No books by {author} in your library.</p>
        <LibraryMissingSection kind="author" name={author} actions={actions} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeading
          kind="Author"
          name={name}
          detail={`${plural(own.length, 'book')} in your library`}
        />
        {hasSeries && (
          <div className="flex gap-1" role="group" aria-label="Show">
            <button
              type="button"
              className={segmentClass(mode === 'all')}
              onClick={() => setMode('all')}
            >
              All books
            </button>
            <button
              type="button"
              className={segmentClass(mode === 'series')}
              onClick={() => setMode('series')}
            >
              By series
            </button>
          </div>
        )}
      </div>

      {mode === 'all' || !hasSeries ? (
        <LibraryBookGrid
          books={own}
          onAuthorClick={otherAuthor}
          onSeriesClick={onSeriesClick}
          cardActions={cardActions}
        />
      ) : (
        sections.map((section) => (
          <section key={section.series ?? '(none)'} className="space-y-3">
            <h3 className="text-base font-semibold">
              {section.series ? (
                <button
                  type="button"
                  className="hover:underline"
                  onClick={() => onSeriesClick(section.series ?? '')}
                >
                  {section.series}
                </button>
              ) : (
                'Other books'
              )}
              <span className="ml-2 text-sm font-normal opacity-60">{section.books.length}</span>
            </h3>
            <LibraryBookGrid
              books={section.books}
              series={section.series ?? undefined}
              onAuthorClick={otherAuthor}
              cardActions={cardActions}
            />
          </section>
        ))
      )}

      <LibraryMissingSection kind="author" name={name} actions={actions} />
    </div>
  );
};

/** One series in reading order. */
export const LibrarySeriesPage = ({
  books,
  actions,
  series,
  onAuthorClick,
  cardActions,
}: Omit<DetailProps, 'onSeriesClick'> & { series: string }) => {
  const group = useMemo(
    () => groupBySeries(books).find((candidate) => sameName(candidate.name, series)),
    [books, series],
  );

  if (!group) {
    return (
      <div className="space-y-5">
        <p className="text-sm opacity-60">No books in the series {series} in your library.</p>
        <LibraryMissingSection kind="series" name={series} actions={actions} />
      </div>
    );
  }

  const range = seriesRangeLabel(group);
  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <PageHeading
          kind="Series"
          name={group.name}
          detail={`${plural(group.books.length, 'book')} in your library${range ? ` · ${range}` : ''}`}
        />
        <p className="flex flex-wrap gap-x-2 text-sm">
          {group.authors.map((author) => (
            <button
              key={author}
              type="button"
              className="opacity-80 hover:underline"
              onClick={() => onAuthorClick(author)}
            >
              {author}
            </button>
          ))}
        </p>
      </div>
      <LibraryBookGrid
        books={group.books}
        series={group.name}
        onAuthorClick={onAuthorClick}
        cardActions={cardActions}
      />
      <LibraryMissingSection kind="series" name={group.name} actions={actions} />
    </div>
  );
};
