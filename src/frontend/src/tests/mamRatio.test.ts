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
  mam: true,
});
const HOUR = 3600;
const freeleech = () => [pick(1, false)];

describe('estimateQueue', () => {
  // 300 up, 100 down: 50 GiB of room before the ratio drops below 2. No slot limit.
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
    expect(estimate?.etas.map((eta) => eta.seconds)).toEqual([0, 150 * HOUR, 0, 0]);
    expect(estimate?.etas.map((eta) => eta.free)).toEqual([false, false, false, true]);
    // 165 GiB down needs 330 up: 30 short, so 50 GB (25,000 BP), 15,000 more at 100 an hour.
    expect(estimate?.etas[1]).toEqual({
      seconds: 150 * HOUR,
      waitsFor: 'ratio',
      credit: { gb: 50, points: 25_000, hours: 150 },
      free: false,
    });
    expect(estimate?.credit).toEqual({ gb: 50, points: 25_000, hours: 150 });
    expect(estimate?.seconds).toBe(150 * HOUR);
  });

  it('counts the credit cumulatively, in queue order', () => {
    const estimate = estimateQueue(base, [[pick(60)], [pick(60)]], {
      ...points,
      balance: 100_000,
    });
    // 160 down: 20 short (50 GB); 220 down: 140 short (150 GB). Both affordable now.
    expect(estimate?.etas.map((eta) => [eta.seconds, eta.credit?.gb])).toEqual([
      [0, 50],
      [0, 150],
    ]);
  });

  it('takes an item at its slowest pick', () => {
    const estimate = estimateQueue(base, [[pick(1), pick(80)]], points);
    expect(estimate?.etas[0]).toMatchObject({ seconds: 400 * HOUR, credit: { gb: 100 } });
  });

  it('lets an ebook-sized download through below the ratio, as the automatic check does', () => {
    const low = { ...base, uploaded_bytes: 150 * GIB };
    const ebook = { sizeBytes: 5e7, chargeBytes: 5e7, mam: true };
    const estimate = estimateQueue(low, [[ebook]], points);
    expect(estimate?.etas[0]).toMatchObject({ seconds: 0, credit: null });
    expect(estimate?.roomBytes).toBe(-25 * GIB);
  });

  it('has no time without the bonus points rate', () => {
    expect(estimateQueue(base, [[pick(80)]], null)?.etas[0]).toMatchObject({
      seconds: null,
      waitsFor: 'ratio',
    });
    expect(estimateQueue(base, [[pick(80)]], { ...points, perHour: null })?.seconds).toBeNull();
  });

  it('needs the account', () => {
    expect(estimateQueue({ available: false }, [[pick(1)]], points)).toBeNull();
  });

  describe('unsatisfied slots', () => {
    // 2 of 10 slots free; two seeding torrents reach 72 hours in 1 and 2 hours.
    const slotted: MamRatioSnapshot = {
      ...base,
      unsat_count: 8,
      unsat_limit: 10,
      unsat_reserve: 0,
      unsat_pending: 0,
    };
    const timing = { freeSeconds: [2 * HOUR, HOUR], pausedSeconds: 0 };

    it('takes the free slots, then each as it frees, then the queue’s own after 72 hours', () => {
      const estimate = estimateQueue(slotted, Array.from({ length: 5 }, freeleech), points, timing);
      expect(estimate?.etas.map((eta) => [eta.seconds, eta.waitsFor])).toEqual([
        [0, null],
        [0, null],
        [HOUR, 'slot'],
        [2 * HOUR, 'slot'],
        [72 * HOUR, 'slot'],
      ]);
    });

    it('lets up next downloads and the kept-free slots go first', () => {
      const full = { ...slotted, unsat_pending: 1, unsat_reserve: 2 };
      const estimate = estimateQueue(full, [freeleech()], points, timing);
      expect(estimate?.etas[0].seconds).toBe(2 * HOUR);
    });

    it('gives a slot to what the ratio lets go first', () => {
      const one = { ...slotted, unsat_count: 9 };
      const estimate = estimateQueue(one, [[pick(60)], [pick(5)]], points, {
        freeSeconds: [],
        pausedSeconds: 0,
      });
      // The 5 GiB one takes the free slot; the 60 GiB one's credit takes 150 hours,
      // by when the 5 GiB one has freed its slot.
      expect(estimate?.etas.map((eta) => [eta.seconds, eta.waitsFor])).toEqual([
        [150 * HOUR, 'ratio'],
        [0, null],
      ]);
    });

    it("doesn't promise a slot past the free ones without the client's timing", () => {
      const estimate = estimateQueue(slotted, [freeleech(), freeleech(), freeleech()], points, {
        freeSeconds: null,
        pausedSeconds: 0,
      });
      expect(estimate?.etas.map((eta) => eta.seconds)).toEqual([0, 0, null]);
      expect(estimate?.etas[2].waitsFor).toBe('slot');
      expect(estimate?.seconds).toBeNull();
    });

    it("waits out MAM's download pause", () => {
      const estimate = estimateQueue(slotted, [freeleech()], points, {
        ...timing,
        pausedSeconds: 5000,
      });
      expect(estimate?.etas[0]).toMatchObject({ seconds: 5000, waitsFor: 'pause' });
    });

    it('ignores slots when the check is off, and for releases not on MAM', () => {
      const off = { ...slotted, unsat_count: 10, unsat_check: false };
      expect(estimateQueue(off, [freeleech()], points, timing)?.etas[0].seconds).toBe(0);
      const full = { ...slotted, unsat_count: 10 };
      const other = [{ sizeBytes: GIB, chargeBytes: 0, mam: false }];
      expect(estimateQueue(full, [other], points, timing)?.etas[0].seconds).toBe(0);
    });
  });
});
