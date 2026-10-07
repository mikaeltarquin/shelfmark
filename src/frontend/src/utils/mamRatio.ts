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

/** One release waiting in the queue: its size, and what it adds to MAM's downloaded total. */
export interface QueuedPick {
  sizeBytes: number;
  chargeBytes: number; // 0 for freeleech and non-MAM releases
}

/** Bonus points and what they buy, from /api/mam/account (admins only). */
export interface QueuePoints {
  balance: number;
  perHour: number | null; // Estimated earning rate; null until there are enough readings
  perGb: number;
  stepGb: number;
}

/**
 * When a queued item fits the ratio: now (`fits`, `free` when nothing counts against it), or
 * once `creditGb` of upload credit is bought with `points` bonus points. `hours` is the wait
 * to earn the points still missing: 0 when there are enough now, null when the rate is unknown.
 */
export type QueueEta =
  | { kind: 'free' }
  | { kind: 'fits' }
  | { kind: 'credit'; creditGb: number; points: number; hours: number | null };

export interface QueueEstimate {
  keepRatio: number;
  roomBytes: number; // Before the queue, after the active downloads
  totalBytes: number; // Every queued release
  chargeBytes: number; // The part that counts against the ratio
  creditGb: number; // Upload credit to buy for all of it to keep the ratio
  points: number; // Bonus points that credit costs
  hours: number | null; // Wait for those points; see QueueEta
  etas: QueueEta[]; // One per item, in queue order
}

const etaRank = (eta: QueueEta): number => {
  if (eta.kind === 'free') return 0;
  if (eta.kind === 'fits') return 1;
  return 2 + eta.creditGb;
};

/**
 * Estimates when each queued item fits the ratio (Keep Ratio At Least). Like the automatic
 * check, a release that fits now goes ahead of an earlier one that doesn't; the rest go in
 * queue order as upload credit, bought with bonus points, makes room. Doesn't know about
 * unsatisfied slots, or a torrent turning freeleech.
 */
export const estimateQueue = (
  snapshot: MamRatioSnapshot,
  items: QueuedPick[][],
  points: QueuePoints | null,
): QueueEstimate | null => {
  if (!snapshot.available) return null;
  const uploaded = positive(snapshot.uploaded_bytes);
  const keepRatio = positive(snapshot.keep_ratio) || 1;
  let downloaded = positive(snapshot.downloaded_bytes) + positive(snapshot.pending_bytes);
  const roomBytes = snapshot.room_bytes ?? Math.floor(uploaded / keepRatio - downloaded);
  const perGb = points?.perGb ?? 500;
  const stepGb = points?.stepGb ?? 50;
  const ratio = (down: number) => (down > 0 ? uploaded / down : Number.POSITIVE_INFINITY);

  // What fits now, in queue order; the rest wait for credit.
  const picks = items.map((item) =>
    item.map((pick): { charge: number; eta: QueueEta | null } => {
      const charge = positive(pick.chargeBytes);
      if (charge === 0) return { charge, eta: { kind: 'free' } };
      const after = ratio(downloaded + charge);
      const small = charge <= SMALL_DOWNLOAD_BYTES && ratio(downloaded) - after < SMALL_RATIO_DROP;
      if (after >= keepRatio || small) {
        downloaded += charge;
        return { charge, eta: { kind: 'fits' } };
      }
      return { charge, eta: null };
    }),
  );

  const creditFor = (down: number) => {
    const shortGb = Math.max(0, keepRatio * down - uploaded) / GIB;
    const creditGb = Math.ceil(shortGb / stepGb) * stepGb;
    const cost = creditGb * perGb;
    let hours: number | null = null;
    if (points && cost <= points.balance) hours = 0;
    else if (points?.perHour) hours = (cost - points.balance) / points.perHour;
    return { creditGb, points: cost, hours };
  };

  let last: QueueEta = { kind: 'fits' };
  for (const item of picks) {
    for (const pick of item) {
      if (pick.eta) continue;
      downloaded += pick.charge;
      pick.eta = { kind: 'credit', ...creditFor(downloaded) };
      last = pick.eta;
    }
  }

  const etas = picks.map((item) =>
    item.reduce<QueueEta>(
      (worst, pick) => (pick.eta && etaRank(pick.eta) > etaRank(worst) ? pick.eta : worst),
      { kind: item.length > 0 && item.every((pick) => pick.charge === 0) ? 'free' : 'fits' },
    ),
  );
  const all = items.flat();
  return {
    keepRatio,
    roomBytes,
    totalBytes: all.reduce((total, pick) => total + positive(pick.sizeBytes), 0),
    chargeBytes: all.reduce((total, pick) => total + positive(pick.chargeBytes), 0),
    creditGb: last.kind === 'credit' ? last.creditGb : 0,
    points: last.kind === 'credit' ? last.points : 0,
    hours: last.kind === 'credit' ? last.hours : 0,
    etas,
  };
};
