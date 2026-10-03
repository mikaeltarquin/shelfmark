import { Fragment, useMemo, useState } from 'react';

import type { LibraryBook } from '../../types';
import { lastFirstName } from '../../utils/authorNames';
import { matchesFormat, type LibraryFormatFilter } from '../../utils/libraryBrowser';
import {
  defaultAuthorSortDirection,
  groupByAuthor,
  isLastNameSort,
  isSeriesOrderSort,
  sortAuthorGroups,
  type AuthorSortField,
  type LibraryAuthorGroup,
  type SortDirection,
} from '../../utils/libraryGroups';
import { loadStoredPrefs, saveStoredPrefs } from '../../utils/libraryPrefs';
import { ownedRow, rowSeriesSections, type OwnershipFilter } from '../../utils/libraryRows';
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

interface AuthorPrefs {
  sort: AuthorSortField;
  direction: SortDirection;
  view: LibraryLayout;
  ownership: OwnershipFilter;
  format: LibraryFormatFilter;
}

const PREFS_KEY = 'shelfmark.library.authors';
const DEFAULT_PREFS: AuthorPrefs = {
  sort: 'first',
  direction: 'asc',
  view: 'grid',
  ownership: 'owned',
  format: 'any',
};

const SORT_OPTIONS: Array<{ value: AuthorSortField; label: string }> = [
  { value: 'first', label: 'Author (First Last)' },
  { value: 'last', label: 'Author (Last, First)' },
  { value: 'series_order', label: 'Author (First Last) › Series › Book' },
  { value: 'series_order_last', label: 'Author (Last, First) › Series › Book' },
  { value: 'books', label: 'Book Count' },
  { value: 'added', label: 'Recently added' },
];

// "Series" (the count) is a table column, not a menu choice.
const isSortField = (value: unknown): value is AuthorSortField =>
  value === 'series' || SORT_OPTIONS.some((option) => option.value === value);

