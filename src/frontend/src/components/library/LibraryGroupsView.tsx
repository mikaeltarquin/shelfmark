import { Fragment, useMemo, useState } from 'react';

import type { LibraryBook } from '../../types';
import { lastFirstName } from '../../utils/authorNames';
import { matchesFormat, type LibraryFormatFilter } from '../../utils/libraryBrowser';
import { SERIES_SORT_OPTIONS, loadLibraryDefaults } from '../../utils/libraryDefaults';
import {
  defaultSeriesSortDirection,
  groupBySeries,
  seriesRangeLabel,
  sortSeriesGroups,
  type LibrarySeriesGroup,
  type SeriesSortField,
  type SortDirection,
} from '../../utils/libraryGroups';
import { loadStoredPrefs, saveStoredPrefs } from '../../utils/libraryPrefs';
import type { OwnershipFilter } from '../../utils/libraryRows';
import { LibraryFormatBadges, type LibraryCardActions } from './LibraryBookCard';
import {
  DirectionButton,
  ExpandButton,
  FormatSelect,
  LayoutToggle,
  OwnershipToggle,
  PlainHeader,
  SortHeader,
  isFormatFilter,
  isLayout,
  isOwnershipFilter,
  rowClass,
  tableShellClass,
  tableShellStyle,
  type LibraryLayout,
} from './LibraryControls';
import { LibraryGroupBooks, missingLookupType } from './LibraryGroupBooks';
import { LibraryGroupCard } from './LibraryGroupCard';
import type { LibraryBookActions } from './LibraryMissingSection';
import { inputClass } from './libraryStyles';

interface SeriesPrefs {
  sort: SeriesSortField;
  direction: SortDirection;
  view: LibraryLayout;
  ownership: OwnershipFilter;
  format: LibraryFormatFilter;
}

const PREFS_KEY = 'shelfmark.library.series';
const DEFAULT_PREFS: SeriesPrefs = {
  sort: 'name',
  direction: 'asc',
  view: 'grid',
  ownership: 'owned',
  format: 'any',
};

const SORT_OPTIONS = SERIES_SORT_OPTIONS;

const isSortField = (value: unknown): value is SeriesSortField =>
  SORT_OPTIONS.some((option) => option.value === value);

// The sort chosen under My Account, if any, wins over the one last used.
const loadPrefs = (): SeriesPrefs => {
  const { seriesSort } = loadLibraryDefaults();
  const prefs = loadRememberedPrefs();
  return seriesSort
    ? { ...prefs, sort: seriesSort, direction: defaultSeriesSortDirection(seriesSort) }
    : prefs;
};

const loadRememberedPrefs = (): SeriesPrefs => {
  const raw = loadStoredPrefs(PREFS_KEY);
  if (!raw) return DEFAULT_PREFS;
  const sort: unknown = Reflect.get(raw, 'sort');
  const view: unknown = Reflect.get(raw, 'view');
  const ownership: unknown = Reflect.get(raw, 'ownership');
  const format: unknown = Reflect.get(raw, 'format');
  return {
    sort: isSortField(sort) ? sort : DEFAULT_PREFS.sort,
    direction: Reflect.get(raw, 'direction') === 'desc' ? 'desc' : 'asc',
    view: isLayout(view) ? view : DEFAULT_PREFS.view,
    ownership: isOwnershipFilter(ownership) ? ownership : DEFAULT_PREFS.ownership,
    format: isFormatFilter(format) ? format : DEFAULT_PREFS.format,
  };
};

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

const fold = (value: string) => value.toLowerCase();

const formatDate = (seconds: number | null): string =>
  seconds ? new Date(seconds * 1000).toLocaleDateString() : '—';

const gridClass = 'grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5';

interface LibrarySeriesViewProps {
  books: LibraryBook[];
  onOpen: (series: string) => void;
  onAuthorClick: (author: string) => void;
  actions: LibraryBookActions;
  cardActions: LibraryCardActions;
}

