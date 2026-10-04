import { useState } from 'react';

import { useDependencyEffect, useMountEffect } from '../../hooks/useMountEffect';
import { useRowDrag } from '../../hooks/useRowDrag';
import { withBasePath } from '../../utils/basePath';
import { formatCountdown } from '../../utils/mamAccount';
import { formatDateTime, isoTimeAgo } from '../../utils/relativeTime';
import {
  SAVED_STAGE_LABELS,
  describeSavedPick,
  queueOrder,
  savedPickLines,
  savedStage,
  waitingFor,
  type SavedItem,
  type SavedStage,
} from '../../utils/savedItems';
import {
  HeaderCell,
  RowCover,
  TableFrame,
  cellClassName,
  headerRowClassName,
  rowClassName,
  sortRows,
  tableClassName,
  type SortState,
} from '../shared/DataTable';
import {
  DragHandle,
  QueueMoveButtons,
  QueuePosition,
  moveInList,
  moveToIndex,
  type DragHandleProps,
} from './QueueControls';

interface SavedPanelProps {
  items: SavedItem[];
  loaded: boolean;
  // Downloads the picked releases now.
  onGet: (item: SavedItem) => Promise<void>;
  onRemove: (item: SavedItem) => Promise<void>;
  // Re-reads the list, for what the background checks found since.
  onRefresh: () => Promise<void>;
  // Opens the book's details, as clicking a book does on the other pages.
  onOpenDetails?: (item: SavedItem) => void;
  // Wanted: opens the release picker; picks saved there move the book to the queue.
  onChooseReleases?: (item: SavedItem) => Promise<void>;
  // Queued only: put the items in this order (ids, first claim on room first).
  onReorder?: (ids: number[]) => Promise<void>;
  // Queued only: how many downloads are ahead of these, to number on from.
  positionOffset?: number;
  // Queued only: when the automatic check next runs (ms since epoch), or null.
  nextCheckAt?: number | null;
}

// A queued row's place in line and its move buttons.
interface RowQueue {
  position: number;
  isFirst: boolean;
  isLast: boolean;
  disabled: boolean;
  onMove?: (delta: number) => void;
  handle?: DragHandleProps; // Present when the row can be dragged
  row?: ReturnType<ReturnType<typeof useRowDrag>['rowProps']>;
}

type RowProps = Omit<
  SavedPanelProps,
  'items' | 'loaded' | 'onRefresh' | 'onReorder' | 'positionOffset'
> & { item: SavedItem; queue?: RowQueue };

const coverUrl = (preview: string | undefined): string | null => {
  if (!preview) return null;
  return preview.startsWith('/') ? withBasePath(preview) : preview;
};

type SavedSortKey = 'title' | 'picks' | 'saved';

const savedSortValue = (item: SavedItem, key: SavedSortKey): string | number | undefined => {
  if (key === 'title') return item.title;
  if (key === 'picks') return describeSavedPick(item);
  const saved = Date.parse(item.created_at);
  return Number.isNaN(saved) ? undefined : saved;
};

const smallButton =
  'rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors disabled:opacity-40';
const greenButton = `${smallButton} bg-emerald-600 text-white hover:bg-emerald-700`;
const quietButton = `${smallButton} opacity-70 hover:bg-(--hover-surface) hover:opacity-100`;

/** "in 4:32" to the next automatic check, ticking; "Checking now" once it's due. */
const NextCheck = ({ at }: { at: number }) => {
  const [now, setNow] = useState(() => Date.now());
  useDependencyEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [at]);
  const seconds = (at - now) / 1000;
  return (
    <span className="tabular-nums" title={formatDateTime(at)}>
      {seconds > 0 ? `in ${formatCountdown(seconds)}` : 'Checking now'}
    </span>
  );
};

const ReleaseLines = ({ item }: { item: SavedItem }) => {
  const lines = savedPickLines(item);
  const full = savedPickLines(item, { full: true });
  return (
    <ul className="space-y-0.5 text-xs" title={full.join('\n')}>
      {lines.map((line, index) => (
        // Lines can repeat ("Audiobook" twice): the index tells them apart.
        // eslint-disable-next-line react/no-array-index-key
        <li key={index} className="whitespace-nowrap">
          {line}
        </li>
      ))}
    </ul>
  );
};

