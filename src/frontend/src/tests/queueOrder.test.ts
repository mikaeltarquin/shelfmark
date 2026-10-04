import { describe, expect, it } from 'vitest';

import type { ActivityItem } from '../components/activity/activityTypes';
import { downloadQueueOrder } from '../components/activity/DownloadQueue';
import { moveInList, moveToIndex } from '../components/activity/QueueControls';
import { dropIndex, shiftFor } from '../hooks/useRowDrag';
import { queueOrder } from '../utils/savedItems';

describe('moveInList', () => {
  it('moves an entry up or down a place, and not past either end', () => {
    expect(moveInList(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b']);
    expect(moveInList(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moveInList(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
    expect(moveInList(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c']);
  });
});

const item = (id: number, queue_position: number | null, created_at: string) => ({
  id,
  queue_position,
  created_at,
});

const download = (
  id: string,
  queuePriority: number | undefined,
  timestamp: number,
): ActivityItem => ({
  id,
  kind: 'download',
  visualStatus: 'queued',
  title: id,
  author: '',
  metaLine: '',
  statusLabel: 'Queued',
  timestamp,
  queuePriority,
});

describe('queueOrder', () => {
  it('puts placed items first, then the rest oldest first', () => {
    const ordered = queueOrder([
      item(1, null, '2026-10-01'),
      item(2, 2, '2026-10-03'),
      item(3, null, '2026-09-30'),
      item(4, 1, '2026-10-04'),
    ]);
    expect(ordered.map((i) => i.id)).toEqual([4, 2, 3, 1]);
  });
});

describe('downloadQueueOrder', () => {
  it('orders by place in line, then by when added', () => {
    const ordered = downloadQueueOrder([
      download('late', 0, 300),
      download('moved-up', -2, 500),
      download('early', 0, 100),
      download('next', -1, 400),
    ]);
    expect(ordered.map((i) => i.id)).toEqual(['moved-up', 'next', 'early', 'late']);
  });
});

describe('moveToIndex', () => {
  it('moves an entry to an index', () => {
    expect(moveToIndex(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveToIndex(['a', 'b', 'c', 'd'], 3, 0)).toEqual(['d', 'a', 'b', 'c']);
  });
});

describe('row dragging', () => {
  // Four rows 50px tall from y=0: centres at 25, 75, 125, 175.
  const mids = [25, 75, 125, 175];

  it('drops a row one place past each other row whose centre it passes', () => {
    expect(dropIndex(mids, 0, 25)).toBe(0); // Not moved
    expect(dropIndex(mids, 0, 70)).toBe(0); // Not past the next row's centre yet
    expect(dropIndex(mids, 0, 80)).toBe(1);
    expect(dropIndex(mids, 0, 400)).toBe(3); // Past the end
    expect(dropIndex(mids, 3, 100)).toBe(2); // Between rows 1 and 2
    expect(dropIndex(mids, 3, 50)).toBe(1); // Between rows 0 and 1
    expect(dropIndex(mids, 3, -50)).toBe(0); // Past the top
  });

  it('slides the rows in between aside to open the gap', () => {
    // Row 0 dragged down to 2: rows 1 and 2 move up a row.
    expect([0, 1, 2, 3].map((i) => shiftFor(i, 0, 2, 50))).toEqual([0, -50, -50, 0]);
    // Row 3 dragged up to 1: rows 1 and 2 move down a row.
    expect([0, 1, 2, 3].map((i) => shiftFor(i, 3, 1, 50))).toEqual([0, 50, 50, 0]);
  });
});
