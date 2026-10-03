import { useMemo, useState } from 'react';

import { formatDateTime, timeAgo } from '../../utils/relativeTime';
import {
  HeaderCell,
  RowCover,
  TableFrame,
  cellClassName,
  headerRowClassName,
  parseSize,
  rowClassName,
  sortRows,
  tableClassName,
  type SortState,
} from '../shared/DataTable';
import type { ActivityCardAction } from './activityCardModel';
import { buildActivityCardModel } from './activityCardModel';
import {
  ActivityActionButton,
  ActivityLinkButtons,
  ActivityStatusBadges,
  actionKey,
} from './ActivityItemParts';
import type { ActivityItem } from './activityTypes';

type ActivitySortKey = 'title' | 'format' | 'size' | 'source' | 'status' | 'user' | 'time';

interface ActivityTableGroup {
  key: string;
  label?: string; // Shown as a collapsible row above its items when given
  items: ActivityItem[];
}

interface ActivityTableProps {
  groups: ActivityTableGroup[];
  isAdmin: boolean;
  showUser: boolean;
  timeLabel: string; // "Added" on Downloads, "Date" on History
  onDownloadCancel?: (bookId: string) => void;
  onDownloadRetry?: (bookId: string) => void;
  onDownloadDismiss?: (bookId: string, linkedRequestId?: number) => void;
  onRequestCancel?: (requestId: number) => void;
  onRequestDismiss?: (requestId: number) => void;
  onOpenDetails?: (item: ActivityItem) => void;
  onOpenInLibrary?: (item: ActivityItem) => void;
}

const sortValue = (item: ActivityItem, key: ActivitySortKey): string | number | undefined => {
  switch (key) {
    case 'title':
      return item.title;
    case 'format':
      return item.format;
    case 'size':
      return parseSize(item.sizeRaw) ?? undefined;
    case 'source':
      return item.sourceLabel;
    case 'status':
      return item.statusLabel;
    case 'user':
      return item.username || item.requestRecord?.username;
    case 'time':
      return item.timestamp || undefined;
    default:
      return undefined;
  }
};

const ActivityRow = ({
  item,
  isAdmin,
  showUser,
  handlers,
}: {
  item: ActivityItem;
  isAdmin: boolean;
  showUser: boolean;
  handlers: Omit<ActivityTableProps, 'groups' | 'isAdmin' | 'showUser' | 'timeLabel'>;
}) => {
  const model = useMemo(() => buildActivityCardModel(item, isAdmin), [item, isAdmin]);
  const { onOpenDetails, onOpenInLibrary } = handlers;

  const handlerFor = (action: ActivityCardAction): (() => void) | null => {
    switch (action.kind) {
      case 'download-remove':
      case 'download-stop':
        return handlers.onDownloadCancel ? () => handlers.onDownloadCancel?.(action.bookId) : null;
      case 'download-retry':
        return handlers.onDownloadRetry ? () => handlers.onDownloadRetry?.(action.bookId) : null;
      case 'download-dismiss':
        return handlers.onDownloadDismiss
          ? () => handlers.onDownloadDismiss?.(action.bookId, action.linkedRequestId)
          : null;
      case 'request-cancel':
        return handlers.onRequestCancel ? () => handlers.onRequestCancel?.(action.requestId) : null;
      case 'request-dismiss':
        return handlers.onRequestDismiss
          ? () => handlers.onRequestDismiss?.(action.requestId)
          : null;
      // Reviewing requests happens on the Requests page.
      case 'request-approve':
      case 'request-reject':
        return null;
      default:
        return null;
    }
  };

  const openDetails = onOpenDetails ? () => onOpenDetails(item) : undefined;
  const user = item.username || item.requestRecord?.username;

  return (
    <tr className={rowClassName}>
      <td className={`${cellClassName} w-12`}>
        <RowCover src={item.preview} title={item.title} onClick={openDetails} />
      </td>
      <td className={`${cellClassName} max-w-[22rem] min-w-[12rem]`}>
        <p className="truncate font-medium" title={item.title}>
          {openDetails ? (
            <button
              type="button"
              onClick={openDetails}
              className="text-left hover:underline focus-visible:underline"
            >
              {item.title}
            </button>
          ) : (
            item.title
          )}
        </p>
        {item.author && (
          <p className="truncate text-xs opacity-60" title={item.author}>
            {item.author}
          </p>
        )}
        {model.noteLine && (
          <p className="truncate text-xs italic opacity-60" title={model.noteLine}>
            {model.noteLine}
          </p>
        )}
      </td>
      <td className={`${cellClassName} hidden whitespace-nowrap md:table-cell`}>
        {item.format ?? '—'}
      </td>
      <td className={`${cellClassName} hidden whitespace-nowrap lg:table-cell`}>
        {item.sizeRaw ?? '—'}
      </td>
      <td className={`${cellClassName} hidden max-w-[10rem] truncate lg:table-cell`}>
        {item.sourceLabel ?? '—'}
      </td>
      <td className={`${cellClassName} w-64 max-w-[18rem] min-w-[10rem]`}>
        <ActivityStatusBadges badges={model.badges} className="" />
      </td>
      {showUser && (
        <td className={`${cellClassName} hidden whitespace-nowrap md:table-cell`}>{user ?? '—'}</td>
      )}
      <td
        className={`${cellClassName} text-xs whitespace-nowrap opacity-70`}
        title={formatDateTime(item.timestamp)}
      >
        {timeAgo(item.timestamp)}
      </td>
      <td className={`${cellClassName} w-0`}>
        <div className="flex items-center justify-end gap-1">
          <ActivityLinkButtons item={item} onOpenInLibrary={onOpenInLibrary} />
          {model.actions.map((action) => {
            const handler = handlerFor(action);
            return handler ? (
              <ActivityActionButton key={actionKey(action)} action={action} onClick={handler} />
            ) : null;
          })}
        </div>
      </td>
    </tr>
  );
};

