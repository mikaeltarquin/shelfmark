import { useState } from 'react';

import { useMountEffect } from '../../hooks/useMountEffect';
import { withBasePath } from '../../utils/basePath';
import {
  DEFAULT_MIN_RATIO,
  describeSavedPick,
  hasMamPick,
  type SavedConditions,
  type SavedItem,
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
  onAutoGet: (
    item: SavedItem,
    changes: { auto_get?: boolean; conditions?: SavedConditions },
  ) => Promise<void>;
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

// The ratio box commits on blur or Enter; empty or invalid falls back to the default.
const parseRatio = (value: string): number => {
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed >= 0
    ? Math.round(parsed * 100) / 100
    : DEFAULT_MIN_RATIO;
};

const AutoGetControls = ({
  item,
  onAutoGet,
}: {
  item: SavedItem;
  onAutoGet: SavedPanelProps['onAutoGet'];
}) => {
  const [ratioText, setRatioText] = useState(String(item.conditions.min_ratio));
  const [busy, setBusy] = useState(false);
  const mam = hasMamPick(item);
  const change = async (changes: { auto_get?: boolean; conditions?: SavedConditions }) => {
    setBusy(true);
    try {
      await onAutoGet(item, changes);
    } finally {
      setBusy(false);
    }
  };
  const setConditions = (next: Partial<SavedConditions>) =>
    void change({ conditions: { ...item.conditions, ...next } });
  const commitRatio = () => {
    const ratio = parseRatio(ratioText);
    setRatioText(String(ratio));
    if (ratio !== item.conditions.min_ratio) setConditions({ min_ratio: ratio });
  };
  const checkedAgo = item.auto_checked_at ? savedAgo(item.auto_checked_at) : null;
  let status = 'Waiting for the next check';
  if (item.auto_status) {
    status = checkedAgo ? `${item.auto_status} · checked ${checkedAgo}` : item.auto_status;
  }

  return (
    <div className="mt-1.5 space-y-1 text-xs">
      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          checked={item.auto_get}
          disabled={busy}
          onChange={(event) => void change({ auto_get: event.target.checked })}
          className="h-3.5 w-3.5 accent-emerald-600"
        />
        <span>Get automatically when there&apos;s room</span>
      </label>
      {item.auto_get && (
        <div className="space-y-1 pl-5.5">
          {mam && (
            <>
              <label className="flex cursor-pointer items-center gap-2 opacity-90">
                <input
                  type="checkbox"
                  checked={item.conditions.freeleech_only}
                  disabled={busy}
                  onChange={(event) => setConditions({ freeleech_only: event.target.checked })}
                  className="h-3.5 w-3.5 accent-emerald-600"
                />
                <span>Freeleech only</span>
              </label>
              <div className="flex flex-wrap items-center gap-2 opacity-90">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={item.conditions.min_ratio_enabled}
                    disabled={busy}
                    onChange={(event) => setConditions({ min_ratio_enabled: event.target.checked })}
                    className="h-3.5 w-3.5 accent-emerald-600"
                  />
                  <span>Ratio after download at least</span>
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={ratioText}
                  disabled={busy || !item.conditions.min_ratio_enabled}
                  aria-label="Minimum ratio after download"
                  onChange={(event) => setRatioText(event.target.value)}
                  onBlur={commitRatio}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') commitRatio();
                  }}
                  className="w-14 rounded border border-(--border-muted) bg-(--bg-soft) px-1.5 py-0.5 tabular-nums disabled:opacity-50"
                />
              </div>
            </>
          )}
          <p className="opacity-60" role="status">
            {status}
          </p>
        </div>
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
          <AutoGetControls key={item.conditions.min_ratio} item={item} onAutoGet={onAutoGet} />
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
export const SavedPanel = ({
  items,
  loaded,
  autoGetAvailable,
  onGet,
  onRemove,
  onRefresh,
  onAutoGet,
}: SavedPanelProps) => {
  useMountEffect(() => {
    void onRefresh();
  });
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
  );
};
