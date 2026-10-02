import { createContext, useCallback, useContext, useMemo, useState } from 'react';

import { useMountEffect } from '../hooks/useMountEffect';
import { deleteSavedItem, getSavedItems, saveForLater } from '../services/api';
import type { Book, ContentType, Release } from '../types';
import { savedBookKey, type SavedItem, type SavedPick } from '../utils/savedItems';

type SavedContentType = ContentType | 'combined';

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
  savePicks: (book: Book, contentType: SavedContentType, picks: SavedPick[]) => Promise<void>;
  remove: (item: SavedItem, options?: { quiet?: boolean }) => Promise<void>;
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

  const refresh = useCallback(async () => {
    try {
      setItems(await getSavedItems());
    } catch (error) {
      console.warn('Could not load saved items:', error);
    } finally {
      setLoaded(true);
    }
  }, []);

  const store = useCallback(
    async (book: Book, savedAs: SavedContentType, picks: SavedPick[]) => {
      try {
        const saved = await saveForLater({ book, content_type: savedAs, releases: picks });
        setItems((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
        onShowToast?.(`Saved "${saved.title}" for later`, 'success');
      } catch (error) {
        onShowToast?.(error instanceof Error ? error.message : 'Could not save', 'error');
      }
    },
    [onShowToast],
  );

  const remove = useCallback(
    async (item: SavedItem, options?: { quiet?: boolean }) => {
      try {
        await deleteSavedItem(item.id);
        setItems((current) => current.filter((existing) => existing.id !== item.id));
        if (!options?.quiet) onShowToast?.(`Removed "${item.title}" from Saved`, 'info');
      } catch (error) {
        onShowToast?.(error instanceof Error ? error.message : 'Could not remove', 'error');
      }
    },
    [onShowToast],
  );

  return useMemo<SavedItemsContextValue>(() => {
    const byKey = new Map(items.map((item) => [item.book_key, item]));
    return {
      items,
      contentType,
      loaded,
      savedFor: (book) => byKey.get(savedBookKey(book)),
      saveBook: (book, savedAs) => store(book, savedAs, []),
      savePicks: store,
      remove,
      refresh,
    };
  }, [contentType, items, loaded, refresh, remove, store]);
};

/** Reads the saved list when mounted: render it only for a signed-in session. */
export const SavedItemsLoader = ({ onLoad }: { onLoad: () => Promise<void> }) => {
  useMountEffect(() => {
    void onLoad();
  });
  return null;
};