/** Downloads and History as a Sonarr-style table, sortable by column. */
export const ActivityTable = ({
  groups,
  isAdmin,
  showUser,
  timeLabel,
  ...handlers
}: ActivityTableProps) => {
  const [sort, setSort] = useState<SortState<ActivitySortKey>>({ key: 'time', direction: 'desc' });
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const columnCount = showUser ? 9 : 8;

  const header = (label: string, key: ActivitySortKey, className = '', initial?: 'desc') => (
    <HeaderCell
      label={label}
      sortKey={key}
      sort={sort}
      onSort={setSort}
      initialDirection={initial}
      className={className}
    />
  );

  return (
    <TableFrame>
      <table className={tableClassName}>
        <thead>
          <tr className={headerRowClassName}>
            <th scope="col" className={cellClassName}>
              <span className="sr-only">Cover</span>
            </th>
            {header('Title', 'title')}
            {header('Format', 'format', 'hidden md:table-cell')}
            {header('Size', 'size', 'hidden lg:table-cell', 'desc')}
            {header('Source', 'source', 'hidden lg:table-cell')}
            {header('Status', 'status')}
            {showUser && header('User', 'user', 'hidden md:table-cell')}
            {header(timeLabel, 'time', '', 'desc')}
            <th scope="col" className={cellClassName}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        {groups.map((group) => {
          const isCollapsed = Boolean(group.label && collapsed[group.key]);
          return (
            <tbody key={group.key}>
              {group.label && (
                <tr className="border-b border-(--border-muted) bg-(--hover-surface)">
                  <td colSpan={columnCount} className="px-3 py-1.5" aria-label={group.label}>
                    <button
                      type="button"
                      onClick={() =>
                        setCollapsed((prev) => ({ ...prev, [group.key]: !prev[group.key] }))
                      }
                      aria-expanded={!isCollapsed}
                      className="flex w-full items-center gap-1.5 text-[11px] font-semibold tracking-wide uppercase opacity-70 hover:opacity-100"
                    >
                      <svg
                        className={`h-3 w-3 transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        strokeWidth="1.5"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="m19.5 8.25-7.5 7.5-7.5-7.5"
                        />
                      </svg>
                      <span>{group.label}</span>
                      <span className="ml-1 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-gray-500/10 px-1 leading-none dark:bg-gray-400/10">
                        {group.items.length}
                      </span>
                    </button>
                  </td>
                </tr>
              )}
              {!isCollapsed &&
                sortRows(group.items, sort, sortValue).map((item) => (
                  <ActivityRow
                    key={item.id}
                    item={item}
                    isAdmin={isAdmin}
                    showUser={showUser}
                    handlers={handlers}
                  />
                ))}
            </tbody>
          );
        })}
      </table>
    </TableFrame>
  );
};
