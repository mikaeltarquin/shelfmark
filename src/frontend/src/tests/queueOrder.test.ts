import { describe, expect, it } from 'vitest';

import type { ActivityItem } from '../components/activity/activityTypes';
import { downloadQueueOrder } from '../components/activity/DownloadQueue';
import { moveInList } from '../components/activity/QueueControls';
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
