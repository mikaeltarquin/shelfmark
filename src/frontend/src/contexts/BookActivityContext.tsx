import { createContext, useCallback, useContext, useMemo, useState } from 'react';

import { useMountEffect } from '../hooks/useMountEffect';
import { getBookActivity } from '../services/api';
import type { StatusData } from '../types';
import {
  downloadSummary,
  indexDownloads,
  mergeDownloads,
  releaseDownloadState,
  savedItemFor,
  type ActivityBookRef,
  type BookDownloadEntry,
  type BookDownloadState,
  type BookDownloadSummary,
} from '../utils/bookActivity';
import type { SavedItem } from '../utils/savedItems';

export interface BookActivityContextValue {
  /** Where the book stands in Downloads, or null if it was never downloaded. */
  downloadFor: (book: ActivityBookRef) => BookDownloadSummary | null;
  /** The book's saved item, if it is saved. */
  savedFor: (book: ActivityBookRef) => SavedItem | undefined;
  /** Where one release (by source id) stands in Downloads, or null if never downloaded. */
  releaseDownloadFor: (sourceId: string) => BookDownloadState | null;
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
  const releaseDownloadFor = useCallback(
    (sourceId: string) => releaseDownloadState(index, sourceId),
    [index],
  );
  return useMemo(
    () => ({ downloadFor, savedFor, releaseDownloadFor, refresh }),
    [downloadFor, savedFor, releaseDownloadFor, refresh],
  );
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
