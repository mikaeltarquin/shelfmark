import { useMemo, useState, type ReactNode } from 'react';

import type { RequestRecord, StatusData } from '../../types';
import { Dropdown } from '../Dropdown';
import { ActivityCard } from './ActivityCard';
import type { DownloadStatusKey } from './activityMappers';
import { downloadToActivityItem } from './activityMappers';
import { ActivityTable } from './ActivityTable';
import type { ActivityItem } from './activityTypes';
import { DownloadQueue, downloadQueueOrder } from './DownloadQueue';

interface ActivityPageProps {
  tab: ActivityTabKey;
  status: StatusData;
  isAdmin: boolean;
  /** Opens an item's book details. */
  onOpenDetails?: (item: ActivityItem) => void;
  /** Opens a finished download in its library app. */
  onOpenInLibrary?: (item: ActivityItem) => void;
  onCancel: (id: string) => void;
  onRetry?: (id: string) => void;
  onDownloadDismiss?: (bookId: string, linkedRequestId?: number) => void;
  requestItems: ActivityItem[];
  dismissedItemKeys?: string[];
  historyItems?: ActivityItem[];
  historyLoaded?: boolean;
  historyHasMore?: boolean;
  historyLoading?: boolean;
  onHistoryLoadMore?: () => void;
  showRequestsTab: boolean;
  isRequestsLoading?: boolean;
  onRequestCancel?: (requestId: number) => Promise<void> | void;
  onRequestApprove?: (
    requestId: number,
    record: RequestRecord,
    options?: {
      browseOnly?: boolean;
      manualApproval?: boolean;
    },
  ) => Promise<void> | void;
  onRequestReject?: (requestId: number, adminNote?: string) => Promise<void> | void;
  onRequestDismiss?: (requestId: number) => void;
  // The saved items queued to download on their own, for the Queued page.
  queuedPanel?: ReactNode;
  // The Queued page's totals, over everything waiting (see QueueSummary).
  queueSummary?: ReactNode;
  /** Puts the queued downloads in this order (download ids, first to start first). */
  onReorderDownloads?: (ids: string[]) => Promise<void>;
}

export interface ActivityDismissTarget {
  itemType: 'download' | 'request';
  itemKey: string;
}

const DOWNLOAD_STATUS_KEYS: DownloadStatusKey[] = [
  'downloading',
  'locating',
  'resolving',
  'queued',
  'error',
  'complete',
  'cancelled',
];

type ActivityCategoryKey = 'needs_review' | 'in_progress' | 'complete' | 'failed';

export type ActivityTabKey = 'queued' | 'downloads' | 'requests' | 'history';

export const ACTIVITY_TAB_LABELS: Record<ActivityTabKey, string> = {
  queued: 'Queued',
  downloads: 'Downloads',
  requests: 'Requests',
  history: 'History',
};
const ALL_USERS_FILTER = '__all_users__';

const getCategoryLabel = (key: ActivityCategoryKey, isAdmin: boolean): string => {
  if (key === 'needs_review') {
    return isAdmin ? 'Needs Review' : 'Waiting';
  }
  if (key === 'in_progress') {
    return 'In Progress';
  }
  if (key === 'complete') {
    return 'Complete';
  }
  return 'Failed';
};

const getVisibleCategoryOrder = (tab: ActivityTabKey): ActivityCategoryKey[] => {
  if (tab === 'downloads') {
    return ['in_progress', 'complete', 'failed'];
  }
  if (tab === 'requests') {
    return ['needs_review', 'in_progress', 'complete', 'failed'];
  }
  return [];
};