const SavedRow = ({
  item,
  onGet,
  onRemove,
  onOpenDetails,
  onChooseReleases,
  nextCheckAt,
  queue,
}: RowProps) => {
  const [busy, setBusy] = useState<'get' | 'choose' | 'remove' | null>(null);
  const run = async (action: 'get' | 'choose' | 'remove') => {
    setBusy(action);
    try {
      if (action === 'get') await onGet(item);
      else if (action === 'choose') await onChooseReleases?.(item);
      else await onRemove(item);
    } finally {
      setBusy(null);
    }
  };
  const saved = Date.parse(item.created_at);
  const openDetails = onOpenDetails ? () => onOpenDetails(item) : undefined;
  const hasPicks = item.kind !== 'book' && item.releases.length > 0;
  const reason = waitingFor(item);

  return (
    <tr
      {...queue?.row}
      className={`${rowClassName} data-dragging:bg-(--bg-soft) data-dragging:shadow-lg`}
    >
      {queue && (
        <td className={`${cellClassName} w-8`}>
          <div className="flex items-center gap-1">
            {queue.handle && <DragHandle {...queue.handle} disabled={queue.disabled} />}
            {queue.onMove && (
              <QueueMoveButtons
                title={item.title}
                isFirst={queue.isFirst}
                isLast={queue.isLast}
                disabled={queue.disabled}
                onMove={queue.onMove}
              />
            )}
            <QueuePosition position={queue.position} />
          </div>
        </td>
      )}
      <td className={`${cellClassName} w-12`}>
        <RowCover src={coverUrl(item.book.preview)} title={item.title} onClick={openDetails} />
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
      <td className={`${cellClassName} min-w-[11rem]`}>
        {hasPicks && <ReleaseLines item={item} />}
        {item.last_error && (
          <p className="mt-0.5 text-xs text-red-600 dark:text-red-400">{item.last_error}</p>
        )}
        {!queue && (
          <div className={`flex items-center gap-1 ${hasPicks ? 'mt-1.5' : ''}`}>
            <button
              type="button"
              onClick={() => void run('choose')}
              disabled={busy !== null || !onChooseReleases}
              className={hasPicks ? quietButton : greenButton}
            >
              {hasPicks ? 'Choose again' : 'Choose releases'}
            </button>
            {hasPicks && (
              <button
                type="button"
                onClick={() => void run('get')}
                disabled={busy !== null}
                className={greenButton}
              >
                {busy === 'get' ? 'Getting…' : '+ Get'}
              </button>
            )}
          </div>
        )}
      </td>
      {queue ? (
        <>
          <td className={`${cellClassName} min-w-[10rem] text-xs`} title={item.auto_status ?? ''}>
            {reason ?? <span className="opacity-50">First check pending</span>}
          </td>
          <td
            className={`${cellClassName} text-xs whitespace-nowrap opacity-70`}
            title={item.auto_checked_at ? formatDateTime(Date.parse(item.auto_checked_at)) : ''}
          >
            {item.auto_checked_at ? isoTimeAgo(item.auto_checked_at) : 'Not yet'}
          </td>
          <td className={`${cellClassName} text-xs whitespace-nowrap opacity-70`}>
            {typeof nextCheckAt === 'number' ? <NextCheck at={nextCheckAt} /> : '—'}
          </td>
        </>
      ) : (
        <td
          className={`${cellClassName} hidden text-xs whitespace-nowrap opacity-70 sm:table-cell`}
          title={Number.isNaN(saved) ? undefined : formatDateTime(saved)}
        >
          {isoTimeAgo(item.created_at)}
        </td>
      )}
      <td className={`${cellClassName} w-0`} aria-label="Actions">
        <div className="flex items-center justify-end gap-2">
          {queue && (
            <button
              type="button"
              onClick={() => void run('get')}
              disabled={busy !== null}
              className={greenButton}
              title="Download now, without waiting for room"
            >
              {busy === 'get' ? 'Getting…' : '+ Get'}
            </button>
          )}
          <button
            type="button"
            onClick={() => void run('remove')}
            disabled={busy !== null}
            className={quietButton}
          >
            Remove
          </button>
        </div>
      </td>
    </tr>
  );
};

const EMPTY: Record<SavedStage, { title: string; hint: string }> = {
  queued: {
    title: 'Nothing queued.',
    hint: "Pick a release and save it, and it downloads on its own once there's room.",
  },
  later: {
    title: 'Nothing saved for later.',
    hint: "Use the bookmark on a book, or Save for later when you're out of room, to keep it here.",
  },
};

/**
 * One of the two saved tabs: Queued (releases picked, downloading on their own once
 * there's room) or Wanted (books to choose releases for).
 */
