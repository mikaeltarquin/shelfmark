/** MyAnonamouse ratio projection and buffer check (shapes of /api/mam/ratio, /buffer-check). */

import type { Release } from '../types';

export interface MamRatioSnapshot {
  available: boolean;
  error?: string;
  uploaded_bytes?: number;
  downloaded_bytes?: number;
  ratio?: number | null;
  buffer_bytes?: number;
  pending_bytes?: number; // Shelfmark's MAM downloads still active
  warning_ratio?: number;
  keep_ratio?: number; // Keep Ratio At Least, or 1.0 when that's off
  room_bytes?: number; // Downloadable before the ratio drops below keep_ratio, after pending
  unsat_count?: number | null;
  unsat_limit?: number | null;
  unsat_pending?: number; // Shelfmark's MAM downloads not yet started
  unsat_reserve?: number; // Slots kept free
  unsat_check?: boolean; // Whether MAM downloads wait for a slot at all
}

export interface MamBufferCheck {
  ok: boolean;
  checked: boolean;
  request_bytes: number;
  pending_bytes: number;
  buffer_bytes: number | null;
  missing_bytes: number;
  recommended_gb: number;
  recommended_cost: number;
  seedbonus: number | null;
  error: string | null;
  can_buy: boolean;
  buffer_ok: boolean;
  unsat_ok: boolean;
  request_count: number;
  unsat_count: number | null;
  unsat_limit: number | null;
  unsat_pending: number;
  unsat_reserve: number;
}

/**
 * Whether another MAM download would have to wait for a slot: the unsatisfied torrents
 * plus Shelfmark's queued ones fill the limit, less the slots kept free.
 */
export const unsatSlotsFull = (snapshot: MamRatioSnapshot | null): boolean => {
  if (!snapshot?.available) return false;
  const { unsat_count: count, unsat_limit: limit } = snapshot;
  if (typeof count !== 'number' || typeof limit !== 'number') return false;
  return count + (snapshot.unsat_pending ?? 0) >= limit - (snapshot.unsat_reserve ?? 0);
};

const positive = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;

/** Whether a release is a MyAnonamouse torrent (tagged by the backend at search time). */
export const isMamRelease = (release: Release): boolean =>
  positive(release.extra?.mam_torrent_id) > 0;

/** Mirrors mam_charge_bytes_for_release: a MAM release's size, 0 when freeleech. */
export const releaseChargeBytes = (release: Release): number => {
  if (!isMamRelease(release) || release.extra?.freeleech === true) return 0;
  return positive(release.size_bytes);
};

export interface RatioProjection {
  currentRatio: number | null;
  projectedRatio: number | null;
  currentBuffer: number;
  projectedBuffer: number;
  pendingBytes: number;
  selectedBytes: number;
  // Unsatisfied torrents now, and once the picks and queued downloads are added.
  unsat: { current: number; projected: number; limit: number; blocked: boolean } | null;
  tone: 'ok' | 'warn' | 'bad';
}

/**
 * The ratio and buffer once the selected releases (and Shelfmark's active MAM
 * downloads) have downloaded: uploaded / (downloaded + pending + selected).
 */
export const projectRatio = (
  snapshot: MamRatioSnapshot,
  releases: Release[],
): RatioProjection | null => {
  if (!snapshot.available || !releases.some(isMamRelease)) return null;
  const uploaded = positive(snapshot.uploaded_bytes);
  const downloaded = positive(snapshot.downloaded_bytes);
  const pending = positive(snapshot.pending_bytes);
  const selected = releases.reduce((total, release) => total + releaseChargeBytes(release), 0);
  const totalDownloaded = downloaded + pending + selected;
  const projectedRatio = totalDownloaded > 0 ? uploaded / totalDownloaded : null;
  const currentBuffer = snapshot.buffer_bytes ?? uploaded - downloaded;
  const projectedBuffer = currentBuffer - pending - selected;
  const warning = snapshot.warning_ratio ?? 2;

  let unsat: RatioProjection['unsat'] = null;
  if (typeof snapshot.unsat_count === 'number' && typeof snapshot.unsat_limit === 'number') {
    const picked = releases.filter(isMamRelease).length;
    const projected = snapshot.unsat_count + (snapshot.unsat_pending ?? 0) + picked;
    unsat = {
      current: snapshot.unsat_count,
      projected,
      limit: snapshot.unsat_limit,
      blocked: projected > snapshot.unsat_limit - (snapshot.unsat_reserve ?? 0),
    };
  }

  let tone: RatioProjection['tone'] = 'ok';
  if (
    projectedBuffer < 0 ||
    (projectedRatio !== null && projectedRatio < 1) ||
    unsat?.blocked === true
  ) {
    tone = 'bad';
  } else if (projectedRatio !== null && projectedRatio < warning) {
    tone = 'warn';
  }
  return {
    currentRatio: snapshot.ratio ?? null,
    projectedRatio,
    currentBuffer,
    projectedBuffer,
    pendingBytes: pending,
    selectedBytes: selected,
    unsat,
    tone,
  };
};

