import { useState } from 'react';

import { useRowDrag } from '../../hooks/useRowDrag';
import {
  HeaderCell,
  RowCover,
  TableFrame,
  cellClassName,
  headerRowClassName,
  rowClassName,
  tableClassName,
} from '../shared/DataTable';
import { SourcePageLink } from './ActivityItemParts';
import type { ActivityItem } from './activityTypes';
import {
  DragHandle,
  QueueMoveButtons,
  QueuePosition,
  moveInList,
  moveToIndex,
} from './QueueControls';

/** Queued downloads in the order they start: their place in line, then when added. */
export const downloadQueueOrder = (items: readonly ActivityItem[]): ActivityItem[] =>
  items.toSorted(
    (a, b) => (a.queuePriority ?? 0) - (b.queuePriority ?? 0) || a.timestamp - b.timestamp,
  );

const sameOrder = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id, index) => id === b[index]);

interface DownloadQueueProps {
  // Queued downloads, in queue order (see `downloadQueueOrder`).
  items: ActivityItem[];
  onReorder?: (ids: string[]) => Promise<void>;
  onCancel?: (id: string) => void;
  onOpenDetails?: (item: ActivityItem) => void;
}

/**
 * Downloads waiting to start, numbered in the order they go: for a free download
 * worker, or for room on MyAnonamouse ("Waiting for an unsatisfied slot").
 */
export const DownloadQueue = ({
  items,
  onReorder,
  onCancel,
  onOpenDetails,
}: DownloadQueueProps) => {
  // A move shows at once; the queue's next update confirms it.
  const [pending, setPending] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const ids = items.map((item) => item.id);
  const sameItems =
    pending !== null && pending.length === ids.length && pending.every((id) => ids.includes(id));
  if (pending !== null && (!sameItems || sameOrder(pending, ids)) && !saving) {
    setPending(null);
  }
  const byId = new Map(items.map((item) => [item.id, item]));
  const shown =
    pending !== null && sameItems
      ? pending.flatMap((id) => {
          const item = byId.get(id);
          return item ? [item] : [];
        })
      : items;

  const reorder = async (next: string[]) => {
    if (!onReorder) return;
    setPending(next);
    setSaving(true);
    try {
      await onReorder(next);
    } catch {
      setPending(null);
    } finally {
      setSaving(false);
    }
  };
  const shownIds = shown.map((item) => item.id);
  const move = (index: number, delta: number) => reorder(moveInList(shownIds, index, delta));
  const { handleProps, rowProps, previewIndex, dragging } = useRowDrag({
    count: shown.length,
    disabled: saving || !onReorder,
    onDrop: (from, to) => void reorder(moveToIndex(shownIds, from, to)),
  });

  return (
    <TableFrame>
      <table className={tableClassName}>
        <thead>
          <tr className={headerRowClassName}>
            <HeaderCell label="#" className="w-8" />
            <th scope="col" className={cellClassName}>
              <span className="sr-only">Cover</span>
            </th>
            <HeaderCell label="Title" />
            <HeaderCell label="Status" />
            <HeaderCell label="Format" className="hidden md:table-cell" />
            <th scope="col" className={cellClassName}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {shown.map((item, index) => {
            const openDetails = onOpenDetails ? () => onOpenDetails(item) : undefined;
            const bookId = item.downloadBookId;
            return (
              <tr
                key={item.id}
                {...rowProps(index)}
                className={`${rowClassName} data-dragging:bg-(--bg-soft) data-dragging:shadow-lg`}
              >
                <td className={`${cellClassName} w-8`}>
                  <div className="flex items-center gap-1">
                    {onReorder && <DragHandle {...handleProps(index)} disabled={saving} />}
                    {onReorder && (
                      <QueueMoveButtons
                        title={item.title}
                        isFirst={index === 0}
                        isLast={index === shown.length - 1}
                        disabled={saving || dragging}
                        onMove={(delta) => void move(index, delta)}
                      />
                    )}
                    <QueuePosition position={previewIndex(index) + 1} />
                  </div>
                </td>
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
                </td>
                <td className={`${cellClassName} min-w-[10rem] text-xs opacity-70`}>
                  {item.statusDetail || 'Waiting to start'}
                </td>
                <td className={`${cellClassName} hidden whitespace-nowrap md:table-cell`}>
                  {item.format ?? '—'}
                </td>
                <td className={`${cellClassName} w-0`}>
                  <div className="flex items-center justify-end gap-1">
                    {item.infoUrl && <SourcePageLink url={item.infoUrl} />}
                    {onCancel && bookId && (
                      <button
                        type="button"
                        onClick={() => onCancel(bookId)}
                        className="rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap opacity-70 transition-colors hover:bg-(--hover-surface) hover:opacity-100"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableFrame>
  );
};
