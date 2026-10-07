import { describe, expect, it } from 'vitest';

import type { Release } from '../types';
import {
  estimateQueue,
  projectRatio,
  releaseChargeBytes,
  unsatSlotsFull,
  type MamRatioSnapshot,
} from '../utils/mamRatio';

const GIB = 1024 ** 3;

const MAM_EXTRA: Record<string, unknown> = { mam_torrent_id: 1 };

const release = (gib: number, extra: Record<string, unknown> = MAM_EXTRA): Release => ({
  source: 'prowlarr',
  source_id: `r${gib}`,
  title: 'Book',
  size_bytes: gib * GIB,
  extra,
});

const snapshot: MamRatioSnapshot = {
  available: true,
  uploaded_bytes: 300 * GIB,
  downloaded_bytes: 100 * GIB,
  ratio: 3,
  buffer_bytes: 200 * GIB,
  pending_bytes: 0,
  warning_ratio: 2,
};

describe('releaseChargeBytes', () => {
  it('charges MAM releases their size unless freeleech', () => {
    expect(releaseChargeBytes(release(2))).toBe(2 * GIB);
    expect(releaseChargeBytes(release(2, { mam_torrent_id: 1, freeleech: true }))).toBe(0);
    expect(releaseChargeBytes(release(2, {}))).toBe(0);
  });
});

describe('projectRatio', () => {
  it('projects ratio and buffer after the picked downloads', () => {
    const projection = projectRatio(snapshot, [release(20), release(30)]);
    expect(projection?.projectedRatio).toBeCloseTo(2);
    expect(projection?.projectedBuffer).toBe(150 * GIB);
    expect(projection?.tone).toBe('ok');
  });

  it('counts downloads still in progress', () => {
    const projection = projectRatio({ ...snapshot, pending_bytes: 50 * GIB }, [release(10)]);
    expect(projection?.projectedRatio).toBeCloseTo(300 / 160);
    expect(projection?.projectedBuffer).toBe(140 * GIB);
    expect(projection?.tone).toBe('warn');
  });

  it('warns red when the buffer would run out', () => {
    expect(projectRatio(snapshot, [release(250)])?.tone).toBe('bad');
  });

  it('is hidden without a MAM release or account figures', () => {
    expect(projectRatio(snapshot, [release(5, {})])).toBeNull();
    expect(projectRatio({ available: false }, [release(5)])).toBeNull();
  });

  it('leaves the ratio unchanged for freeleech picks', () => {
    const projection = projectRatio(snapshot, [release(5, { mam_torrent_id: 1, freeleech: true })]);
    expect(projection?.projectedRatio).toBeCloseTo(3);
    expect(projection?.selectedBytes).toBe(0);
  });
});

describe('unsatisfied projection', () => {
  const withUnsat: MamRatioSnapshot = {
    ...snapshot,
    unsat_count: 90,
    unsat_limit: 100,
    unsat_pending: 2,
    unsat_reserve: 5,
  };

  it('adds queued downloads and every MAM pick, freeleech included', () => {
    const projection = projectRatio(withUnsat, [
      release(1),
      release(1, { mam_torrent_id: 2, freeleech: true }),
      release(1, {}),
    ]);
    expect(projection?.unsat).toEqual({ current: 90, projected: 94, limit: 100, blocked: false });
    expect(projection?.tone).toBe('ok');
  });

  it('turns red once the slots kept free would be used', () => {
    const projection = projectRatio(withUnsat, [release(1), release(1), release(1), release(1)]);
    expect(projection?.unsat?.blocked).toBe(true);
    expect(projection?.tone).toBe('bad');
  });

  it('is left out when MAM reports no limit', () => {
    expect(projectRatio(snapshot, [release(1)])?.unsat).toBeNull();
  });
});

const slotsSnapshot = (fields: Partial<MamRatioSnapshot>): MamRatioSnapshot => ({
  available: true,
  unsat_count: 8,
  unsat_limit: 10,
  unsat_pending: 0,
  unsat_reserve: 0,
  ...fields,
});

