import { useEffect, useEffectEvent, useRef } from 'react';

import { takeQueuedHere } from '../../services/api';
import type { AppConfig, StatusData } from '../../types';
import { withBasePath } from '../../utils/basePath';

// How soon after queuing a download here its arrival may open its list.
const QUEUED_HERE_WINDOW_MS = 30_000;

const ACTIVE_BUCKETS = ['queued', 'resolving', 'locating', 'downloading'] as const;
const ALL_BUCKETS: readonly (keyof StatusData)[] = [
  ...ACTIVE_BUCKETS,
  'complete',
  'error',
  'cancelled',
];

/** Every download listed in `status`, whatever its state. */
const listedIds = (status: StatusData): Set<string> =>
  new Set(ALL_BUCKETS.flatMap((bucket) => Object.keys(status[bucket] ?? {})));

/**
 * Where a download that is new since `prev` is listed: Queued while it waits to start,
 * Downloads once under way. Null when none is new. A download that was already listed
 * (moving back to the queue to wait for a slot, say) isn't new.
 */
export const newDownloadPage = (
  prev: StatusData,
  next: StatusData,
): 'queued' | 'downloads' | null => {
  const known = listedIds(prev);
  const isNew = (bucket: (typeof ACTIVE_BUCKETS)[number]) =>
    Object.keys(next[bucket] ?? {}).some((id) => !known.has(id));
  if (isNew('queued')) return 'queued';
  return ACTIVE_BUCKETS.slice(1).some(isNew) ? 'downloads' : null;
};

interface UseStatusChangeNotificationsOptions {
  currentStatus: StatusData;
  config: AppConfig | null;
  showToast: (message: string, type: 'info' | 'success' | 'error') => void;
  // Opens the list a download just queued here is on (Activity > Queued or Downloads).
  showDownloadsPage: (page: 'queued' | 'downloads') => void;
  bookToReleaseMap: Record<string, string[]>;
  markBookCompleted: (bookId: string) => void;
}

export const useStatusChangeNotifications = ({
  currentStatus,
  config,
  showToast,
  showDownloadsPage,
  bookToReleaseMap,
  markBookCompleted,
}: UseStatusChangeNotificationsOptions): void => {
  const prevStatusRef = useRef<StatusData>({});
  const handleStatusTransition = useEffectEvent(
    (prevStatus: StatusData, nextStatus: StatusData) => {
      const autoDownloadContentTypes = Array.isArray(config?.download_to_browser_content_types)
        ? config.download_to_browser_content_types
        : [];
      const canAutoDownloadContentType = (downloadContentType?: string): boolean => {
        const contentTypeKey =
          (downloadContentType || '').trim().toLowerCase() === 'audiobook' ? 'audiobook' : 'book';
        return autoDownloadContentTypes.includes(contentTypeKey);
      };

      // Only a download that's new, not one moving back to the queue (to wait for a slot).
      const known = listedIds(prevStatus);
      const currQueued = nextStatus.queued || {};
      Object.keys(currQueued).forEach((bookId) => {
        if (!known.has(bookId)) {
          const book = currQueued[bookId];
          showToast(`${book.title || 'Book'} added to queue`, 'info');
        }
      });
      // The page moves only for a download queued from it, with the setting on: never
      // for ones queued in the background (Saved, retries, other users), which would
      // pull the reader away from whatever they were looking at.
      const page = newDownloadPage(prevStatus, nextStatus);
      if (
        page &&
        config?.auto_open_downloads_sidebar === true &&
        takeQueuedHere(QUEUED_HERE_WINDOW_MS)
      ) {
        showDownloadsPage(page);
      }

      const prevDownloading = prevStatus.downloading || {};
      const currDownloading = nextStatus.downloading || {};
      Object.keys(currDownloading).forEach((bookId) => {
        if (!prevDownloading[bookId]) {
          const book = currDownloading[bookId];
          showToast(`${book.title || 'Book'} started downloading`, 'info');
        }
      });

      const prevComplete = prevStatus.complete || {};
      const currComplete = nextStatus.complete || {};
      Object.keys(currComplete).forEach((bookId) => {
        if (!prevComplete[bookId]) {
          const book = currComplete[bookId];
          showToast(`${book.title || 'Book'} completed`, 'success');

          if (book.download_path && canAutoDownloadContentType(book.content_type)) {
            const link = document.createElement('a');
            link.href = withBasePath(`/api/localdownload?id=${encodeURIComponent(bookId)}`);
            link.download = '';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
          }

          Object.entries(bookToReleaseMap).forEach(([metadataBookId, releaseIds]) => {
            if (releaseIds.includes(bookId)) {
              markBookCompleted(metadataBookId);
            }
          });
        }
      });

      const prevError = prevStatus.error || {};
      const currError = nextStatus.error || {};
      Object.keys(currError).forEach((bookId) => {
        if (!prevError[bookId]) {
          const book = currError[bookId];
          const errorMsg = book.status_message || 'Download failed';
          showToast(`${book.title || 'Book'}: ${errorMsg}`, 'error');
        }
      });
    },
  );

  useEffect(() => {
    const prevStatus = prevStatusRef.current;
    if (!prevStatus || Object.keys(prevStatus).length === 0) {
      prevStatusRef.current = currentStatus;
      return;
    }

    handleStatusTransition(prevStatus, currentStatus);
    prevStatusRef.current = currentStatus;
  }, [currentStatus]);
};