export const SavedPanel = ({
  stage,
  items,
  loaded,
  onRefresh,
  positionOffset = 0,
  ...rest
}: SavedPanelProps & { stage: SavedStage }) => {
  useMountEffect(() => {
    void onRefresh();
  });
  if (!loaded) {
    return <p className="mt-8 text-center text-sm opacity-70">Loading…</p>;
  }
  const staged = items.filter((item) => savedStage(item) === stage);
  if (staged.length === 0 && positionOffset > 0) {
    return <p className="text-xs opacity-60">No saved picks are waiting for room.</p>;
  }
  if (staged.length === 0) {
    return (
      <div className="mt-8 space-y-1 text-center text-sm opacity-70">
        <p>{EMPTY[stage].title}</p>
        <p className="text-xs">{EMPTY[stage].hint}</p>
      </div>
    );
  }
  return (
    <SavedTable
      stage={stage}
      items={staged}
      positionOffset={positionOffset}
      onCheckDue={onRefresh}
      {...rest}
    />
  );
};

// How long after a check is due to read the list again: what it found, and the next one.
const AFTER_CHECK_MS = 4000;

const SavedTable = ({
  stage,
  items,
  onReorder,
  positionOffset = 0,
  onCheckDue,
  ...rowHandlers
}: Omit<SavedPanelProps, 'loaded' | 'onRefresh'> & {
  stage: SavedStage;
  onCheckDue: () => Promise<void>;
}) => {
  const { nextCheckAt } = rowHandlers;
  useDependencyEffect(() => {
    if (stage !== 'queued' || typeof nextCheckAt !== 'number') return undefined;
    const timer = window.setTimeout(
      () => void onCheckDue(),
      Math.max(0, nextCheckAt - Date.now()) + AFTER_CHECK_MS,
    );
    return () => window.clearTimeout(timer);
  }, [stage, nextCheckAt]);
  const [sort, setSort] = useState<SortState<SavedSortKey>>({ key: 'saved', direction: 'desc' });
  const [moving, setMoving] = useState(false);
  // Queued items are in line: shown in the order they get room, not sortable.
  const inLine = stage === 'queued';
  const rows = inLine ? queueOrder(items) : sortRows(items, sort, savedSortValue);
  const reorder = async (ids: number[]) => {
    if (!onReorder) return;
    setMoving(true);
    try {
      await onReorder(ids);
    } finally {
      setMoving(false);
    }
  };
  const rowIds = rows.map((item) => item.id);
  const { handleProps, rowProps, previewIndex, dragging } = useRowDrag({
    count: inLine ? rows.length : 0,
    disabled: moving || !onReorder,
    onDrop: (from, to) => void reorder(moveToIndex(rowIds, from, to)),
  });
  return (
    <section aria-label={SAVED_STAGE_LABELS[stage]} className="space-y-2">
      <p className="text-xs opacity-60">
        {inLine
          ? "Each release downloads on its own once there's room, checked in this order: one that doesn't fit yet (a big audiobook waiting for your ratio, say) doesn't hold up the others, even those picked with it."
          : 'Choose releases for a book and it joins the queue, to download once there’s room.'}
      </p>
      <TableFrame>
        <table className={tableClassName}>
          <thead>
            <tr className={headerRowClassName}>
              {inLine && <HeaderCell label="#" className="w-8" />}
              <th scope="col" className={cellClassName}>
                <span className="sr-only">Cover</span>
              </th>
              {inLine ? (
                <>
                  <HeaderCell label="Title" />
                  <HeaderCell label="Releases" />
                  <HeaderCell label="Waiting for" />
                  <HeaderCell label="Last checked" />
                  <HeaderCell label="Next check" />
                </>
              ) : (
                <>
                  <HeaderCell label="Title" sortKey="title" sort={sort} onSort={setSort} />
                  <HeaderCell label="Releases" sortKey="picks" sort={sort} onSort={setSort} />
                  <HeaderCell
                    label="Saved"
                    sortKey="saved"
                    sort={sort}
                    onSort={setSort}
                    initialDirection="desc"
                    className="hidden sm:table-cell"
                  />
                </>
              )}
              <th scope="col" className={cellClassName}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((item, index) => (
              <SavedRow
                key={item.id}
                item={item}
                queue={
                  inLine
                    ? {
                        position: positionOffset + previewIndex(index) + 1,
                        isFirst: index === 0,
                        isLast: index === rows.length - 1,
                        disabled: moving || dragging,
                        onMove: onReorder
                          ? (delta) => void reorder(moveInList(rowIds, index, delta))
                          : undefined,
                        handle: onReorder ? handleProps(index) : undefined,
                        row: rowProps(index),
                      }
                    : undefined
                }
                {...rowHandlers}
              />
            ))}
          </tbody>
        </table>
      </TableFrame>
    </section>
  );
};