const GIB = 1024 ** 3;
// Mirrors saved_autoget: an ebook-sized download that barely moves the ratio goes anyway.
const SMALL_DOWNLOAD_BYTES = 100 * 1024 ** 2;
const SMALL_RATIO_DROP = 0.01;
// MAM counts a torrent satisfied once it has seeded this long, freeing its slot.
const UNSAT_SEED_SECONDS = 72 * 3600;

/** One release waiting in the queue. */
export interface QueuedPick {
  sizeBytes: number;
  chargeBytes: number; // What it adds to MAM's downloaded total: 0 for freeleech and non-MAM
  mam: boolean; // A MAM torrent, so it takes an unsatisfied slot (freeleech too)
}

/** Bonus points and what they buy, from /api/mam/account (admins only). */
export interface QueuePoints {
  balance: number;
  perHour: number | null; // Estimated earning rate; null until there are enough readings
  perGb: number;
  stepGb: number;
}

/** When unsatisfied slots free up, from /api/mam/unsat-timing. */
export interface QueueSlots {
  // Until each seeding unsatisfied torrent reaches 72 hours, soonest first; null when the
  // torrent client can't say, so only the slots free now are known.
  freeSeconds: number[] | null;
  pausedSeconds: number; // MAM's download pause still to run, 0 when none
}

/** Upload credit that keeps the ratio, counting the picks ahead; `hours` as on QueueEta. */
export interface QueueCredit {
  gb: number;
  points: number;
  hours: number | null; // To earn the points still missing: 0 when there are enough now
}

/**
 * When a queued item can start: `seconds` from now (0 now, null when it can't be told),
 * and what sets it when it isn't now. `credit` is the upload credit it needs, if any;
 * `free` when none of it counts against the ratio.
 */
export interface QueueEta {
  seconds: number | null;
  waitsFor: 'ratio' | 'slot' | 'pause' | null;
  credit: QueueCredit | null;
  free: boolean;
}

export interface QueueEstimate {
  keepRatio: number;
  roomBytes: number; // Before the queue, after the active downloads
  totalBytes: number; // Every queued release
  chargeBytes: number; // The part that counts against the ratio
  credit: QueueCredit | null; // For all of it to keep the ratio
  seconds: number | null; // Until the last of it can start
  etas: QueueEta[]; // One per item, in queue order
}

interface PickPlan {
  index: number; // Place in the queue, across items
  mam: boolean;
  charge: number;
  credit: QueueCredit | null;
  ratioSeconds: number | null; // When the ratio lets it go
  eta: QueueEta;
}

// Later is worse; never (null) is worst.
const laterThan = (a: number | null, b: number | null): boolean =>
  a === null ? b !== null : b !== null && a > b;

/**
 * The slots MAM picks can take, as seconds from now: one at 0 for each free now, then one
 * as each seeding torrent reaches 72 hours. Up next downloads take the first ones.
 */
const slotTimes = (snapshot: MamRatioSnapshot, slots: QueueSlots | null): number[] | null => {
  const { unsat_count: count, unsat_limit: limit } = snapshot;
  if (snapshot.unsat_check === false || typeof count !== 'number' || typeof limit !== 'number') {
    return null; // Nothing to wait for
  }
  const free = limit - (snapshot.unsat_reserve ?? 0) - count - (snapshot.unsat_pending ?? 0);
  const freeing = (slots?.freeSeconds ?? []).toSorted((a, b) => a - b);
  return [
    ...Array.from({ length: Math.max(free, 0) }, () => 0),
    ...freeing.slice(Math.max(-free, 0)),
  ];
};

/**
 * Estimates when each queued item can start, as the automatic check would get to it:
 * once the ratio (Keep Ratio At Least) allows and an unsatisfied slot is free.
 *
 * Ratio: a release that fits now goes ahead of an earlier one that doesn't; the rest go
 * in queue order as upload credit, bought with bonus points, makes room. Slots: free
 * ones first, then as seeding torrents reach 72 hours, each grab freeing its own 72 hours
 * after it starts. Doesn't know about a torrent turning freeleech.
 */
