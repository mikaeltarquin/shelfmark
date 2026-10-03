import type { ReactNode } from 'react';

/** Shared look for the Sonarr-style tables: Activity, Queued and Wanted. */

export type SortDirection = 'asc' | 'desc';

export interface SortState<K extends string> {
  key: K;
  direction: SortDirection;
}

const nextSort = <K extends string>(
  current: SortState<K>,
  key: K,
  // The direction a column starts in: newest first for dates, A to Z for text.
  initialDirection: SortDirection = 'asc',
): SortState<K> =>
  current.key === key
    ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
    : { key, direction: initialDirection };

type SortValue = string | number | null | undefined;

/** Rows in the column's order; blanks go last whichever way it runs. */
export const sortRows = <T, K extends string>(
  rows: readonly T[],
  sort: SortState<K>,
  valueOf: (row: T, key: K) => SortValue,
): T[] =>
  rows.toSorted((left, right) => {
    const a = valueOf(left, sort.key);
    const b = valueOf(right, sort.key);
    const aBlank = a === null || a === undefined || a === '';
    const bBlank = b === null || b === undefined || b === '';
    if (aBlank || bBlank) return Number(aBlank) - Number(bBlank);
    const order =
      typeof a === 'number' && typeof b === 'number'
        ? a - b
        : String(a).localeCompare(String(b), undefined, { sensitivity: 'base', numeric: true });
    return sort.direction === 'asc' ? order : -order;
  });

const SIZE_UNITS: Record<string, number> = {
  b: 1,
  kb: 1024,
  kib: 1024,
  mb: 1024 ** 2,
  mib: 1024 ** 2,
  gb: 1024 ** 3,
  gib: 1024 ** 3,
  tb: 1024 ** 4,
  tib: 1024 ** 4,
};

/** "2.3 MB" in bytes, for sorting; null when it isn't a size. */
export const parseSize = (value?: string | null): number | null => {
  if (!value) return null;
  const match = value.trim().match(/^([\d.,]+)\s*([a-z]+)?$/i);
  if (!match) return null;
  const amount = Number.parseFloat(match[1].replace(',', '.'));
  const unit = SIZE_UNITS[(match[2] ?? 'b').toLowerCase()];
  return Number.isFinite(amount) && unit ? amount * unit : null;
};

export const tableClassName = 'w-full border-collapse text-left text-sm';
export const headerRowClassName =
  'border-b border-(--border-muted) text-xs font-semibold tracking-wide uppercase opacity-70';
export const rowClassName =
  'border-b border-[color-mix(in_srgb,var(--border-muted)_60%,transparent)] align-middle transition-colors hover:bg-(--hover-row)';
export const cellClassName = 'px-3 py-2';

/** The table in its card, scrolling sideways on a narrow screen rather than squashing. */
export const TableFrame = ({ children }: { children: ReactNode }) => (
  <div className="overflow-x-auto rounded-xl border border-(--border-muted) bg-(--bg-soft)">
    {children}
  </div>
);

export const HeaderCell = <K extends string>({
  label,
  sortKey,
  sort,
  onSort,
  initialDirection,
  className = '',
}: {
  label: string;
  sortKey?: K;
  sort?: SortState<K>;
  onSort?: (next: SortState<K>) => void;
  initialDirection?: SortDirection;
  className?: string;
}) => {
  const active = Boolean(sortKey && sort?.key === sortKey);
  let ariaSort: 'ascending' | 'descending' | undefined;
  if (active) ariaSort = sort?.direction === 'asc' ? 'ascending' : 'descending';
  return (
    <th
      scope="col"
      className={`${cellClassName} whitespace-nowrap ${className}`}
      aria-sort={ariaSort}
    >
      {sortKey && sort && onSort ? (
        <button
          type="button"
          onClick={() => onSort(nextSort(sort, sortKey, initialDirection))}
          className={`inline-flex items-center gap-1 uppercase hover:opacity-100 ${
            active ? 'text-sky-600 opacity-100 dark:text-sky-400' : ''
          }`}
        >
          {label}
          <span aria-hidden="true" className={active ? '' : 'invisible'}>
            {sort.direction === 'asc' ? '▲' : '▼'}
          </span>
        </button>
      ) : (
        label
      )}
    </th>
  );
};

/** A book cover the size of a table row. */
export const RowCover = ({
  src,
  title,
  onClick,
}: {
  src?: string | null;
  title: string;
  onClick?: () => void;
}) => {
  const image = src ? (
    <img src={src} alt="" className="h-full w-full object-cover object-top" loading="lazy" />
  ) : null;
  const className =
    'block h-12 w-8 shrink-0 overflow-hidden rounded-sm bg-gray-200 dark:bg-gray-700';
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Details: ${title}`}
      className={`${className} transition-opacity hover:opacity-80`}
    >
      {image}
    </button>
  ) : (
    <span className={className}>{image}</span>
  );
};
