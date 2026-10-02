import { useState } from 'react';

import { withBasePath } from '../../utils/basePath';
import { describeSavedPick, type SavedItem } from '../../utils/savedItems';

interface SavedPanelProps {
  items: SavedItem[];
  loaded: boolean;
  onGet: (item: SavedItem) => Promise<void>;
  onRemove: (item: SavedItem) => Promise<void>;
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

const coverUrl = (preview: string | undefined): string | null => {
  if (!preview) return null;
  return preview.startsWith('/') ? withBasePath(preview) : preview;
};

const SavedRow = ({
  item,
  onGet,
  onRemove,
}: { item: SavedItem } & Omit<SavedPanelProps, 'items' | 'loaded'>) => {
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

/** The Saved tab: books and picked releases kept to download later. */
export const SavedPanel = ({ items, loaded, onGet, onRemove }: SavedPanelProps) => {
  if (!loaded) {
    return <p className="mt-8 text-center text-sm opacity-70">Loading saved…</p>;
  }
  if (items.length === 0) {
    return (
      <div className="mt-8 space-y-1 text-center text-sm opacity-70">
        <p>Nothing saved yet.</p>
        <p className="text-xs">
          Use the bookmark on a book or release, or Save for later when you&apos;re out of room, to
          keep it here.
        </p>
      </div>
    );
  }
  return (
    <ul className="divide-y divide-[color-mix(in_srgb,var(--border-muted)_60%,transparent)]">
      {items.map((item) => (
        <SavedRow key={item.id} item={item} onGet={onGet} onRemove={onRemove} />
      ))}
    </ul>
  );
};
