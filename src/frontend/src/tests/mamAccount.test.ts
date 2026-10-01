import { describe, expect, it } from 'vitest';

import {
  customAmountError,
  describeAutobuy,
  describeCheck,
  formatGib,
  formatPoints,
  formatRatio,
  maxAffordableGb,
  uploadCreditCost,
  formatUnsat,
  mamProfileUrl,
  ratioTone,
  unsatTone,
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

describe('auto-buy descriptions', () => {
  const settings = {
    ratio_enabled: true,
    ratio_threshold: 2,
    ratio_amount: 50,
    buffer_enabled: false,
    buffer_threshold_gb: 10,
    buffer_amount: 50,
    bonus_enabled: true,
    bonus_threshold: 50000,
    bonus_amount: 100,
    reserve_points: 5000,
    interval_hours: 6,
  };

  it('lists the modes that are on', () => {
    expect(describeAutobuy(settings)).toEqual([
      'Ratio below 2 → buy 50 GB',
      'Bonus points at 50,000 or more → buy 100 GB, repeatedly',
      'Always keeps 5,000 points',
    ]);
    expect(describeAutobuy({ ...settings, ratio_enabled: false, bonus_enabled: false })).toEqual(
      [],
    );
  });

  it('summarises a check', () => {
    const base = { at: 0, trigger: 'schedule', skipped: null, notes: [] };
    expect(describeCheck({ ...base, purchases: [] })).toBe('Nothing needed buying');
    expect(
      describeCheck({
        ...base,
        purchases: [
          { reason: 'bonus', amount_gb: 50, success: true, error: null },
          { reason: 'bonus', amount_gb: 0, success: false, error: 'Not enough bonus points' },
        ],
      }),
    ).toBe('Bought 50 GB; stopped: Not enough bonus points');
    expect(describeCheck({ ...base, purchases: [], skipped: 'No auto-buy mode is on' })).toBe(
      'No auto-buy mode is on',
    );
  });
});

describe('header ratio and unsatisfied', () => {
  it('formats the unsatisfied count with its limit', () => {
    expect(formatUnsat(4, 50)).toBe('4 / 50');
    expect(formatUnsat(4, null)).toBe('4');
    expect(formatUnsat(null, 50)).toBe('—');
  });

  it('warns near and past the limits', () => {
    expect(unsatTone(10, 50)).toBeUndefined();
    expect(unsatTone(45, 50)).toContain('amber');
    expect(unsatTone(50, 50)).toContain('red');
    expect(ratioTone(5)).toBeUndefined();
    expect(ratioTone(1.5)).toContain('amber');
    expect(ratioTone(0.8)).toContain('red');
    expect(ratioTone(Infinity)).toBeUndefined();
  });
});

describe('mamProfileUrl', () => {
  it("links the account's profile, or the site without an id", () => {
    expect(mamProfileUrl(123456)).toBe('https://www.myanonamouse.net/u/123456');
    expect(mamProfileUrl(null)).toBe('https://www.myanonamouse.net');
    expect(mamProfileUrl(undefined)).toBe('https://www.myanonamouse.net');
  });
});
