import { useState } from 'react';

import { getLibraryItemFiles } from '../../services/api';
import type { LibraryHoldingItem, LibraryItemFile } from '../../types';

/** "1.2 GB", "845 MB", "512 KB". */
export function formatBytes(bytes?: number | null): string | null {
  if (!bytes || bytes <= 0) return null;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = value >= 100 || unit === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

/** "11h 42m", "38m". */
export function formatDuration(seconds?: number | null): string | null {
  if (!seconds || seconds <= 0) return null;
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

/** What one item holds: "Audiobook · 24 files", "Ebook · EPUB, AZW3", "Audiobook + ebook · EPUB". */
export function holdingFormatText(holding: LibraryHoldingItem): string {
  const kinds = (['audiobook', 'ebook'] as const).filter((kind) => holding.formats.includes(kind));
  const kindText = kinds
    .map((kind, index) => (index === 0 ? kind.charAt(0).toUpperCase() + kind.slice(1) : kind))
    .join(' + ');
  const details: string[] = [];
  if (holding.file_formats.length > 0) {
    details.push(holding.file_formats.map((format) => format.toUpperCase()).join(', '));
  }
  if (kinds.includes('audiobook') && holding.audio_files > 1) {
    details.push(`${holding.audio_files} audio files`);
  }
  return [kindText, ...details].filter(Boolean).join(' · ');
}

/** "Open in Audiobookshelf", "Open in Calibre-Web". */
export function openLinkText(holding: LibraryHoldingItem): string {
  return holding.source === 'calibre' ? 'Open in Calibre-Web' : `Open in ${holding.library}`;
}

type FilesState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'loaded'; files: LibraryItemFile[] }
  | { status: 'error'; message: string };

const HoldingRow = ({ holding }: { holding: LibraryHoldingItem }) => {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<FilesState>({ status: 'idle' });

  const toggleFiles = () => {
    const next = !open;
    setOpen(next);
    if (!next || files.status === 'loading' || files.status === 'loaded') return;
    setFiles({ status: 'loading' });
    getLibraryItemFiles(holding.source, holding.item_id)
      .then((loaded) => setFiles({ status: 'loaded', files: loaded }))
      .catch((error: unknown) =>
        setFiles({
          status: 'error',
          message: error instanceof Error ? error.message : 'Could not list the files',
        }),
      );
  };

  const facts = [
    holding.year ? String(holding.year) : null,
    formatDuration(holding.duration),
    formatBytes(holding.size),
  ].filter(Boolean);

  return (
    <li className="space-y-1.5 border-t border-(--border-muted) pt-2.5 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-sky-700 dark:text-sky-300">
            {holding.library}
            {holding.holding === 'collection' ? ' · inside a collection' : ''}
          </p>
          <p className="font-medium text-gray-900 dark:text-gray-100">{holding.title}</p>
        </div>
        {holding.url && (
          <a
            href={holding.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-sky-700 hover:underline dark:text-sky-300"
          >
            {openLinkText(holding)}
            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M14 5h5v5M19 5l-8 8M10 5H6a1 1 0 00-1 1v12a1 1 0 001 1h12a1 1 0 001-1v-4"
              />
            </svg>
          </a>
        )}
      </div>

      <p className="text-xs text-gray-700 dark:text-gray-300">
        {holdingFormatText(holding)}
        {facts.length > 0 && <span className="text-gray-500"> · {facts.join(' · ')}</span>}
      </p>

      {holding.narrators.length > 0 && (
        <p className="text-xs text-gray-700 dark:text-gray-300">
          <span className="text-gray-500">Narrated by </span>
          {holding.narrators.join(', ')}
        </p>
      )}

      {holding.path && (
        <p
          className="font-mono text-[11px] break-all text-gray-600 dark:text-gray-400"
          title={holding.path}
        >
          {holding.path}
        </p>
      )}

      <button
        type="button"
        onClick={toggleFiles}
        aria-expanded={open}
        className="text-xs font-medium text-gray-600 hover:text-gray-900 hover:underline dark:text-gray-400 dark:hover:text-gray-100"
      >
        {open ? 'Hide files' : 'Show files'}
      </button>

      {open && (
        <div className="text-xs">
          {files.status === 'loading' && <p className="text-gray-500">Loading files…</p>}
          {files.status === 'error' && (
            <p className="text-red-600 dark:text-red-400">{files.message}</p>
          )}
          {files.status === 'loaded' && files.files.length === 0 && (
            <p className="text-gray-500">No files listed.</p>
          )}
          {files.status === 'loaded' && files.files.length > 0 && (
            <ul className="max-h-48 space-y-0.5 overflow-y-auto">
              {files.files.map((file) => (
                <li key={file.path} className="flex items-baseline justify-between gap-3">
                  <span
                    className="min-w-0 truncate font-mono text-[11px] text-gray-700 dark:text-gray-300"
                    title={file.path}
                  >
                    {file.name}
                  </span>
                  {file.size ? (
                    <span className="shrink-0 text-[11px] text-gray-500">
                      {formatBytes(file.size)}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
};

/** The library items holding a book: format, edition, narrator, where it is, a link. */
export const LibraryHoldings = ({ holdings }: { holdings: LibraryHoldingItem[] }) => (
  <ul className="space-y-2.5">
    {holdings.map((holding) => (
      <HoldingRow key={`${holding.source}:${holding.item_id}`} holding={holding} />
    ))}
  </ul>
);
