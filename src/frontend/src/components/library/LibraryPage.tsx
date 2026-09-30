import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { useMountEffect } from '../../hooks/useMountEffect';
import { getLibraryBooks } from '../../services/api';
import type { LibraryBooksResponse } from '../../types';
import { libraryPath, parseLibraryRoute, type LibraryTab } from '../../utils/libraryRoute';
import { LibraryAllView } from './LibraryAllView';
import { LibraryAuthorPage, LibrarySeriesPage } from './LibraryDetailPages';
import { LibraryAuthorsView, LibrarySeriesView } from './LibraryGroupsView';

const TABS: Array<{ tab: LibraryTab; label: string; path: string }> = [
  { tab: 'all', label: 'All', path: '/library' },
  { tab: 'authors', label: 'Authors', path: '/library/authors' },
  { tab: 'series', label: 'Series', path: '/library/series' },
];

interface LibraryPageProps {
  onBack: () => void;
}

/** Browse the books already in the user's libraries (Audiobookshelf, Calibre). */
export const LibraryPage = ({ onBack }: LibraryPageProps) => {
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
        author={route.name}
        onAuthorClick={openAuthor}
        onSeriesClick={openSeries}
      />
    );
  } else if (route.tab === 'authors') {
    body = <LibraryAuthorsView books={data.books} onOpen={openAuthor} />;
  } else if (route.tab === 'series' && route.name) {
    body = (
      <LibrarySeriesPage
        key={route.name}
        books={data.books}
        series={route.name}
        onAuthorClick={openAuthor}
      />
    );
  } else if (route.tab === 'series') {
    body = <LibrarySeriesView books={data.books} onOpen={openSeries} />;
  } else {
    body = (
      <LibraryAllView books={data.books} onAuthorClick={openAuthor} onSeriesClick={openSeries} />
    );
  }

  const sourceNames = data?.sources.map((source) => source.display_name).join(' and ');
  const showTabs = Boolean(data?.enabled && data.books.length > 0);
  const listTab = route.tab === 'series' ? 'series' : 'authors';

  return (
    <section className="space-y-5" aria-labelledby="library-title">
      <div>
        <button
          type="button"
          onClick={onBack}
          className="mb-1 text-xs font-medium opacity-60 hover:opacity-100"
        >
          ← Back to search
        </button>
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