export const estimateQueue = (
  snapshot: MamRatioSnapshot,
  items: QueuedPick[][],
  points: QueuePoints | null,
  slots: QueueSlots | null = null,
): QueueEstimate | null => {
  if (!snapshot.available) return null;
  const uploaded = positive(snapshot.uploaded_bytes);
  const keepRatio = positive(snapshot.keep_ratio) || 1;
  let downloaded = positive(snapshot.downloaded_bytes) + positive(snapshot.pending_bytes);
  const roomBytes = snapshot.room_bytes ?? Math.floor(uploaded / keepRatio - downloaded);
  const perGb = points?.perGb ?? 500;
  const stepGb = points?.stepGb ?? 50;
  const ratio = (down: number) => (down > 0 ? uploaded / down : Number.POSITIVE_INFINITY);
  const creditFor = (down: number): QueueCredit => {
    const shortGb = Math.max(0, keepRatio * down - uploaded) / GIB;
    const gb = Math.ceil(shortGb / stepGb) * stepGb;
    const cost = gb * perGb;
    let hours: number | null = null;
    if (points && cost <= points.balance) hours = 0;
    else if (points?.perHour) hours = (cost - points.balance) / points.perHour;
    return { gb, points: cost, hours };
  };

  let index = 0;
  const plans: PickPlan[][] = items.map((item) =>
    item.map((pick) => ({
      index: index++,
      mam: pick.mam,
      charge: positive(pick.chargeBytes),
      credit: null,
      ratioSeconds: 0,
      eta: { seconds: 0, waitsFor: null, credit: null, free: positive(pick.chargeBytes) === 0 },
    })),
  );
  const all = plans.flat();

  // Ratio: what fits now goes, in queue order; the rest wait for credit, in queue order.
  const waiting = all.filter((plan) => {
    if (plan.charge === 0) return false;
    const after = ratio(downloaded + plan.charge);
    const small =
      plan.charge <= SMALL_DOWNLOAD_BYTES && ratio(downloaded) - after < SMALL_RATIO_DROP;
    if (after < keepRatio && !small) return true;
    downloaded += plan.charge;
    return false;
  });
  let lastCredit: QueueCredit | null = null;
  for (const plan of waiting) {
    downloaded += plan.charge;
    plan.credit = creditFor(downloaded);
    plan.ratioSeconds = plan.credit.hours === null ? null : plan.credit.hours * 3600;
    lastCredit = plan.credit;
  }

  // Slots: each MAM pick, in the order the ratio lets them go, takes the soonest one.
  const times = slotTimes(snapshot, slots);
  const paused = positive(slots?.pausedSeconds);
  const mamPicks = all
    .filter((plan) => plan.mam)
    .toSorted(
      (a, b) =>
        (a.ratioSeconds ?? Number.POSITIVE_INFINITY) -
          (b.ratioSeconds ?? Number.POSITIVE_INFINITY) || a.index - b.index,
    );
  for (const plan of all) {
    plan.eta = { ...plan.eta, credit: plan.credit, seconds: plan.ratioSeconds };
    if (plan.ratioSeconds !== 0) plan.eta.waitsFor = 'ratio';
  }
  if (times) {
    for (const plan of mamPicks) {
      if (plan.ratioSeconds === null) continue; // Never gets as far as a slot
      const slot = times.shift();
      if (slot === undefined) {
        plan.eta = { ...plan.eta, seconds: null, waitsFor: 'slot' };
        continue;
      }
      const start = Math.max(plan.ratioSeconds, slot, paused);
      let waitsFor: QueueEta['waitsFor'] = null;
      if (start > 0 && start === paused) waitsFor = 'pause';
      else if (start > 0 && start === slot && slot > plan.ratioSeconds) waitsFor = 'slot';
      else if (start > 0) waitsFor = 'ratio';
      plan.eta = { ...plan.eta, seconds: start, waitsFor };
      // Its own slot frees once it has seeded 72 hours; without the client's timing the
      // others' are unknown too, so a slot past the free ones isn't promised at all.
      if (slots?.freeSeconds) {
        times.push(start + UNSAT_SEED_SECONDS);
        times.sort((a, b) => a - b);
      }
    }
  }

  // An item starts when its last pick does.
  const etas = plans.map((item) =>
    item.reduce<QueueEta>(
      (worst, plan) => {
        const later = laterThan(plan.eta.seconds, worst.seconds) ? plan.eta : worst;
        const credit =
          plan.credit && (!worst.credit || plan.credit.gb > worst.credit.gb)
            ? plan.credit
            : worst.credit;
        return { ...later, credit, free: worst.free && plan.eta.free };
      },
      { seconds: 0, waitsFor: null, credit: null, free: true },
    ),
  );
  const picks = items.flat();
  return {
    keepRatio,
    roomBytes,
    totalBytes: picks.reduce((total, pick) => total + positive(pick.sizeBytes), 0),
    chargeBytes: picks.reduce((total, pick) => total + positive(pick.chargeBytes), 0),
    credit: lastCredit,
    seconds: etas.reduce<number | null>(
      (latest, eta) => (laterThan(eta.seconds, latest) ? eta.seconds : latest),
      0,
    ),
    etas,
  };
};
