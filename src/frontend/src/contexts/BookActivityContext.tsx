import { createContext, useCallback, useContext, useMemo, useState } from 'react';

import { useMountEffect } from '../hooks/useMountEffect';
import { getBookActivity } from '../services/api';
import type { StatusData } from '../types';
import {
  downloadSummary,
  indexDownloads,
  mergeDownloads,
  savedItemFor,
  type ActivityBookRef,
  type BookDownloadEntry,
  type BookDownloadSummary,
} from '../utils/bookActivity';
import type { SavedItem } from '../utils/savedItems';

export interface BookActivityContextValue {
  /** Where the book stands in Downloads, or null if it was never downloaded. */
  downloadFor: (book: ActivityBookRef) => BookDownloadSummary | null;
  /** The book's saved item, if it is saved. */
  savedFor: (book: ActivityBookRef) => SavedItem | undefined;
  refresh: () => Promise<void>;
}

const BookActivityContext = createContext<BookActivityContextValue | null>(null);

export const BookActivityProvider = BookActivityContext.Provider;

/** Saved and Downloads marks for books, or null where they aren't available (signed out). */
export const useBookActivity = (): BookActivityContextValue | null =>
  useContext(BookActivityContext);

/** The marks, kept by the app: the download history read once, overlaid with live status. */
export const useBookActivityStore = ({
  status,
  savedItems,
}: {
  status: StatusData;
  savedItems: SavedItem[];
}): BookActivityContextValue => {
  const [history, setHistory] = useState<BookDownloadEntry[]>([]);

  const refresh = useCallback(async () => {
    try {
      setHistory(await getBookActivity());
    } catch (error) {
      console.warn('Could not load download history for books:', error);
    }
  }, []);

  const index = useMemo(() => indexDownloads(mergeDownloads(history, status)), [history, status]);
  const downloadFor = useCallback((book: ActivityBookRef) => downloadSummary(index, book), [index]);
  const savedFor = useCallback(
    (book: ActivityBookRef) => savedItemFor(savedItems, book),
    [savedItems],
  );
  return useMemo(() => ({ downloadFor, savedFor, refresh }), [downloadFor, savedFor, refresh]);
};

// Live status covers new downloads; this re-read picks up dismissals and other devices.
const HISTORY_REFRESH_MS = 5 * 60 * 1000;

/** Reads the download history once signed in, and now and then after. */
export const BookActivityLoader = ({ onLoad }: { onLoad: () => Promise<void> }) => {
  useMountEffect(() => {
    void onLoad();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void onLoad();
    }, HISTORY_REFRESH_MS);
    return () => window.clearInterval(timer);
  });
  return null;
};
