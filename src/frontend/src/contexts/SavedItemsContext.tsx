import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

import { useMountEffect } from '../hooks/useMountEffect';
import {
  deleteSavedItem,
  getSavedItems,
  reorderSavedQueue,
  saveForLater,
  updateSavedItem,
} from '../services/api';
import type { Book, ContentType, Release } from '../types';
import {
  savedBookKey,
  savedPayloads,
  savedStage,
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
  /** Turn automatic downloading on or off. */
  setAutoGet: (item: SavedItem, changes: { auto_get: boolean }) => Promise<void>;
  /** When the automatic check next runs (ms since epoch), or null when none is due. */
  nextCheckAt: number | null;
  /** Put the queued items in this order (ids, first claim on room first). */
  reorder: (ids: number[]) => Promise<void>;
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
  autoGetAvailable,
  onShowToast,
}: {
  contentType: SavedContentType;
  // Picked releases are queued to download on their own when this is on.
  autoGetAvailable: boolean;
  onShowToast?: (message: string, type?: 'success' | 'error' | 'info') => void;
}): SavedItemsContextValue => {
  const [items, setItems] = useState<SavedItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [nextCheckAt, setNextCheckAt] = useState<number | null>(null);
  // Wanted items already sent to the queue, so a failed move isn't retried each refresh.
  const promoted = useRef(new Set<number>());
  // What the last refresh saw, to tell when an automatic download took an item.
  const lastSeen = useRef<SavedItem[] | null>(null);

  const refresh = useCallback(async () => {
    try {
      const { items: next, next_check_at } = await getSavedItems();
      setNextCheckAt(next_check_at === null ? null : next_check_at * 1000);
      const previous = lastSeen.current;
      if (previous) {
        const remaining = new Set(next.map((item) => item.id));
        previous
          .filter((item) => item.auto_get && !remaining.has(item.id))
          .forEach((item) => onShowToast?.(`Got "${item.title}" from Saved automatically`, 'info'));
      }
      lastSeen.current = next;
      setItems(next);
      if (autoGetAvailable) {
        // Picked releases belong in the queue: Wanted is for books still to pick for.
        // One whose last automatic download failed stays, so its error is seen first.
        next
          .filter(
            (item) =>
              savedStage(item) === 'later' &&
              item.releases.length > 0 &&
              !item.last_error &&
              !promoted.current.has(item.id),
          )
          .forEach((item) => {
            promoted.current.add(item.id);
            void updateSavedItem(item.id, {
              auto_get: true,
              payloads: savedPayloads(item.book, item.releases),
            })
              .then((updated) =>
                setItems((current) =>
                  current.map((existing) => (existing.id === updated.id ? updated : existing)),
                ),
              )
              .catch((error: unknown) => console.warn('Could not queue saved item:', error));
          });
      }
    } catch (error) {
      console.warn('Could not load saved items:', error);
    } finally {
      setLoaded(true);
    }
  }, [autoGetAvailable, onShowToast]);

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
          auto_get: picks.length > 0 && autoGetAvailable,
        });
        replaceItem(saved);
        onShowToast?.(
          savedStage(saved) === 'queued'
            ? `Queued "${saved.title}" for download when there's room`
            : `Saved "${saved.title}" for later`,
          'success',
        );
        return true;
      } catch (error) {
        onShowToast?.(error instanceof Error ? error.message : 'Could not save', 'error');
        return false;
      }
    },
    [autoGetAvailable, onShowToast, replaceItem],
  );

  const remove = useCallback(
    async (item: SavedItem, options?: { quiet?: boolean }) => {
      try {
        await deleteSavedItem(item.id);
        const drop = (current: SavedItem[]) =>
          current.filter((existing) => existing.id !== item.id);
        lastSeen.current = lastSeen.current ? drop(lastSeen.current) : null;
        setItems(drop);
        if (!options?.quiet) {
          const from = savedStage(item) === 'queued' ? 'the download queue' : 'Saved for later';
          onShowToast?.(`Removed "${item.title}" from ${from}`, 'info');
        }
      } catch (error) {
        onShowToast?.(error instanceof Error ? error.message : 'Could not remove', 'error');
      }
    },
    [onShowToast],
  );

  const setAutoGet = useCallback(
    async (item: SavedItem, changes: { auto_get: boolean }) => {
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

  const reorder = useCallback(
    async (ids: number[]) => {
      // Show the new order at once; the server's answer replaces it.
      const positions = new Map(ids.map((id, index) => [id, index + 1]));
      setItems((current) =>
        current.map((item) =>
          positions.has(item.id)
            ? { ...item, queue_position: positions.get(item.id) ?? null }
            : item,
        ),
      );
      try {
        const next = await reorderSavedQueue(ids);
        lastSeen.current = next;
        setItems(next);
      } catch (error) {
        onShowToast?.(error instanceof Error ? error.message : 'Could not reorder', 'error');
        await refresh();
      }
    },
    [onShowToast, refresh],
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
      nextCheckAt,
      reorder,
      refresh,
    };
  }, [contentType, items, loaded, nextCheckAt, refresh, remove, reorder, setAutoGet, store]);
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