const getActivityCategory = (item: ActivityItem): ActivityCategoryKey => {
  if (item.kind === 'download') {
    if (
      item.visualStatus === 'queued' ||
      item.visualStatus === 'resolving' ||
      item.visualStatus === 'locating' ||
      item.visualStatus === 'downloading'
    ) {
      return 'in_progress';
    }
    if (item.visualStatus === 'complete') {
      return 'complete';
    }
    return 'failed';
  }

  const requestStatus = item.requestRecord?.status;
  if (requestStatus === 'pending' || item.visualStatus === 'pending') {
    return 'needs_review';
  }

  if (requestStatus === 'rejected' || requestStatus === 'cancelled') {
    return 'failed';
  }

  const deliveryState = item.requestRecord?.delivery_state;
  if (requestStatus === 'fulfilled' || item.visualStatus === 'fulfilled') {
    if (
      deliveryState === 'queued' ||
      deliveryState === 'resolving' ||
      deliveryState === 'locating' ||
      deliveryState === 'downloading'
    ) {
      return 'in_progress';
    }
    if (deliveryState === 'error' || deliveryState === 'cancelled') {
      return 'failed';
    }
    // Legacy fulfilled requests often have unknown/none delivery state because the
    // pre-refactor queue state was ephemeral. Treat as completed approval, not in-progress.
    return 'complete';
  }

  if (deliveryState === 'complete') {
    return 'complete';
  }
  if (deliveryState === 'error' || deliveryState === 'cancelled') {
    return 'failed';
  }
  return 'in_progress';
};

const getLinkedDownloadIdFromRequestItem = (item: ActivityItem): string | null => {
  if (item.kind !== 'request' || item.visualStatus !== 'fulfilled') {
    return null;
  }

  const releaseData = item.requestRecord?.release_data;
  if (!releaseData || typeof releaseData !== 'object') {
    return null;
  }

  const sourceId = releaseData.source_id;
  if (typeof sourceId !== 'string') {
    return null;
  }

  const trimmed = sourceId.trim();
  return trimmed ? trimmed : null;
};

const mergeRequestWithDownload = (
  requestItem: ActivityItem,
  downloadItem: ActivityItem,
): ActivityItem => {
  return {
    ...downloadItem,
    id: requestItem.id,
    kind: 'download',
    title: downloadItem.title || requestItem.title,
    author: downloadItem.author || requestItem.author,
    preview: downloadItem.preview || requestItem.preview,
    metaLine: downloadItem.metaLine,
    timestamp: Math.max(downloadItem.timestamp, requestItem.timestamp),
    username: requestItem.username || downloadItem.username,
    adminNote: requestItem.adminNote,
    requestId: requestItem.requestId,
    requestLevel: requestItem.requestLevel,
    requestNote: requestItem.requestNote,
    requestRecord: requestItem.requestRecord,
  };
};

const getItemUsername = (item: ActivityItem): string | null => {
  const candidate = item.username || item.requestRecord?.username;
  if (typeof candidate !== 'string') {
    return null;
  }
  const normalized = candidate.trim();
  return normalized || null;
};

// Downloads waiting to start are the front of the queue: on Queued, not Downloads.
const isQueuedDownload = (item: ActivityItem) =>
  item.kind === 'download' && item.visualStatus === 'queued';

const EMPTY_KEYS: string[] = [];
const EMPTY_ITEMS: ActivityItem[] = [];

