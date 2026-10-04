import type { CSSProperties, PointerEvent } from 'react';

/** Shared pieces for the ordered lists on the Queued page: a place number, a drag handle
 * and move buttons. */

/** `ids` with the one at `index` moved by `delta` places (clamped to the list). */
export const moveInList = <T,>(ids: readonly T[], index: number, delta: number): T[] => {
  const target = Math.max(0, Math.min(ids.length - 1, index + delta));
  if (target === index) return [...ids];
  const next = [...ids];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved);
  return next;
};

/** `ids` with the one at `from` moved to index `to`. */
export const moveToIndex = <T,>(ids: readonly T[], from: number, to: number): T[] => {
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
};

/** What `useRowDrag().handleProps` gives a handle. */
export interface DragHandleProps {
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLElement>) => void;
  onPointerCancel: () => void;
  onLostPointerCapture: () => void;
  style: CSSProperties;
}

/**
 * The grip a row is dragged by. Pointer only: the move buttons beside it do the same
 * from the keyboard, so the grip is hidden from assistive technology.
 */
export const DragHandle = ({
  disabled = false,
  ...handle
}: DragHandleProps & { disabled?: boolean }) => (
  <span
    {...handle}
    aria-hidden="true"
    title="Drag to reorder"
    className={`inline-flex h-8 w-5 shrink-0 items-center justify-center rounded text-gray-400 select-none ${
      disabled
        ? 'opacity-30'
        : 'cursor-grab hover:text-gray-700 active:cursor-grabbing dark:hover:text-gray-200'
    }`}
  >
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="9" cy="6" r="1.6" />
      <circle cx="15" cy="6" r="1.6" />
      <circle cx="9" cy="12" r="1.6" />
      <circle cx="15" cy="12" r="1.6" />
      <circle cx="9" cy="18" r="1.6" />
      <circle cx="15" cy="18" r="1.6" />
    </svg>
  </span>
);

/** The place in line, as a small muted number. */
export const QueuePosition = ({ position }: { position: number }) => (
  <span className="text-xs font-semibold tabular-nums opacity-50" aria-label={`Number ${position}`}>
    {position}
  </span>
);

const Arrow = ({ up }: { up: boolean }) => (
  <svg
    className="h-3.5 w-3.5"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    aria-hidden="true"
  >
    <path strokeLinecap="round" strokeLinejoin="round" d={up ? 'm5 15 7-7 7 7' : 'm19 9-7 7-7-7'} />
  </svg>
);

/** Move up and down a place: disabled at the ends, and while a move is saving. */
export const QueueMoveButtons = ({
  title,
  isFirst,
  isLast,
  disabled = false,
  onMove,
}: {
  title: string;
  isFirst: boolean;
  isLast: boolean;
  disabled?: boolean;
  onMove: (delta: number) => void;
}) => {
  const className =
    'inline-flex h-6 w-6 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-(--hover-surface) hover:text-gray-900 disabled:pointer-events-none disabled:opacity-25 dark:hover:text-white';
  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        className={className}
        disabled={disabled || isFirst}
        onClick={() => onMove(-1)}
        aria-label={`Move ${title} up`}
        title="Move up"
      >
        <Arrow up />
      </button>
      <button
        type="button"
        className={className}
        disabled={disabled || isLast}
        onClick={() => onMove(1)}
        aria-label={`Move ${title} down`}
        title="Move down"
      >
        <Arrow up={false} />
      </button>
    </span>
  );
};
