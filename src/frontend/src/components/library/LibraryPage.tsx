import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { useMountEffect } from '../../hooks/useMountEffect';
import { getLibraryBooks, lookupLibraryBook } from '../../services/api';
import type { Book, ContentType, LibraryBook, LibraryBooksResponse } from '../../types';
import { libraryPath, parseLibraryRoute, type LibraryTab } from '../../utils/libraryRoute';
import { LibraryAllView } from './LibraryAllView';
import { LibraryAuthorsView } from './LibraryAuthorsView';
import type { LibraryCardActions } from './LibraryBookCard';
import { LibraryAuthorPage, LibrarySeriesPage } from './LibraryDetailPages';
import { LibrarySeriesView } from './LibraryGroupsView';
import type { LibraryBookActions } from './LibraryMissingSection';

const TABS: Array<{ tab: LibraryTab; label: string; path: string }> = [
  { tab: 'all', label: 'All', path: '/library' },
  { tab: 'authors', label: 'Authors', path: '/library/authors' },
  { tab: 'series', label: 'Series', path: '/library/series' },
];

// Provider records of library books, remembered for the session (failures are retried).
const lookups = new Map<string, Promise<Book>>();

const lookupCached = (book: LibraryBook, contentType: ContentType): Promise<Book> => {
  const key = `${book.id}|${contentType}`;
  let pending = lookups.get(key);
  if (!pending) {
    pending = lookupLibraryBook(book.id, contentType);
    lookups.set(key, pending);
    pending.catch(() => lookups.delete(key));
  }
  return pending;
};

interface LibraryPageProps {
  actions: LibraryBookActions;
}

/** Browse the books already in the user's libraries (Audiobookshelf, Calibre). */
export const LibraryPage = ({ actions }: LibraryPageProps) => {
  const location = useLocation();
  const navigate = useNavigate();
  const route = parseLibraryRoute(location.pathname);
  const [data, setData] = useState<LibraryBooksResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useMountEffect(() => {
    getLibraryBooks()
      .then(setData)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Could not load the library');
      });
  });

  const openAuthor = (author: string) => {
    void navigate(libraryPath('authors', author));
    window.scrollTo({ top: 0 });
  };
  const cardActions: LibraryCardActions = {
    // The provider for the header's format: an audiobook looks up the audiobook record.
    lookup: (book) => lookupCached(book, actions.contentType),
    onShowDetails: actions.onShowDetails,
    onGetReleases: (book) => actions.onGetReleases(book),
    getButtonState: actions.getButtonState,
    onShowToast: actions.onShowToast,
  };
  const openSeries = (series: string) => {
    void navigate(libraryPath('series', series));
    window.scrollTo({ top: 0 });
  };

  let body;
  if (error) {
    body = <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  } else if (!data) {
    body = <p className="text-sm opacity-60">Loading your library…</p>;
  } else if (!data.enabled) {
    body = (
      <p className="text-sm opacity-80">
        No library is connected. Turn one on under Settings → Libraries (Audiobookshelf or Calibre).
      </p>
    );
  } else if (data.books.length === 0) {
    body = <p className="text-sm opacity-60">Your library is empty.</p>;
  } else if (route.tab === 'authors' && route.name) {
    body = (
      <LibraryAuthorPage
        key={route.name}
        books={data.books}
        actions={actions}
        author={route.name}
        onAuthorClick={openAuthor}
        onSeriesClick={openSeries}
        cardActions={cardActions}
      />
    );
  } else if (route.tab === 'authors') {
    body = (
      <LibraryAuthorsView
        books={data.books}
        onOpen={openAuthor}
        onSeriesClick={openSeries}
        actions={actions}
        cardActions={cardActions}
      />
    );
  } else if (route.tab === 'series' && route.name) {
    body = (
      <LibrarySeriesPage
        key={route.name}
        books={data.books}
        actions={actions}
        series={route.name}
        onAuthorClick={openAuthor}
        cardActions={cardActions}
      />
    );
  } else if (route.tab === 'series') {
    body = (
      <LibrarySeriesView
        books={data.books}
        onOpen={openSeries}
        onAuthorClick={openAuthor}
        actions={actions}
        cardActions={cardActions}
      />
    );
  } else {
    body = (
      <LibraryAllView
        books={data.books}
        onAuthorClick={openAuthor}
        onSeriesClick={openSeries}
        cardActions={cardActions}
        actions={actions}
      />
    );
  }

  const sourceNames = data?.sources.map((source) => source.display_name).join(' and ');
  const showTabs = Boolean(data?.enabled && data.books.length > 0);
  const listTab = route.tab === 'series' ? 'series' : 'authors';

  return (
    <section className="space-y-5" aria-labelledby="library-title">
      <div>
        <h1 id="library-title" className="text-2xl font-semibold">
          Library
        </h1>
        {data?.enabled && (
          <p className="text-sm opacity-60">
            {data.books.length} {data.books.length === 1 ? 'book' : 'books'} in {sourceNames}
          </p>
        )}
      </div>

      {showTabs && (
        <nav className="flex gap-1 border-b border-(--border-muted)" aria-label="Library views">
          {TABS.map(({ tab, label, path }) => {
            const selected = route.tab === tab;
            return (
              <button
                key={tab}
                type="button"
                aria-current={selected ? 'page' : undefined}
                onClick={() => void navigate(path)}
                className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                  selected
                    ? 'border-emerald-600 text-emerald-700 dark:text-emerald-400'
                    : 'border-transparent opacity-70 hover:opacity-100'
                }`}
              >
                {label}
              </button>
            );
          })}
        </nav>
      )}

      {showTabs && route.name && (
        <button
          type="button"
          onClick={() => void navigate(libraryPath(listTab))}
          className="text-xs font-medium opacity-60 hover:opacity-100"
        >
          ← All {listTab}
        </button>
      )}

      {body}
    </section>
  );
};
