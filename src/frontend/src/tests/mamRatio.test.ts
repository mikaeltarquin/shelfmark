import { describe, expect, it } from 'vitest';

import type { Release } from '../types';
import { projectRatio, releaseChargeBytes, type MamRatioSnapshot } from '../utils/mamRatio';

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
