import { useState } from 'react';

import { useMountEffect } from '../../hooks/useMountEffect';
import { withBasePath } from '../../utils/basePath';
import { formatDateTime, isoTimeAgo } from '../../utils/relativeTime';
import {
  SAVED_STAGE_LABELS,
  describeSavedPick,
  hasMamPick,
  savedStage,
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

interface SavedPanelProps {
  items: SavedItem[];
  loaded: boolean;
  // Whether items can be marked to download on their own (the global setting).
  autoGetAvailable: boolean;
  onGet: (item: SavedItem) => Promise<void>;
  onRemove: (item: SavedItem) => Promise<void>;
  // Re-reads the list, for what the background checks found since.
  onRefresh: () => Promise<void>;
  onAutoGet: (item: SavedItem, changes: { auto_get: boolean }) => Promise<void>;
  // Opens the book's details, as clicking a book does on the other pages.
  onOpenDetails?: (item: SavedItem) => void;
}

const AutoGetControls = ({
  item,
  onAutoGet,
}: {
  item: SavedItem;
  onAutoGet: SavedPanelProps['onAutoGet'];
}) => {
  const [busy, setBusy] = useState(false);
  const toggle = async (autoGet: boolean) => {
    setBusy(true);
    try {
      await onAutoGet(item, { auto_get: autoGet });
    } finally {
      setBusy(false);
    }
  };
  const checkedAgo = item.auto_checked_at ? isoTimeAgo(item.auto_checked_at) : null;
  let status = 'Waiting for the next check';
  if (item.auto_status) {
    status = checkedAgo ? `${item.auto_status} · checked ${checkedAgo}` : item.auto_status;
  }

  return (
    <div className="mt-1.5 space-y-1 text-xs">
      <label
        className="flex cursor-pointer items-center gap-2"
        title={
          hasMamPick(item)
            ? "Freeleech goes as soon as there's room; anything else once your ratio allows, or right away if it's too small to matter"
            : undefined
        }
      >
        <input
          type="checkbox"
          checked={item.auto_get}
          disabled={busy}
          onChange={(event) => void toggle(event.target.checked)}
          className="h-3.5 w-3.5 accent-emerald-600"
        />
        <span>Queue for download</span>
      </label>
      {item.auto_get && (
        <p className="pl-5.5 opacity-60" role="status">
          {status}
        </p>
      )}
    </div>
  );
};

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

const SavedRow = ({
  item,
  autoGetAvailable,
  onGet,
  onRemove,
  onAutoGet,
  onOpenDetails,
}: { item: SavedItem } & Omit<SavedPanelProps, 'items' | 'loaded' | 'onRefresh'>) => {
  const [busy, setBusy] = useState<'get' | 'remove' | null>(null);
  const run = async (action: 'get' | 'remove') => {
    setBusy(action);
    try {
      await (action === 'get' ? onGet(item) : onRemove(item));
    } finally {
      setBusy(null);
    }
  };
  const picks = describeSavedPick(item);
  const allPicks = describeSavedPick(item, { full: true });
  const saved = Date.parse(item.created_at);
  const openDetails = onOpenDetails ? () => onOpenDetails(item) : undefined;

  return (
    <tr className={rowClassName}>
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
      <td className={`${cellClassName} min-w-[12rem]`}>
        <p className="text-xs" title={allPicks}>
          {picks}
        </p>
        {item.last_error && (
          <p className="mt-0.5 text-xs text-red-600 dark:text-red-400">{item.last_error}</p>
        )}
      </td>
      {autoGetAvailable && (
        <td className={`${cellClassName} min-w-[12rem]`}>
          {item.releases.length > 0 ? (
            <AutoGetControls item={item} onAutoGet={onAutoGet} />
          ) : (
            <span className="text-xs opacity-50">Pick a release first</span>
          )}
        </td>
      )}
      <td
        className={`${cellClassName} hidden text-xs whitespace-nowrap opacity-70 sm:table-cell`}
        title={Number.isNaN(saved) ? undefined : formatDateTime(saved)}
      >
        {isoTimeAgo(item.created_at)}
      </td>
      <td className={`${cellClassName} w-0`} aria-label="Actions">
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => void run('get')}
            disabled={busy !== null}
            className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-medium whitespace-nowrap text-white transition-colors hover:bg-emerald-700 disabled:opacity-60"
          >
            {busy === 'get' ? 'Getting…' : '+ Get'}
          </button>
          <button
            type="button"
            onClick={() => void run('remove')}
            disabled={busy !== null}
            className="rounded-full px-2.5 py-1 text-xs font-medium opacity-70 transition-colors hover:bg-(--hover-surface) hover:opacity-100 disabled:opacity-40"
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
    hint: "Pick a release and save it (or tick Queue for download on a saved pick) and it downloads on its own once there's room.",
  },
  later: {
    title: 'Nothing saved for later.',
    hint: "Use the bookmark on a book or release, or Save for later when you're out of room, to keep it here.",
  },
};

/**
 * One of the two saved tabs: Queued (releases picked, downloading on their own once
 * there's room) or Saved for later (to get by hand).
 */
export const SavedPanel = ({
  stage,
  items,
  loaded,
  autoGetAvailable,
  onGet,
  onRemove,
  onRefresh,
  onAutoGet,
  onOpenDetails,
}: SavedPanelProps & { stage: SavedStage }) => {
  useMountEffect(() => {
    void onRefresh();
  });
  if (!loaded) {
    return <p className="mt-8 text-center text-sm opacity-70">Loading…</p>;
  }
  const staged = items.filter((item) => savedStage(item) === stage);
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
      autoGetAvailable={autoGetAvailable}
      onGet={onGet}
      onRemove={onRemove}
      onAutoGet={onAutoGet}
      onOpenDetails={onOpenDetails}
    />
  );
};

const SavedTable = ({
  stage,
  items,
  autoGetAvailable,
  onGet,
  onRemove,
  onAutoGet,
  onOpenDetails,
}: Omit<SavedPanelProps, 'loaded' | 'onRefresh'> & { stage: SavedStage }) => {
  const [sort, setSort] = useState<SortState<SavedSortKey>>({ key: 'saved', direction: 'desc' });
  return (
    <section aria-label={SAVED_STAGE_LABELS[stage]} className="space-y-2">
      <p className="text-xs opacity-60">
        {stage === 'queued'
          ? "Each downloads on its own once there's room."
          : 'Get one with + Get whenever you want it.'}
      </p>
      <TableFrame>
        <table className={tableClassName}>
          <thead>
            <tr className={headerRowClassName}>
              <th scope="col" className={cellClassName}>
                <span className="sr-only">Cover</span>
              </th>
              <HeaderCell label="Title" sortKey="title" sort={sort} onSort={setSort} />
              <HeaderCell label="Releases" sortKey="picks" sort={sort} onSort={setSort} />
              {autoGetAvailable && <HeaderCell label="Automatic download" />}
              <HeaderCell
                label="Saved"
                sortKey="saved"
                sort={sort}
                onSort={setSort}
                initialDirection="desc"
                className="hidden sm:table-cell"
              />
              <th scope="col" className={cellClassName}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {sortRows(items, sort, savedSortValue).map((item) => (
              <SavedRow
                key={item.id}
                item={item}
                autoGetAvailable={autoGetAvailable}
                onGet={onGet}
                onRemove={onRemove}
                onAutoGet={onAutoGet}
                onOpenDetails={onOpenDetails}
              />
            ))}
          </tbody>
        </table>
      </TableFrame>
    </section>
  );
};
