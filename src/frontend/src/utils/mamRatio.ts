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
