import { useMemo, useState } from 'react';

import type { LibraryBook } from '../../types';
import {
  groupBySeries,
  seriesRangeLabel,
  type LibrarySeriesGroup,
} from '../../utils/libraryGroups';
import { LibraryGroupCard } from './LibraryGroupCard';
import { inputClass, segmentClass } from './libraryStyles';

type GroupSort = 'name' | 'count';

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

const fold = (value: string) => value.toLowerCase();

interface GroupsToolbarProps {
  query: string;
  onQuery: (value: string) => void;
  sort: GroupSort;
  onSort: (value: GroupSort) => void;
  placeholder: string;
}

const GroupsToolbar = ({ query, onQuery, sort, onSort, placeholder }: GroupsToolbarProps) => (
  <div className="flex flex-wrap items-center gap-2">
    <input
      type="search"
      value={query}
      onChange={(event) => onQuery(event.target.value)}
      placeholder={placeholder}
      aria-label={placeholder}
      className={`${inputClass} w-full sm:w-auto sm:max-w-sm sm:flex-1`}
    />
    <div className="flex gap-1" role="group" aria-label="Sort">
      <button
        type="button"
        className={segmentClass(sort === 'name')}
        onClick={() => onSort('name')}
      >
        A–Z
      </button>
      <button
        type="button"
        className={segmentClass(sort === 'count')}
        onClick={() => onSort('count')}
      >
        Most books
      </button>
    </div>
  </div>
);

const gridClass = 'grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5';

const sortGroups = <T extends { name: string; books: LibraryBook[] }>(
  groups: T[],
  sort: GroupSort,
): T[] => (sort === 'count' ? groups.toSorted((a, b) => b.books.length - a.books.length) : groups);

export const LibrarySeriesView = ({
  books,
  onOpen,
}: {
  books: LibraryBook[];
  onOpen: (series: string) => void;
}) => {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<GroupSort>('name');
  const groups: LibrarySeriesGroup[] = useMemo(() => groupBySeries(books), [books]);
  const needle = fold(query.trim());
  const visible = sortGroups(
    groups.filter(
      (group) =>
        fold(group.name).includes(needle) ||
        group.authors.some((author) => fold(author).includes(needle)),
    ),
    sort,
  );

  return (
    <div className="space-y-5">
      <GroupsToolbar
        query={query}
        onQuery={setQuery}
        sort={sort}
        onSort={setSort}
        placeholder="Filter series or authors"
      />
      {visible.length === 0 ? (
        <p className="text-sm opacity-60">
          {groups.length === 0
            ? 'No book in your library is part of a series.'
            : 'No series match.'}
        </p>
      ) : (
        <div className={gridClass}>
          {visible.map((group) => {
            const range = seriesRangeLabel(group);
            return (
              <LibraryGroupCard
                key={group.name}
                title={group.name}
                subtitle={group.authors.join(', ')}
                detail={
                  range
                    ? `${plural(group.books.length, 'book')} · ${range}`
                    : plural(group.books.length, 'book')
                }
                books={group.books}
                formats={group.formats}
                onOpen={() => onOpen(group.name)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};
