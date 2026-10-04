import { describe, expect, it } from 'vitest';

import { downloadToActivityItem } from '../components/activity/activityMappers';
import type { Book } from '../types';

const book = (fields: Partial<Book>): Book => ({
  id: 'b',
  title: 'Good Omens',
  author: 'A',
  ...fields,
});

describe('download narrators', () => {
  it("carries an audiobook's narrators, to tell editions apart", () => {
    expect(
      downloadToActivityItem(book({ narrators: ['Martin Jarvis'] }), 'queued').narrators,
    ).toEqual(['Martin Jarvis']);
    expect(downloadToActivityItem(book({}), 'complete').narrators).toEqual([]);
  });
});
