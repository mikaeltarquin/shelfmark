import { useState } from 'react';

import { useMountEffect } from '../../hooks/useMountEffect';
import { withBasePath } from '../../utils/basePath';
import {
  SAVED_STAGE_LABELS,
  describeSavedPick,
  hasMamPick,
  savedStage,
  type SavedItem,
  type SavedStage,
} from '../../utils/savedItems';

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
}

const savedAgo = (iso: string): string => {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
};

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
  const checkedAgo = item.auto_checked_at ? savedAgo(item.auto_checked_at) : null;
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

const SavedRow = ({
  item,
  autoGetAvailable,
  onGet,
  onRemove,
  onAutoGet,
}: { item: SavedItem } & Omit<SavedPanelProps, 'items' | 'loaded' | 'onRefresh'>) => {
  const [busy, setBusy] = useState<'get' | 'remove' | null>(null);
  const cover = coverUrl(item.book.preview);
  const run = async (action: 'get' | 'remove') => {
    setBusy(action);
    try {
      await (action === 'get' ? onGet(item) : onRemove(item));
    } finally {
      setBusy(null);
    }
  };

  return (
    <li className="flex gap-3 py-3">
      <div className="h-16 w-11 shrink-0 overflow-hidden rounded bg-(--border-muted)">
        {cover && <img src={cover} alt="" className="h-full w-full object-cover" loading="lazy" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium" title={item.title}>
          {item.title}
        </p>
        {item.author && <p className="truncate text-xs opacity-70">{item.author}</p>}
        <p className="mt-0.5 truncate text-xs opacity-60" title={describeSavedPick(item)}>
          {describeSavedPick(item)}
        </p>
        {item.last_error && (
          <p className="mt-0.5 text-xs text-red-600 dark:text-red-400">{item.last_error}</p>
        )}
        {autoGetAvailable && item.releases.length > 0 && (
          <AutoGetControls item={item} onAutoGet={onAutoGet} />
        )}
        <div className="mt-1.5 flex items-center gap-2">
          <button
            type="button"
            onClick={() => void run('get')}
            disabled={busy !== null}
            className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-60"
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
          <span className="ml-auto text-[11px] opacity-50">{savedAgo(item.created_at)}</span>
        </div>
      </div>
    </li>
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
    <section aria-label={SAVED_STAGE_LABELS[stage]}>
      <p className="text-[11px] opacity-50">
        {stage === 'queued'
          ? "Each downloads on its own once there's room."
          : 'Get one with + Get whenever you want it.'}
      </p>
      <ul className="divide-y divide-[color-mix(in_srgb,var(--border-muted)_60%,transparent)]">
        {staged.map((item) => (
          <SavedRow
            key={item.id}
            item={item}
            autoGetAvailable={autoGetAvailable}
            onGet={onGet}
            onRemove={onRemove}
            onAutoGet={onAutoGet}
          />
        ))}
      </ul>
    </section>
  );
};
