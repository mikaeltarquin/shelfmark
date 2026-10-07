import { useState } from 'react';

import { getMamAccount, getMamRatio, getMamUnsatTiming } from '../services/api';
import type { MamRatioSnapshot, QueuePoints, QueueSlots } from '../utils/mamRatio';
import { useDependencyEffect } from './useMountEffect';

export interface MamQueueData {
  snapshot: MamRatioSnapshot | null;
  points: QueuePoints | null; // Admins only: bonus points are kept from other users
  slots: QueueSlots | null;
}

const EMPTY: MamQueueData = { snapshot: null, points: null, slots: null };

/**
 * The MAM ratio, slot timing and, for admins, bonus points the Queued page estimates from.
 * Read while `enabled`, again whenever `refreshKey` changes (the queue moved).
 */
export const useMamQueue = (
  enabled: boolean,
  canSeePoints: boolean,
  refreshKey: string,
): MamQueueData => {
  const [data, setData] = useState<MamQueueData>(EMPTY);

  useDependencyEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    const pointsRequest: Promise<QueuePoints | null> = canSeePoints
      ? getMamAccount()
          .then((account) =>
            account.stats
              ? {
                  balance: account.stats.seedbonus,
                  perHour: account.points_per_hour?.per_hour ?? null,
                  perGb: account.points_per_gb ?? 500,
                  stepGb: account.step_gb ?? 50,
                }
              : null,
          )
          .catch(() => null)
      : Promise.resolve(null);
    const slotsRequest: Promise<QueueSlots | null> = getMamUnsatTiming()
      .then((timing) => ({
        freeSeconds: timing.available ? (timing.free_seconds ?? null) : null,
        pausedSeconds: timing.frozen_seconds ?? 0,
      }))
      .catch(() => null);
    void Promise.all([getMamRatio().catch(() => null), pointsRequest, slotsRequest]).then(
      ([snapshot, points, slots]) => {
        if (!cancelled) setData({ snapshot, points, slots });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [enabled, canSeePoints, refreshKey]);

  return enabled ? data : EMPTY;
};
