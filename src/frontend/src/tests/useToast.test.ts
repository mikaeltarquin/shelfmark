import { describe, expect, it } from 'vitest';

import { nextToastId } from '../hooks/useToast';

describe('toast ids', () => {
  it('are distinct for toasts shown in the same millisecond', () => {
    const ids = Array.from({ length: 5 }, () => nextToastId());
    expect(new Set(ids).size).toBe(5);
  });
});
