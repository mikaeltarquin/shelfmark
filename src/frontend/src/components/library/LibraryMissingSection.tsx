import { useState } from 'react';

import { SearchModeProvider } from '../../contexts/SearchModeContext';
import { useMountEffect } from '../../hooks/useMountEffect';
import { getLibraryMissing, type LibraryMissingResult } from '../../services/api';
import type { Book, ButtonStateInfo, ContentType } from '../../types';
import { loadLibraryDefaults } from '../../utils/libraryDefaults';
import { isMissing, type MissingFormat } from '../../utils/libraryMissing';
import { CardView } from '../resultsViews/CardView';
import { segmentClass } from './libraryStyles';

export interface LibraryBookActions {
  contentType: ContentType;
  allowedContentTypes: ContentType[];
  onContentTypeChange: (contentType: ContentType) => void;
  onShowDetails: (book: Book) => Promise<void>;
  onGetReleases: (book: Book) => Promise<void>;
  getButtonState: (bookId: string) => ButtonStateInfo;
  onShowToast?: (message: string, type: 'success' | 'error' | 'info') => void;
}

// Provider lookups are remembered for the session, so revisiting a page is instant.
const lookups = new Map<string, Promise<LibraryMissingResult>>();

export const lookupMissing = (
  kind: 'author' | 'series',
  name: string,
  contentType: ContentType,
): Promise<LibraryMissingResult> => {
  const collections = loadLibraryDefaults().collections === 'show';
  const key = `${kind}|${name.toLowerCase()}|${contentType}|${collections}`;
  let pending = lookups.get(key);
  if (!pending) {
    pending = getLibraryMissing(kind, name, contentType, collections);
    lookups.set(key, pending);
    pending.catch(() => lookups.delete(key));
  }
  return pending;
};

const FORMATS: Array<{ value: MissingFormat; label: string }> = [
  { value: 'any', label: 'Any format' },
  { value: 'ebook', label: 'Ebook' },
  { value: 'audiobook', label: 'Audiobook' },
];

interface LibraryMissingSectionProps {
  kind: 'author' | 'series';
  name: string;
  actions: LibraryBookActions;
}

/** Books the metadata provider lists for an author or series that the library lacks. */
export const LibraryMissingSection = ({ kind, name, actions }: LibraryMissingSectionProps) => {
  const [format, setFormat] = useState<MissingFormat>('any');
  const [results, setResults] = useState<Partial<Record<ContentType, LibraryMissingResult>>>({});
  const [error, setError] = useState<string | null>(null);

  // "Any format" looks books up with the provider for the format picked in the header.
  const lookupType: ContentType = format === 'any' ? actions.contentType : format;
  const result = results[lookupType];

  const load = (contentType: ContentType) => {
    setError(null);
    lookupMissing(kind, name, contentType)
      .then((loaded) => setResults((current) => ({ ...current, [contentType]: loaded })))
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Could not list missing books');
      });
  };

  useMountEffect(() => {
    load(lookupType);
  });

  const choose = (next: MissingFormat) => {
    setFormat(next);
    // "Get" follows the format looked at, so a missing audiobook fetches audiobook releases.
    if (next !== 'any' && actions.allowedContentTypes.includes(next)) {
      actions.onContentTypeChange(next);
    }
    const nextType: ContentType = next === 'any' ? actions.contentType : next;
    if (!results[nextType]) load(nextType);
  };

  const missing = result?.books.filter((book) => isMissing(book, format)) ?? [];

  let body;
  if (error) {
    body = <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  } else if (!result) {
    body = <p className="text-sm opacity-60">Looking up {name}…</p>;
  } else if (!result.supported) {
    body = <p className="text-sm opacity-70">{result.reason}</p>;
  } else if (missing.length === 0) {
    body = (
      <p className="text-sm opacity-70">
        {result.books.length === 0
          ? `${result.provider ?? 'The metadata provider'} lists no books for ${name}.`
          : `You have every book ${result.provider ?? 'the metadata provider'} lists${
              format === 'any' ? '' : ` as ${format === 'ebook' ? 'an ebook' : 'an audiobook'}`
            }.`}
      </p>
    );
  } else {
    body = (
      <SearchModeProvider searchMode="universal">
        <div className="grid grid-cols-1 items-stretch gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {missing.map((book) => (
            <CardView
              key={book.id}
              book={book}
              onDetails={async (id) => {
                const found = missing.find((candidate) => candidate.id === id);
                if (found) await actions.onShowDetails(found);
              }}
              onDownload={actions.onGetReleases}
              onGetReleases={actions.onGetReleases}
              buttonState={actions.getButtonState(book.id)}
              showSeriesPosition={kind === 'series'}
              onShowToast={actions.onShowToast}
            />
          ))}
        </div>
      </SearchModeProvider>
    );
  }

  return (
    <section className="space-y-3 border-t border-(--border-muted) pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-semibold">
          Not in your library
          {result?.supported && missing.length > 0 && (
            <span className="ml-2 text-sm font-normal opacity-60">{missing.length}</span>
          )}
          {result?.provider && (
            <span className="ml-2 text-xs font-normal opacity-50">from {result.provider}</span>
          )}
        </h3>
        <div className="flex gap-1" role="group" aria-label="Missing in format">
          {FORMATS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={segmentClass(format === option.value)}
              onClick={() => choose(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      {body}
    </section>
  );
};
