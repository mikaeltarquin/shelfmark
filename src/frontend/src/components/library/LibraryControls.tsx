import type { LibraryFormatFilter } from '../../utils/libraryBrowser';
import type { OwnershipFilter } from '../../utils/libraryRows';
import { inputClass, segmentClass } from './libraryStyles';

export type LibraryLayout = 'grid' | 'table';
export type SortDirectionValue = 'asc' | 'desc';

export const isLayout = (value: unknown): value is LibraryLayout =>
  value === 'grid' || value === 'table';

/** Grid of cards, or a table whose rows open up. */
export const LayoutToggle = ({
  value,
  onChange,
}: {
  value: LibraryLayout;
  onChange: (layout: LibraryLayout) => void;
}) => (
  <div className="flex gap-1" role="group" aria-label="Layout">
    {(['grid', 'table'] as const).map((layout) => (
      <button
        key={layout}
        type="button"
        className={segmentClass(value === layout)}
        aria-pressed={value === layout}
        onClick={() => onChange(layout)}
      >
        {layout === 'grid' ? 'Grid' : 'Table'}
      </button>
    ))}
  </div>
);

export const DirectionButton = ({
  value,
  onChange,
}: {
  value: SortDirectionValue;
  onChange: (direction: SortDirectionValue) => void;
}) => (
  <button
    type="button"
    onClick={() => onChange(value === 'asc' ? 'desc' : 'asc')}
    className={`${inputClass} hover:bg-(--hover-surface)`}
    aria-label={
      value === 'asc' ? 'Ascending, switch to descending' : 'Descending, switch to ascending'
    }
    title={value === 'asc' ? 'Ascending' : 'Descending'}
  >
    {value === 'asc' ? '↑ Asc' : '↓ Desc'}
  </button>
);

const FORMAT_FILTERS: Array<{ value: LibraryFormatFilter; label: string }> = [
  { value: 'any', label: 'All formats' },
  { value: 'ebook', label: 'Ebook' },
  { value: 'audiobook', label: 'Audiobook' },
  { value: 'both', label: 'Both' },
];

export const isFormatFilter = (value: unknown): value is LibraryFormatFilter =>
  FORMAT_FILTERS.some((option) => option.value === value);

export const FormatSelect = ({
  value,
  onChange,
  ownership = 'owned',
}: {
  value: LibraryFormatFilter;
  onChange: (format: LibraryFormatFilter) => void;
  ownership?: OwnershipFilter;
}) => (
  <select
    value={value}
    onChange={(event) => {
      const next = event.target.value;
      if (isFormatFilter(next)) onChange(next);
    }}
    aria-label="Format"
    title={
      ownership === 'owned'
        ? undefined
        : 'Missing books: not held in this format ("All formats": held in none, "Both": lacking either)'
    }
    className={inputClass}
  >
    {FORMAT_FILTERS.map((option) => (
      <option key={option.value} value={option.value}>
        {option.label}
      </option>
    ))}
  </select>
);

const OWNERSHIP: Array<{ value: OwnershipFilter; label: string }> = [
  { value: 'owned', label: 'Owned' },
  { value: 'missing', label: 'Missing' },
  { value: 'all', label: 'Owned + missing' },
];

export const isOwnershipFilter = (value: unknown): value is OwnershipFilter =>
  OWNERSHIP.some((option) => option.value === value);

/** Owned books, the metadata provider's books the library lacks, or both together. */
export const OwnershipToggle = ({
  value,
  onChange,
}: {
  value: OwnershipFilter;
  onChange: (ownership: OwnershipFilter) => void;
}) => (
  <div className="flex gap-1" role="group" aria-label="Show">
    {OWNERSHIP.map((option) => (
      <button
        key={option.value}
        type="button"
        className={segmentClass(value === option.value)}
        aria-pressed={value === option.value}
        onClick={() => onChange(option.value)}
      >
        {option.label}
      </button>
    ))}
  </div>
);

interface SortHeaderProps<Field extends string> {
  label: string;
  field: Field;
  sort: Field;
  direction: SortDirectionValue;
  onSort: (field: Field) => void;
  align?: 'left' | 'right';
  className?: string;
}

/** A table column header that sorts by its field; clicking it again flips the direction. */
export const SortHeader = <Field extends string>({
  label,
  field,
  sort,
  direction,
  onSort,
  align = 'left',
  className = '',
}: SortHeaderProps<Field>) => {
  const active = sort === field;
  let ariaSort: 'ascending' | 'descending' | 'none' = 'none';
  if (active) ariaSort = direction === 'asc' ? 'ascending' : 'descending';
  return (
    <th
      scope="col"
      aria-sort={ariaSort}
      className={`px-3 py-2 font-medium ${align === 'right' ? 'text-right' : 'text-left'} ${className}`}
    >
      <button
        type="button"
        onClick={() => onSort(field)}
        className={`inline-flex items-center gap-1 hover:underline ${active ? '' : 'opacity-70'}`}
      >
        {label}
        {active && <span aria-hidden="true">{direction === 'asc' ? '▲' : '▼'}</span>}
      </button>
    </th>
  );
};

/** A plain table column header. */
export const PlainHeader = ({
  label,
  align = 'left',
  className = '',
}: {
  label: string;
  align?: 'left' | 'right';
  className?: string;
}) => (
  <th
    scope="col"
    className={`px-3 py-2 font-medium opacity-70 ${align === 'right' ? 'text-right' : 'text-left'} ${className}`}
  >
    {label}
  </th>
);

/** The chevron that opens a table row. */
export const ExpandButton = ({
  open,
  label,
  onToggle,
}: {
  open: boolean;
  label: string;
  onToggle: () => void;
}) => (
  <button
    type="button"
    onClick={onToggle}
    aria-expanded={open}
    aria-label={`${open ? 'Hide' : 'Show'} books: ${label}`}
    className="flex h-6 w-6 items-center justify-center rounded hover:bg-(--hover-surface)"
  >
    <svg
      className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-90' : ''}`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
    </svg>
  </button>
);

export const tableShellClass = 'overflow-x-auto rounded-xl';
export const tableShellStyle = { background: 'var(--bg-soft)' };
export const rowClass = 'border-b border-(--border-muted) last:border-0 hover:bg-(--hover-surface)';