const loadPrefs = (): AuthorPrefs => {
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

const formatDate = (seconds: number | null): string =>
  seconds ? new Date(seconds * 1000).toLocaleDateString() : '—';

const groupDetail = (group: LibraryAuthorGroup): string =>
  group.seriesCount > 0
    ? `${plural(group.books.length, 'book')} · ${group.seriesCount} series`
    : plural(group.books.length, 'book');

// Author › Series › Book: the cover strip follows the same order as the opened row.
const inSeriesOrder = (books: LibraryBook[]): LibraryBook[] =>
  rowSeriesSections(books.map(ownedRow)).flatMap((section) =>
    section.rows.flatMap((row) => (row.kind === 'owned' ? [row.book] : [])),
  );

interface LibraryAuthorsViewProps {
  books: LibraryBook[];
  onOpen: (author: string) => void;
  onSeriesClick: (series: string) => void;
  actions: LibraryBookActions;
  cardActions: LibraryCardActions;
}

/** Every author, as cards or a sortable table whose rows open onto their books. */
export const LibraryAuthorsView = ({
  books,
  onOpen,
  onSeriesClick,
  actions,
  cardActions,
}: LibraryAuthorsViewProps) => {
  const [query, setQuery] = useState('');
  const [prefs, setPrefs] = useState<AuthorPrefs>(loadPrefs);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const seriesOrder = isSeriesOrderSort(prefs.sort);

  // Grouped from the books in the chosen format, so counts and covers agree with the filter.
  const groups = useMemo(() => {
    const ownedOnly = prefs.ownership === 'owned' || prefs.view === 'grid';
    const shelf = ownedOnly ? books.filter((book) => matchesFormat(book, prefs.format)) : books;
    return groupByAuthor(shelf);
  }, [books, prefs.format, prefs.ownership, prefs.view]);

  const lastFirst = isLastNameSort(prefs.sort);
  const displayName = (group: LibraryAuthorGroup) =>
    lastFirst ? lastFirstName(group.name) : group.name;

  const needle = query.trim().toLowerCase();
  const visible = sortAuthorGroups(
    groups.filter(
      (group) =>
        group.name.toLowerCase().includes(needle) ||
        lastFirstName(group.name).toLowerCase().includes(needle),
    ),
    prefs.sort,
    prefs.direction,
  );

  const update = (next: Partial<AuthorPrefs>) => {
    const merged = { ...prefs, ...next };
    setPrefs(merged);
    saveStoredPrefs(PREFS_KEY, merged);
    // "Get" on a missing book follows the format looked at, as on the author page.
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
  // Picking a field starts it in its natural direction; picking it again flips it.
  const sortBy = (field: AuthorSortField) =>
    update(
      field === prefs.sort
        ? { direction: prefs.direction === 'asc' ? 'desc' : 'asc' }
        : { sort: field, direction: defaultAuthorSortDirection(field) },
    );
  const nameField: AuthorSortField = lastFirst ? 'last' : 'first';
  // The name column stays lit while books are in series order.
  let headerSort = prefs.sort;
  if (seriesOrder) headerSort = nameField;
  const toggle = (name: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  // Opened rows remount when the filters change, so missing books are looked up again.
  const filterKey = `${prefs.ownership}|${missingLookupType(prefs.format, actions)}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter authors"
          aria-label="Filter authors"
          className={`${inputClass} w-full sm:w-auto sm:max-w-sm sm:flex-1`}
        />
        <select
          value={prefs.sort}
          onChange={(event) => {
            const value = event.target.value;
            if (isSortField(value)) {
              update({ sort: value, direction: defaultAuthorSortDirection(value) });
            }
          }}
          aria-label="Sort authors by"
          className={inputClass}
        >
          {prefs.sort === 'series' && <option value="series">Sort: Series count</option>}
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
          Open an author to see the books the metadata provider lists that your library lacks,
          alongside your own.
        </p>
      )}

      {visible.length === 0 && <p className="text-sm opacity-60">No authors match.</p>}

      {visible.length > 0 && prefs.view === 'grid' && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {visible.map((group) => (
            <LibraryGroupCard
              key={group.name}
              title={displayName(group)}
              detail={groupDetail(group)}
              books={seriesOrder ? inSeriesOrder(group.books) : group.books}
              formats={group.formats}
              onOpen={() => onOpen(group.name)}
            />
          ))}
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
                  label={lastFirst ? 'Author (Last, First)' : 'Author (First Last)'}
                  field={nameField}
                  sort={headerSort}
                  direction={prefs.direction}
                  onSort={sortBy}
                />
                <SortHeader
                  label="Book Count"
                  field="books"
                  sort={prefs.sort}
                  direction={prefs.direction}
                  onSort={sortBy}
                  align="right"
                />
                <PlainHeader label="Ebooks" align="right" className="max-sm:hidden" />
                <PlainHeader label="Audiobooks" align="right" className="max-sm:hidden" />
                <SortHeader
                  label="Series"
                  field="series"
                  sort={prefs.sort}
                  direction={prefs.direction}
                  onSort={sortBy}
                  align="right"
                />
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
                          {displayName(group)}
                        </button>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{group.books.length}</td>
                      <td className="px-3 py-2 text-right tabular-nums max-sm:hidden">
                        {group.ebookCount}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums max-sm:hidden">
                        {group.audiobookCount}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{group.seriesCount}</td>
                      <td className="px-3 py-2 max-sm:hidden">
                        <LibraryFormatBadges formats={group.formats} />
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums max-md:hidden">
                        {formatDate(group.latestAdded)}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-(--border-muted)">
                        <td colSpan={8} className="bg-(--bg) pl-8">
                          <LibraryGroupBooks
                            key={filterKey}
                            kind="author"
                            name={group.name}
                            books={group.books}
                            ownership={prefs.ownership}
                            format={prefs.format}
                            order={seriesOrder ? 'series' : 'year'}
                            actions={actions}
                            cardActions={cardActions}
                            onAuthorClick={onOpen}
                            onSeriesClick={onSeriesClick}
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