/** Every series, as cards or a sortable table whose rows open onto the series in order. */
export const LibrarySeriesView = ({
  books,
  onOpen,
  onAuthorClick,
  actions,
  cardActions,
}: LibrarySeriesViewProps) => {
  const [query, setQuery] = useState('');
  const [prefs, setPrefs] = useState<SeriesPrefs>(loadPrefs);
  const [open, setOpen] = useState<Set<string>>(() => new Set());

  const groups: LibrarySeriesGroup[] = useMemo(() => {
    const ownedOnly = prefs.ownership === 'owned' || prefs.view === 'grid';
    const shelf = ownedOnly ? books.filter((book) => matchesFormat(book, prefs.format)) : books;
    return groupBySeries(shelf);
  }, [books, prefs.format, prefs.ownership, prefs.view]);
  const needle = fold(query.trim());
  const visible = sortSeriesGroups(
    groups.filter(
      (group) =>
        fold(group.name).includes(needle) ||
        group.authors.some(
          (author) => fold(author).includes(needle) || fold(lastFirstName(author)).includes(needle),
        ),
    ),
    prefs.sort,
    prefs.direction,
  );
  // Sorting by "Last, First" shows the authors that way too (then ";" separates them).
  const authorLine = (group: LibrarySeriesGroup) =>
    prefs.sort === 'author_last'
      ? group.authors.map(lastFirstName).join('; ')
      : group.authors.join(', ');

  const update = (next: Partial<SeriesPrefs>) => {
    const merged = { ...prefs, ...next };
    setPrefs(merged);
    saveStoredPrefs(PREFS_KEY, merged);
    const wantsMissing = merged.ownership !== 'owned' && merged.view === 'table';
    const lookupType = missingLookupType(merged.format, actions);
    if (
      wantsMissing &&
      lookupType !== actions.contentType &&
      actions.allowedContentTypes.includes(lookupType)
    ) {
      actions.onContentTypeChange(lookupType);
    }
  };
  const sortBy = (field: SeriesSortField) =>
    update(
      field === prefs.sort
        ? { direction: prefs.direction === 'asc' ? 'desc' : 'asc' }
        : { sort: field, direction: defaultSeriesSortDirection(field) },
    );
  const toggle = (name: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  const filterKey = `${prefs.ownership}|${missingLookupType(prefs.format, actions)}`;
  const authorField: SeriesSortField =
    prefs.sort === 'author_last' ? 'author_last' : 'author_first';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter series or authors"
          aria-label="Filter series or authors"
          className={`${inputClass} w-full sm:w-auto sm:max-w-sm sm:flex-1`}
        />
        <select
          value={prefs.sort}
          onChange={(event) => {
            const value = event.target.value;
            if (isSortField(value)) {
              update({ sort: value, direction: defaultSeriesSortDirection(value) });
            }
          }}
          aria-label="Sort series by"
          className={inputClass}
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              Sort: {option.label}
            </option>
          ))}
        </select>
        <DirectionButton value={prefs.direction} onChange={(direction) => update({ direction })} />
        <FormatSelect
          value={prefs.format}
          ownership={prefs.view === 'table' ? prefs.ownership : 'owned'}
          onChange={(format) => update({ format })}
        />
        <LayoutToggle value={prefs.view} onChange={(view) => update({ view })} />
        {prefs.view === 'table' && (
          <OwnershipToggle
            value={prefs.ownership}
            onChange={(ownership) => update({ ownership })}
          />
        )}
        {prefs.view === 'table' && open.size > 0 && (
          <button
            type="button"
            onClick={() => setOpen(new Set())}
            className="text-xs font-medium opacity-60 hover:opacity-100"
          >
            Collapse all
          </button>
        )}
      </div>

      {prefs.view === 'table' && prefs.ownership !== 'owned' && (
        <p className="text-xs opacity-60">
          Open a series to see the books the metadata provider lists that your library lacks, in
          reading order with your own.
        </p>
      )}

      {visible.length === 0 && (
        <p className="text-sm opacity-60">
          {groups.length === 0
            ? 'No book in your library is part of a series.'
            : 'No series match.'}
        </p>
      )}

      {visible.length > 0 && prefs.view === 'grid' && (
        <div className={gridClass}>
          {visible.map((group) => {
            const range = seriesRangeLabel(group);
            return (
              <LibraryGroupCard
                key={group.name}
                title={group.name}
                subtitle={authorLine(group)}
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

      {visible.length > 0 && prefs.view === 'table' && (
        <div className={tableShellClass} style={tableShellStyle}>
          <table className="w-full text-sm">
            <thead className="border-b border-(--border-muted)">
              <tr>
                <th scope="col" className="w-8">
                  <span className="sr-only">Open</span>
                </th>
                <SortHeader
                  label="Series"
                  field="name"
                  sort={prefs.sort}
                  direction={prefs.direction}
                  onSort={sortBy}
                />
                <SortHeader
                  label={
                    authorField === 'author_last' ? 'Author (Last, First)' : 'Author (First Last)'
                  }
                  field={authorField}
                  sort={prefs.sort}
                  direction={prefs.direction}
                  onSort={sortBy}
                  className="max-sm:hidden"
                />
                <SortHeader
                  label="Book Count"
                  field="books"
                  sort={prefs.sort}
                  direction={prefs.direction}
                  onSort={sortBy}
                  align="right"
                />
                <PlainHeader label="Numbers" align="right" className="max-sm:hidden" />
                <PlainHeader label="Formats" className="max-sm:hidden" />
                <SortHeader
                  label="Last added"
                  field="added"
                  sort={prefs.sort}
                  direction={prefs.direction}
                  onSort={sortBy}
                  align="right"
                  className="max-md:hidden"
                />
              </tr>
            </thead>
            <tbody>
              {visible.map((group) => {
                const isOpen = open.has(group.name);
                return (
                  <Fragment key={group.name}>
                    <tr className={rowClass}>
                      <td className="pl-2">
                        <ExpandButton
                          open={isOpen}
                          label={group.name}
                          onToggle={() => toggle(group.name)}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => onOpen(group.name)}
                          className="text-left font-medium hover:underline"
                        >
                          {group.name}
                        </button>
                      </td>
                      <td className="px-3 py-2 max-sm:hidden">
                        <span className="flex flex-wrap gap-x-1">
                          {group.authors.map((author, index) => (
                            <button
                              key={author}
                              type="button"
                              className="text-left hover:underline"
                              onClick={() => onAuthorClick(author)}
                            >
                              {prefs.sort === 'author_last' ? lastFirstName(author) : author}
                              {index < group.authors.length - 1 ? ';' : ''}
                            </button>
                          ))}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{group.books.length}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums max-sm:hidden">
                        {seriesRangeLabel(group) ?? '—'}
                      </td>
                      <td className="px-3 py-2 max-sm:hidden">
                        <LibraryFormatBadges formats={group.formats} />
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums max-md:hidden">
                        {formatDate(group.latestAdded)}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-(--border-muted)">
                        <td colSpan={7} className="bg-(--bg) pl-8">
                          <LibraryGroupBooks
                            key={filterKey}
                            kind="series"
                            name={group.name}
                            books={group.books}
                            ownership={prefs.ownership}
                            format={prefs.format}
                            actions={actions}
                            cardActions={cardActions}
                            onAuthorClick={onAuthorClick}
                            onSeriesClick={onOpen}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