/** One Activity page: Queued, Downloads, Requests or History. */
export const ActivityPage = ({
  tab,
  status,
  isAdmin,
  onOpenDetails,
  onOpenInLibrary,
  onCancel,
  onRetry,
  onDownloadDismiss,
  requestItems,
  dismissedItemKeys = EMPTY_KEYS,
  historyItems = EMPTY_ITEMS,
  historyLoaded = false,
  historyHasMore = false,
  historyLoading = false,
  onHistoryLoadMore,
  showRequestsTab,
  isRequestsLoading = false,
  onRequestCancel,
  onRequestApprove,
  onRequestReject,
  onRequestDismiss,
  queuedPanel,
  queueSummary,
  onReorderDownloads,
}: ActivityPageProps) => {
  const [selectedUser, setSelectedUser] = useState(ALL_USERS_FILTER);
  const [rejectingRequest, setRejectingRequest] = useState<{ requestId: number } | null>(null);
  const [reviewingRequestId, setReviewingRequestId] = useState<number | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const dismissedKeySet = useMemo(() => new Set(dismissedItemKeys), [dismissedItemKeys]);
  // A tab the viewer can't see (Requests with requests off) shows Downloads instead.
  const effectiveActiveTab: ActivityTabKey =
    (tab === 'requests' && !showRequestsTab) || (tab === 'queued' && !queuedPanel)
      ? 'downloads'
      : tab;

  const downloadItems = useMemo(() => {
    const items: ActivityItem[] = [];

    DOWNLOAD_STATUS_KEYS.forEach((statusKey) => {
      const bucket = status[statusKey];
      if (!bucket) {
        return;
      }
      Object.values(bucket).forEach((book) => {
        const itemKey = `download:${book.id}`;
        const isTerminalStatus =
          statusKey === 'complete' || statusKey === 'error' || statusKey === 'cancelled';
        if (isTerminalStatus && dismissedKeySet.has(itemKey)) {
          return;
        }
        items.push(downloadToActivityItem(book, statusKey));
      });
    });

    return items.toSorted((left, right) => right.timestamp - left.timestamp);
  }, [dismissedKeySet, status]);

  const visibleRequestItems = useMemo(
    () =>
      requestItems.filter((item) => {
        if (!item.requestId) {
          return true;
        }
        return !dismissedKeySet.has(`request:${item.requestId}`);
      }),
    [dismissedKeySet, requestItems],
  );

  const { mergedRequestItems, mergedDownloadItems } = useMemo(() => {
    const downloadsById = new Map<string, ActivityItem>();
    downloadItems.forEach((item) => {
      if (item.downloadBookId) {
        downloadsById.set(item.downloadBookId, item);
      }
    });

    const mergedByDownloadId = new Map<string, ActivityItem>();
    const reopenedRequestIds = new Set<number>();

    visibleRequestItems.forEach((item) => {
      if (item.kind !== 'request' || typeof item.requestId !== 'number') {
        return;
      }
      const requestRecord = item.requestRecord;
      const failureReason = requestRecord?.last_failure_reason;
      if (
        requestRecord?.status === 'pending' &&
        typeof failureReason === 'string' &&
        failureReason.trim().length > 0
      ) {
        reopenedRequestIds.add(item.requestId);
      }
    });

    const nextRequestItems = visibleRequestItems.map((requestItem) => {
      const linkedDownloadId = getLinkedDownloadIdFromRequestItem(requestItem);
      if (!linkedDownloadId) {
        return requestItem;
      }

      const matchedDownload = downloadsById.get(linkedDownloadId);
      if (!matchedDownload) {
        return requestItem;
      }

      const merged = mergeRequestWithDownload(requestItem, matchedDownload);
      if (!mergedByDownloadId.has(linkedDownloadId)) {
        mergedByDownloadId.set(linkedDownloadId, merged);
      }
      return merged;
    });

    const nextDownloadItems = downloadItems
      .map((downloadItem) => {
        const downloadId = downloadItem.downloadBookId;
        if (!downloadId) {
          return downloadItem;
        }
        return mergedByDownloadId.get(downloadId) || downloadItem;
      })
      .filter((downloadItem) => {
        if (
          typeof downloadItem.requestId === 'number' &&
          reopenedRequestIds.has(downloadItem.requestId) &&
          (downloadItem.visualStatus === 'error' || downloadItem.visualStatus === 'cancelled')
        ) {
          return false;
        }
        return true;
      });

    return {
      mergedRequestItems: nextRequestItems,
      mergedDownloadItems: nextDownloadItems,
    };
  }, [downloadItems, visibleRequestItems]);

  const queuedDownloadItems = useMemo(
    () => downloadQueueOrder(mergedDownloadItems.filter(isQueuedDownload)),
    [mergedDownloadItems],
  );

  let baseVisibleItems = mergedDownloadItems.filter((item) => !isQueuedDownload(item));
  if (effectiveActiveTab === 'requests') {
    baseVisibleItems = mergedRequestItems.filter((item) => {
      const requestStatus = item.requestRecord?.status;
      if (
        requestStatus === 'pending' ||
        requestStatus === 'rejected' ||
        requestStatus === 'cancelled'
      ) {
        return true;
      }
      return requestStatus === 'fulfilled' && item.kind === 'request';
    });
  } else if (effectiveActiveTab === 'history') {
    baseVisibleItems = historyItems;
  }
  const isHistoryInitialLoad = effectiveActiveTab === 'history' && !historyLoaded;
  let emptyStateMessage = 'No activity';
  if (effectiveActiveTab === 'requests') {
    emptyStateMessage = isRequestsLoading ? 'Loading requests...' : 'No requests';
  } else if (effectiveActiveTab === 'history') {
    emptyStateMessage =
      historyLoading || isHistoryInitialLoad ? 'Loading history...' : 'No history';
  } else if (effectiveActiveTab === 'downloads') {
    emptyStateMessage = 'No downloads';
  }

  const availableUsers = useMemo(() => {
    const userMap = new Map<string, string>();
    baseVisibleItems.forEach((item) => {
      const username = getItemUsername(item);
      if (!username) {
        return;
      }
      const lookupKey = username.toLowerCase();
      if (!userMap.has(lookupKey)) {
        userMap.set(lookupKey, username);
      }
    });

    return Array.from(userMap.values()).toSorted((left, right) => left.localeCompare(right));
  }, [baseVisibleItems]);

  const effectiveSelectedUser =
    selectedUser === ALL_USERS_FILTER || availableUsers.includes(selectedUser)
      ? selectedUser
      : ALL_USERS_FILTER;
  if (effectiveSelectedUser !== selectedUser) {
    setSelectedUser(ALL_USERS_FILTER);
  }

  const visibleItems = useMemo(() => {
    if (effectiveSelectedUser === ALL_USERS_FILTER) {
      return baseVisibleItems;
    }
    return baseVisibleItems.filter((item) => getItemUsername(item) === effectiveSelectedUser);
  }, [baseVisibleItems, effectiveSelectedUser]);

  const visiblePendingRequestIds = useMemo(() => {
    const ids = new Set<number>();
    visibleItems.forEach((item) => {
      if (
        item.kind === 'request' &&
        item.requestRecord?.status === 'pending' &&
        typeof item.requestId === 'number'
      ) {
        ids.add(item.requestId);
      }
    });
    return ids;
  }, [visibleItems]);

  const effectiveReviewingRequestId =
    reviewingRequestId !== null && visiblePendingRequestIds.has(reviewingRequestId)
      ? reviewingRequestId
      : null;
  const effectiveRejectingRequest =
    rejectingRequest !== null && visiblePendingRequestIds.has(rejectingRequest.requestId)
      ? rejectingRequest
      : null;
  if (effectiveReviewingRequestId !== reviewingRequestId) {
    setReviewingRequestId(null);
  }
  if (effectiveRejectingRequest === null && rejectingRequest !== null) {
    setRejectingRequest(null);
  }

  const hasUserFilter = isAdmin && availableUsers.length > 1;

  const visibleCategoryOrder = useMemo(
    () => getVisibleCategoryOrder(effectiveActiveTab),
    [effectiveActiveTab],
  );

  const groupedVisibleItems = useMemo(() => {
    if (effectiveActiveTab === 'history') {
      return [];
    }

    const grouped = new Map<ActivityCategoryKey, ActivityItem[]>();
    visibleCategoryOrder.forEach((key) => grouped.set(key, []));

    visibleItems.forEach((item) => {
      const category = getActivityCategory(item);
      if (!grouped.has(category)) {
        grouped.set(category, []);
      }
      const bucket = grouped.get(category);
      if (bucket) {
        bucket.push(item);
      }
    });

    return visibleCategoryOrder
      .map((key) => ({
        key,
        label: getCategoryLabel(key, isAdmin),
        items: (grouped.get(key) ?? []).toSorted((left, right) => right.timestamp - left.timestamp),
      }))
      .filter((group) => group.items.length > 0);
  }, [effectiveActiveTab, isAdmin, visibleItems, visibleCategoryOrder]);

  return (
    <section className="space-y-4" aria-labelledby="activity-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium tracking-wide uppercase opacity-60">Activity</p>
          <h1 id="activity-title" className="text-2xl font-semibold">
            {ACTIVITY_TAB_LABELS[effectiveActiveTab]}
          </h1>
        </div>
        <div className="flex items-center gap-1">
          {hasUserFilter && (
            <Dropdown
              align="right"
              widthClassName="w-auto"
              panelClassName="min-w-44"
              renderTrigger={({ isOpen: isDropdownOpen, toggle }) => (
                <button
                  type="button"
                  onClick={toggle}
                  className={`hover-action inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
                    isDropdownOpen || effectiveSelectedUser !== ALL_USERS_FILTER
                      ? 'text-sky-600 dark:text-sky-400'
                      : ''
                  }`}
                  title={
                    effectiveSelectedUser === ALL_USERS_FILTER
                      ? 'Filter by user'
                      : `Filtered: ${effectiveSelectedUser}`
                  }
                  aria-label={
                    effectiveSelectedUser === ALL_USERS_FILTER
                      ? 'Filter by user'
                      : `Filtered by user ${effectiveSelectedUser}`
                  }
                  aria-expanded={isDropdownOpen}
                >
                  <svg
                    className="h-5 w-5"
                    viewBox="0 0 24 24"
                    fill="none"
                    strokeWidth="1.75"
                    stroke="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 0 1-.659 1.591l-5.432 5.432a2.25 2.25 0 0 0-.659 1.591v2.927a2.25 2.25 0 0 1-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 0 0-.659-1.591L3.659 7.409A2.25 2.25 0 0 1 3 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0 1 12 3Z"
                    />
                  </svg>
                </button>
              )}
            >
              {({ close }) => (
                <div role="listbox">
                  {[ALL_USERS_FILTER, ...availableUsers].map((value) => {
                    const isSelected = effectiveSelectedUser === value;
                    const label = value === ALL_USERS_FILTER ? 'All users' : value;
                    return (
                      <button
                        type="button"
                        key={value}
                        className={`hover-surface flex w-full items-center justify-between px-3 py-2 text-left text-sm ${
                          isSelected ? 'text-sky-600 dark:text-sky-400' : ''
                        }`}
                        onClick={() => {
                          setSelectedUser(value);
                          close();
                        }}
                      >
                        <span>{label}</span>
                        {isSelected && (
                          <svg
                            className="h-4 w-4"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="m5 13 4 4L19 7" />
                          </svg>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </Dropdown>
          )}
        </div>
      </div>

      <div className={effectiveActiveTab === 'requests' ? 'max-w-4xl' : undefined}>
        {(() => {
          if (effectiveActiveTab === 'queued') {
            if (queuedDownloadItems.length === 0) {
              return (
                <div className="space-y-4">
                  {queueSummary}
                  {queuedPanel}
                </div>
              );
            }
            return (
              <div className="space-y-6">
                {queueSummary}
                <section aria-labelledby="queue-up-next" className="space-y-2">
                  <h2
                    id="queue-up-next"
                    className="text-[11px] font-semibold tracking-wide uppercase opacity-70"
                  >
                    Up next
                  </h2>
                  <p className="text-xs opacity-60">
                    These start in this order as soon as there&apos;s room: a free download slot, or
                    an unsatisfied slot on MyAnonamouse.
                  </p>
                  <DownloadQueue
                    items={queuedDownloadItems}
                    onReorder={onReorderDownloads}
                    onCancel={onCancel}
                    onOpenDetails={onOpenDetails}
                  />
                </section>
                {queuedPanel && (
                  <section aria-labelledby="queue-waiting" className="space-y-2">
                    <h2
                      id="queue-waiting"
                      className="text-[11px] font-semibold tracking-wide uppercase opacity-70"
                    >
                      Waiting for room
                    </h2>
                    {queuedPanel}
                  </section>
                )}
              </div>
            );
          }
          if (visibleItems.length === 0) {
            return <p className="mt-8 text-center text-sm opacity-70">{emptyStateMessage}</p>;
          }

          if (effectiveActiveTab === 'downloads' || effectiveActiveTab === 'history') {
            const isHistory = effectiveActiveTab === 'history';
            return (
              <>
                <ActivityTable
                  groups={
                    isHistory
                      ? [{ key: 'history', items: visibleItems }]
                      : groupedVisibleItems.map((group) => ({
                          key: group.key,
                          label: group.label,
                          items: group.items,
                        }))
                  }
                  isAdmin={isAdmin}
                  showUser={isAdmin && availableUsers.length > 0}
                  timeLabel={isHistory ? 'Date' : 'Added'}
                  onDownloadCancel={isHistory ? undefined : onCancel}
                  onDownloadRetry={onRetry}
                  onDownloadDismiss={isHistory ? undefined : onDownloadDismiss}
                  onOpenDetails={onOpenDetails}
                  onOpenInLibrary={onOpenInLibrary}
                />
                {isHistory && historyHasMore && (
                  <div className="pt-3 text-center">
                    <button
                      type="button"
                      onClick={() => onHistoryLoadMore?.()}
                      disabled={historyLoading}
                      className="text-sm text-sky-600 hover:underline disabled:opacity-60 dark:text-sky-400"
                    >
                      {historyLoading ? 'Loading...' : 'Load more'}
                    </button>
                  </div>
                )}
              </>
            );
          }

          return groupedVisibleItems.map((group) => (
            <section key={group.key} className="mb-4 last:mb-0">
              <button
                type="button"
                onClick={() =>
                  setCollapsedGroups((prev) => ({ ...prev, [group.key]: !prev[group.key] }))
                }
                className="mb-2 flex w-full cursor-pointer items-center justify-between text-[11px] tracking-wide uppercase opacity-70 transition-opacity hover:opacity-100"
              >
                <div className="flex items-center gap-1.5">
                  <svg
                    className={`h-3 w-3 transition-transform ${collapsedGroups[group.key] ? '-rotate-90' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    strokeWidth="1.5"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="m19.5 8.25-7.5 7.5-7.5-7.5"
                    />
                  </svg>
                  <span>{group.label}</span>
                </div>
                <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-gray-500/10 px-1 leading-none dark:bg-gray-400/10">
                  {group.items.length}
                </span>
              </button>
              {!collapsedGroups[group.key] && (
                <div className="divide-y divide-[color-mix(in_srgb,var(--border-muted)_60%,transparent)]">
                  {group.items.map((item) => {
                    const showRequestActions = effectiveActiveTab === 'requests';
                    const requestId = item.requestId;
                    const shouldShowRejectDialog =
                      showRequestActions &&
                      effectiveRejectingRequest !== null &&
                      requestId === effectiveRejectingRequest.requestId;
                    const requestRecord = item.requestRecord;
                    const canShowRequestReview =
                      showRequestActions &&
                      isAdmin &&
                      item.kind === 'request' &&
                      typeof requestId === 'number' &&
                      requestRecord?.status === 'pending';
                    const shouldShowRequestReview =
                      canShowRequestReview &&
                      effectiveReviewingRequestId !== null &&
                      requestId === effectiveReviewingRequestId &&
                      requestRecord !== undefined;

                    return (
                      <div key={item.id}>
                        <ActivityCard
                          item={item}
                          isAdmin={isAdmin}
                          onDownloadCancel={onCancel}
                          onDownloadRetry={onRetry}
                          onDownloadDismiss={onDownloadDismiss}
                          onOpenDetails={onOpenDetails}
                          onOpenInLibrary={onOpenInLibrary}
                          onRequestCancel={
                            onRequestCancel
                              ? (nextRequestId) => {
                                  void onRequestCancel(nextRequestId);
                                }
                              : undefined
                          }
                          onRequestApprove={onRequestApprove}
                          onRequestDismiss={onRequestDismiss}
                          onRequestReject={
                            showRequestActions && onRequestReject
                              ? (nextRequestId) => {
                                  setReviewingRequestId(null);
                                  setRejectingRequest({ requestId: nextRequestId });
                                }
                              : undefined
                          }
                          showRequestDetailsToggle={canShowRequestReview}
                          isRequestDetailsOpen={shouldShowRequestReview}
                          isSelected={shouldShowRequestReview || shouldShowRejectDialog}
                          onRequestReviewApprove={
                            onRequestApprove
                              ? async (approvedRequestId, record, options) => {
                                  await onRequestApprove(approvedRequestId, record, options);
                                  setReviewingRequestId(null);
                                }
                              : undefined
                          }
                          isRequestRejectOpen={shouldShowRejectDialog}
                          onRequestRejectClose={() => setRejectingRequest(null)}
                          onRequestRejectConfirm={
                            onRequestReject
                              ? async (rejectedRequestId, adminNote) => {
                                  await onRequestReject(rejectedRequestId, adminNote);
                                  setRejectingRequest(null);
                                }
                              : undefined
                          }
                          onRequestDetailsToggle={
                            canShowRequestReview && typeof requestId === 'number'
                              ? () => {
                                  if (shouldShowRejectDialog) {
                                    setRejectingRequest(null);
                                    return;
                                  }
                                  setRejectingRequest(null);
                                  setReviewingRequestId((current) =>
                                    current === requestId ? null : requestId,
                                  );
                                }
                              : undefined
                          }
                          onRequestDetailsOpen={
                            canShowRequestReview && typeof requestId === 'number'
                              ? () => {
                                  setRejectingRequest(null);
                                  setReviewingRequestId(requestId);
                                }
                              : undefined
                          }
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          ));
        })()}
      </div>
    </section>
  );
};
