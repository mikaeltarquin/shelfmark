import { describe, expect, it } from 'vitest';

import {
  customAmountError,
  formatGib,
  formatPoints,
  formatRatio,
  maxAffordableGb,
  uploadCreditCost,
} from '../utils/mamAccount';

const GIB = 1024 ** 3;

describe('customAmountError', () => {
  it.each(['50', '100', '150', ' 500 '])('accepts %s', (value) => {
    expect(customAmountError(value)).toBeNull();
  });

  it.each([
    ['', 'Enter an amount'],
    ['12.5', 'Whole GB only'],
    ['-50', 'Whole GB only'],
    ['abc', 'Whole GB only'],
    ['25', 'At least 50 GB'],
    ['75', 'Multiples of 50 GB only'],
  ])('rejects "%s"', (value, message) => {
    expect(customAmountError(value)).toBe(message);
  });
});

describe('costs', () => {
  it('prices upload credit at 500 points per GB', () => {
    expect(uploadCreditCost(100)).toBe(50000);
    expect(uploadCreditCost('max')).toBeNull();
  });

  it('rounds the affordable amount down to whole 50 GB steps', () => {
    expect(maxAffordableGb(61250)).toBe(100);
    expect(maxAffordableGb(24999)).toBe(0);
    expect(maxAffordableGb(25000)).toBe(50);
  });
});

describe('formatting', () => {
  it('formats sizes in binary units, negative buffers included', () => {
    expect(formatGib(80.5 * GIB)).toBe('80.5 GiB');
    expect(formatGib(-3.14 * GIB)).toBe('-3.1 GiB');
    expect(formatGib(250 * GIB)).toBe('250 GiB');
    expect(formatGib(1.5 * 1024 * GIB)).toBe('1.50 TiB');
  });

  it('formats ratios and points', () => {
    expect(formatRatio(3.014)).toBe('3.01');
    expect(formatRatio(Infinity)).toBe('∞');
    expect(formatRatio(null)).toBe('—');
    expect(formatPoints(61250.7)).toBe('61,250');
  });
});
