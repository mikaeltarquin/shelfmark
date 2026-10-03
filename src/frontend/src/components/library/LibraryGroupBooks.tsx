import { useState } from 'react';

import { useMountEffect } from '../../hooks/useMountEffect';
import type { LibraryMissingResult } from '../../services/api';
import type { ContentType, LibraryBook } from '../../types';
import type { LibraryFormatFilter } from '../../utils/libraryBrowser';
import { loadLibraryDefaults } from '../../utils/libraryDefaults';
import {
  combineRows,
  rowMatches,
  rowSeriesSections,
  sortRowsByYear,
  sortRowsInSeries,
  withoutTakenNumbers,
  type LibraryRow,
  type OwnershipFilter,
} from '../../utils/libraryRows';
import type { LibraryCardActions } from './LibraryBookCard';
import { LibraryBookTable } from './LibraryBookTable';
import { lookupMissing, type LibraryBookActions } from './LibraryMissingSection';

/** The provider to ask about missing books: the format filtered on, else the header's. */
export const missingLookupType = (
  format: LibraryFormatFilter,
  actions: LibraryBookActions,
): ContentType => (format === 'ebook' || format === 'audiobook' ? format : actions.contentType);

interface LibraryGroupBooksProps {
  kind: 'author' | 'series';
  name: string;
  books: LibraryBook[]; // The library's books in this group
  ownership: OwnershipFilter;
  format: LibraryFormatFilter;
  // An author's books: by series then number, or oldest first. A series is in reading order.
  order?: 'series' | 'year';
  actions: LibraryBookActions;
  cardActions: LibraryCardActions;
  onAuthorClick: (author: string) => void;
  onSeriesClick: (series: string) => void;
}

/**
 * The books under an opened author or series row: the library's own and, when asked for,
 * the ones the metadata provider lists that it lacks, in one list. Missing books are
 * looked up when the row opens (remembered for the session).
 */
export const LibraryGroupBooks = ({
  kind,
  name,
  books,
  ownership,
  format,
  order = 'year',
  actions,
  cardActions,
  onAuthorClick,
  onSeriesClick,
}: LibraryGroupBooksProps) => {
  const wantsMissing = ownership !== 'owned';
  const [result, setResult] = useState<LibraryMissingResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useMountEffect(() => {
    if (!wantsMissing) return;
    lookupMissing(kind, name, missingLookupType(format, actions))
      .then(setResult)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Could not list missing books');
      });
  });

  const rows: LibraryRow[] = combineRows(
    books,
    wantsMissing && result?.supported ? result.books : [],
  ).filter((row) => rowMatches(row, ownership, format));

  let note: string | null = null;
  if (wantsMissing) {
    if (error) note = error;
    else if (!result) note = 'Looking up missing books…';
    else if (!result.supported) note = result.reason;
    else if (result.provider) note = `Missing books from ${result.provider}`;
  }

  const table = (tableRows: LibraryRow[], series?: string, showSeries = true) => (
    <LibraryBookTable
      rows={tableRows}
      series={series}
      showSeries={showSeries}
      cardActions={cardActions}
      actions={actions}
      onAuthorClick={onAuthorClick}
      onSeriesClick={onSeriesClick}
      showAuthor={kind !== 'author'}
    />
  );

  // Hiding collections also hides missing books numbered like ones the library holds.
  const [hideTaken] = useState(() => loadLibraryDefaults().collections === 'hide');
  const inSeries = (seriesRows: LibraryRow[], series: string) =>
    sortRowsInSeries(hideTaken ? withoutTakenNumbers(seriesRows, series) : seriesRows, series);

  let body;
  if (rows.length === 0) {
    body =
      wantsMissing && !result && !error ? null : (
        <p className="px-3 py-2 text-sm opacity-60">No books match these filters.</p>
      );
  } else if (kind === 'series') {
    body = table(inSeries(rows, name), name);
  } else if (order === 'series') {
    const sections = rowSeriesSections(rows).map((section) =>
      section.series === null
        ? section
        : { ...section, rows: inSeries(section.rows, section.series) },
    );
    body = (
      <div className="space-y-3">
        {sections.map((section) => (
          <div key={section.series ?? '(none)'}>
            <h4 className="px-3 pt-1 text-xs font-semibold tracking-wide uppercase opacity-70">
              {section.series ? (
                <button
                  type="button"
                  className="uppercase hover:underline"
                  onClick={() => onSeriesClick(section.series ?? '')}
                >
                  {section.series}
                </button>
              ) : (
                'Other books'
              )}
              <span className="ml-2 font-normal opacity-70">{section.rows.length}</span>
            </h4>
            {table(section.rows, section.series ?? undefined, section.series !== null)}
          </div>
        ))}
      </div>
    );
  } else {
    body = table(sortRowsByYear(rows));
  }

  return (
    <div className="space-y-2 py-2">
      {body}
      {note && (
        <p className={`px-3 text-xs ${error ? 'text-red-600 dark:text-red-400' : 'opacity-60'}`}>
          {note}
        </p>
      )}
    </div>
  );
};