describe('unsatSlotsFull', () => {
  it('is full once unsatisfied and queued torrents reach the limit less the kept slots', () => {
    expect(unsatSlotsFull(slotsSnapshot({}))).toBe(false);
    expect(unsatSlotsFull(slotsSnapshot({ unsat_count: 10 }))).toBe(true);
    expect(unsatSlotsFull(slotsSnapshot({ unsat_pending: 2 }))).toBe(true);
    expect(unsatSlotsFull(slotsSnapshot({ unsat_reserve: 2 }))).toBe(true);
  });

  it('is not full when the counts are unknown', () => {
    expect(unsatSlotsFull(null)).toBe(false);
    expect(unsatSlotsFull({ available: false })).toBe(false);
    expect(unsatSlotsFull(slotsSnapshot({ unsat_limit: null }))).toBe(false);
  });
});

const pick = (gib: number, charged = true) => ({
  sizeBytes: gib * GIB,
  chargeBytes: charged ? gib * GIB : 0,
});

describe('estimateQueue', () => {
  // 300 up, 100 down: 50 GiB of room before the ratio drops below 2.
  const base: MamRatioSnapshot = { ...snapshot, keep_ratio: 2 };
  const points = { balance: 10_000, perHour: 100, perGb: 500, stepGb: 50 };

  it('lets what fits go first, and prices the rest in upload credit and hours', () => {
    const estimate = estimateQueue(
      base,
      [[pick(20)], [pick(40)], [pick(5)], [pick(3, false)]],
      points,
    );
    expect(estimate?.roomBytes).toBe(50 * GIB);
    expect(estimate?.totalBytes).toBe(68 * GIB);
    expect(estimate?.chargeBytes).toBe(65 * GIB);
    // The 40 GiB one waits; the 5 GiB one behind it fits and goes ahead.
    expect(estimate?.etas.map((eta) => eta.kind)).toEqual(['fits', 'credit', 'fits', 'free']);
    // 165 GiB down needs 330 up: 30 short, so 50 GB (25,000 BP), 15,000 more at 100 an hour.
    expect(estimate?.etas[1]).toEqual({ kind: 'credit', creditGb: 50, points: 25_000, hours: 150 });
    expect(estimate).toMatchObject({ creditGb: 50, points: 25_000, hours: 150 });
  });

  it('counts the credit cumulatively, in queue order', () => {
    const estimate = estimateQueue(base, [[pick(60)], [pick(60)]], {
      ...points,
      balance: 100_000,
    });
    // 160 down: 20 short (50 GB); 220 down: 140 short (150 GB).
    expect(estimate?.etas).toEqual([
      { kind: 'credit', creditGb: 50, points: 25_000, hours: 0 },
      { kind: 'credit', creditGb: 150, points: 75_000, hours: 0 },
    ]);
  });

  it('takes an item at its slowest pick', () => {
    const estimate = estimateQueue(base, [[pick(1), pick(80)]], points);
    expect(estimate?.etas[0]).toMatchObject({ kind: 'credit', creditGb: 100 });
  });

  it('lets an ebook-sized download through below the ratio, as the automatic check does', () => {
    const low = { ...base, uploaded_bytes: 150 * GIB };
    const estimate = estimateQueue(low, [[{ sizeBytes: 5e7, chargeBytes: 5e7 }]], points);
    expect(estimate?.etas[0]).toEqual({ kind: 'fits' });
    expect(estimate?.roomBytes).toBe(-25 * GIB);
  });

  it('has no wait without the bonus points rate', () => {
    expect(estimateQueue(base, [[pick(80)]], null)?.etas[0]).toMatchObject({ hours: null });
    expect(estimateQueue(base, [[pick(80)]], { ...points, perHour: null })?.etas[0]).toMatchObject({
      hours: null,
    });
  });

  it('needs the account', () => {
    expect(estimateQueue({ available: false }, [[pick(1)]], points)).toBeNull();
  });
});
