import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

import { useMountEffect } from '../hooks/useMountEffect';
import { deleteSavedItem, getSavedItems, saveForLater, updateSavedItem } from '../services/api';
import type { Book, ContentType, Release } from '../types';
import {
  savedBookKey,
  savedPayloads,
  type SavedConditions,
  type SavedItem,
  type SavedPick,
} from '../utils/savedItems';

export type SavedContentType = ContentType | 'combined';

export interface SavedItemsContextValue {
  items: SavedItem[];
  /** What a book is saved for from a card: the search's content type, or combined. */
  contentType: SavedContentType;
  loaded: boolean;
  /** The saved item for a book, if it is saved. */
  savedFor: (book: Book) => SavedItem | undefined;
  /** Save a book with no release picked (pick one when getting it). */
  saveBook: (book: Book, contentType: SavedContentType) => Promise<void>;
  /** Save the exact releases picked for a book: one release, or an ebook and audiobooks. */
  // Resolves true once saved; failures are shown as a toast.
  savePicks: (book: Book, contentType: SavedContentType, picks: SavedPick[]) => Promise<boolean>;
  remove: (item: SavedItem, options?: { quiet?: boolean }) => Promise<void>;
  /** Turn automatic downloading on or off, or change its conditions. */
  setAutoGet: (
    item: SavedItem,
    changes: { auto_get?: boolean; conditions?: SavedConditions },
  ) => Promise<void>;
  refresh: () => Promise<void>;
}

const SavedItemsContext = createContext<SavedItemsContextValue | null>(null);

export const SavedItemsProvider = SavedItemsContext.Provider;

/** Saved items, or null where saving isn't available (signed out). */
export const useSavedItems = (): SavedItemsContextValue | null => useContext(SavedItemsContext);

/** One release, picked for a book, to save. */
export const singlePick = (release: Release, contentType: ContentType): SavedPick[] => [
  { content_type: contentType, release },
];

/** The saved list, kept by the app; `SavedItemsLoader` reads it once signed in. */
export const useSavedItemsStore = ({
  contentType,
  onShowToast,
}: {
  contentType: SavedContentType;
  onShowToast?: (message: string, type?: 'success' | 'error' | 'info') => void;
}): SavedItemsContextValue => {
  const [items, setItems] = useState<SavedItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  // What the last refresh saw, to tell when an automatic download took an item.
  const lastSeen = useRef<SavedItem[] | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await getSavedItems();
      const previous = lastSeen.current;
      if (previous) {
        const remaining = new Set(next.map((item) => item.id));
        previous
          .filter((item) => item.auto_get && !remaining.has(item.id))
          .forEach((item) => onShowToast?.(`Got "${item.title}" from Saved automatically`, 'info'));
      }
      lastSeen.current = next;
      setItems(next);
    } catch (error) {
      console.warn('Could not load saved items:', error);
    } finally {
      setLoaded(true);
    }
  }, [onShowToast]);

  const replaceItem = useCallback((saved: SavedItem) => {
    const apply = (current: SavedItem[]) => [
      saved,
      ...current.filter((item) => item.id !== saved.id),
    ];
    lastSeen.current = lastSeen.current ? apply(lastSeen.current) : null;
    setItems((current) =>
      current.some((item) => item.id === saved.id)
        ? current.map((item) => (item.id === saved.id ? saved : item))
        : apply(current),
    );
  }, []);

  const store = useCallback(
    async (book: Book, savedAs: SavedContentType, picks: SavedPick[]): Promise<boolean> => {
      try {
        const saved = await saveForLater({
          book,
          content_type: savedAs,
          releases: picks,
          payloads: picks.length > 0 ? savedPayloads(book, picks) : undefined,
        });
        replaceItem(saved);
        onShowToast?.(`Saved "${saved.title}" for later`, 'success');
        return true;
      } catch (error) {
        onShowToast?.(error instanceof Error ? error.message : 'Could not save', 'error');
        return false;
      }
    },
    [onShowToast, replaceItem],
  );

  const remove = useCallback(
    async (item: SavedItem, options?: { quiet?: boolean }) => {
      try {
        await deleteSavedItem(item.id);
        const drop = (current: SavedItem[]) =>
          current.filter((existing) => existing.id !== item.id);
        lastSeen.current = lastSeen.current ? drop(lastSeen.current) : null;
        setItems(drop);
        if (!options?.quiet) onShowToast?.(`Removed "${item.title}" from Saved`, 'info');
      } catch (error) {
        onShowToast?.(error instanceof Error ? error.message : 'Could not remove', 'error');
      }
    },
    [onShowToast],
  );

  const setAutoGet = useCallback(
    async (item: SavedItem, changes: { auto_get?: boolean; conditions?: SavedConditions }) => {
      try {
        const updated = await updateSavedItem(item.id, {
          ...changes,
          // Sent each time it's turned on, so items saved before payloads were kept work too.
          ...(changes.auto_get ? { payloads: savedPayloads(item.book, item.releases) } : {}),
        });
        replaceItem(updated);
      } catch (error) {
        onShowToast?.(error instanceof Error ? error.message : 'Could not update', 'error');
      }
    },
    [onShowToast, replaceItem],
  );

  return useMemo<SavedItemsContextValue>(() => {
    const byKey = new Map(items.map((item) => [item.book_key, item]));
    return {
      items,
      contentType,
      loaded,
      savedFor: (book) => byKey.get(savedBookKey(book)),
      saveBook: async (book, savedAs) => {
        await store(book, savedAs, []);
      },
      savePicks: store,
      remove,
      setAutoGet,
      refresh,
    };
  }, [contentType, items, loaded, refresh, remove, setAutoGet, store]);
};

// Re-read now and then, so items got automatically leave the list (with a toast).
const SAVED_REFRESH_MS = 60_000;

/** Reads the saved list when mounted: render it only for a signed-in session. */
export const SavedItemsLoader = ({ onLoad }: { onLoad: () => Promise<void> }) => {
  useMountEffect(() => {
    void onLoad();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void onLoad();
    }, SAVED_REFRESH_MS);
    return () => window.clearInterval(timer);
  });
  return null;
};
