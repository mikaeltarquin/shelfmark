import { useRef, useState, type CSSProperties, type PointerEvent } from 'react';

/**
 * Where a dragged row lands: its centre is at `centre` (page y), the rows' centres are
 * `midpoints` (page y, in list order), and it started at `from`. The answer is its index
 * in the list once moved: one place after every other row whose centre it has passed.
 */
export const dropIndex = (midpoints: readonly number[], from: number, centre: number): number =>
  midpoints.reduce((index, mid, i) => (i !== from && centre > mid ? index + 1 : index), 0);

/** How far a row that isn't being dragged moves aside, to open the gap at `over`. */
export const shiftFor = (index: number, from: number, over: number, height: number): number => {
  if (index === from) return 0;
  if (from < over && index > from && index <= over) return -height;
  if (from > over && index >= over && index < from) return height;
  return 0;
};

interface DragStart {
  from: number;
  pointerId: number;
  startPageY: number;
  midpoints: number[];
  height: number;
}

interface DragState {
  from: number;
  over: number;
  offset: number;
  height: number;
}

// Within this distance of the window's top or bottom, a drag scrolls the page.
const EDGE_PX = 64;
const SCROLL_STEP_PX = 14;

/**
 * Reorder table rows by dragging a handle, with a mouse or a finger.
 *
 * Pointer events rather than HTML drag and drop, which touch screens don't fire. The
 * dragged row follows the pointer and the others slide aside; nothing moves in the list
 * until the drop calls `onDrop(from, to)`. Near the window's edge the page scrolls.
 */
export const useRowDrag = ({
  count,
  disabled = false,
  onDrop,
}: {
  count: number;
  disabled?: boolean;
  onDrop: (from: number, to: number) => void;
}) => {
  const rows = useRef<(HTMLElement | null)[]>([]);
  const start = useRef<DragStart | null>(null);
  const lastClientY = useRef(0);
  const scrollFrame = useRef<number | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  const update = () => {
    const s = start.current;
    if (!s) return;
    const offset = lastClientY.current + window.scrollY - s.startPageY;
    const over = dropIndex(s.midpoints, s.from, s.midpoints[s.from] + offset);
    setDrag({ from: s.from, over, offset, height: s.height });
  };

  const stopScrolling = () => {
    if (scrollFrame.current !== null) window.cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = null;
  };

  // Keeps scrolling while the pointer rests near an edge, not only while it moves.
  const scrollTick = () => {
    scrollFrame.current = null;
    if (!start.current) return;
    const y = lastClientY.current;
    let step = 0;
    if (y < EDGE_PX) step = -SCROLL_STEP_PX;
    else if (y > window.innerHeight - EDGE_PX) step = SCROLL_STEP_PX;
    if (step === 0) return;
    window.scrollBy(0, step);
    update();
    scrollFrame.current = window.requestAnimationFrame(scrollTick);
  };

  const end = (commit: boolean) => {
    const s = start.current;
    start.current = null;
    stopScrolling();
    setDrag(null);
    if (!s || !commit) return;
    const offset = lastClientY.current + window.scrollY - s.startPageY;
    const to = dropIndex(s.midpoints, s.from, s.midpoints[s.from] + offset);
    if (to !== s.from) onDrop(s.from, to);
  };

  /** Props for a row's drag handle. */
  const handleProps = (index: number) => ({
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (disabled || event.button !== 0 || start.current) return;
      const elements = rows.current.slice(0, count).filter((el): el is HTMLElement => el !== null);
      if (elements.length !== count) return;
      event.preventDefault();
      const scrollY = window.scrollY;
      const rects = elements.map((el) => el.getBoundingClientRect());
      start.current = {
        from: index,
        pointerId: event.pointerId,
        startPageY: event.clientY + scrollY,
        midpoints: rects.map((rect) => rect.top + scrollY + rect.height / 2),
        height: rects[index].height,
      };
      lastClientY.current = event.clientY;
      event.currentTarget.setPointerCapture(event.pointerId);
      setDrag({ from: index, over: index, offset: 0, height: rects[index].height });
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      if (start.current?.pointerId !== event.pointerId) return;
      lastClientY.current = event.clientY;
      update();
      if (scrollFrame.current === null) {
        scrollFrame.current = window.requestAnimationFrame(scrollTick);
      }
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => {
      if (start.current?.pointerId !== event.pointerId) return;
      lastClientY.current = event.clientY;
      end(true);
    },
    onPointerCancel: () => end(false),
    onLostPointerCapture: () => {
      if (start.current) end(false);
    },
    style: { touchAction: 'none' } satisfies CSSProperties,
  });

  /** Props for a row: where it is, and how it moves while a drag is on. */
  const rowProps = (index: number) => {
    let style: CSSProperties | undefined;
    if (drag) {
      style =
        index === drag.from
          ? { transform: `translateY(${drag.offset}px)`, position: 'relative', zIndex: 1 }
          : {
              transform: `translateY(${shiftFor(index, drag.from, drag.over, drag.height)}px)`,
              transition: 'transform 150ms ease',
            };
    }
    return {
      ref: (element: HTMLElement | null) => {
        rows.current[index] = element;
      },
      style,
      'data-dragging': drag?.from === index ? true : undefined,
    };
  };

  /** A row's index if the drag dropped now, so the numbers show the order to come. */
  const previewIndex = (index: number): number => {
    if (!drag) return index;
    if (index === drag.from) return drag.over;
    return index + Math.sign(shiftFor(index, drag.from, drag.over, 1));
  };

  return { handleProps, rowProps, previewIndex, dragging: drag !== null };
};
