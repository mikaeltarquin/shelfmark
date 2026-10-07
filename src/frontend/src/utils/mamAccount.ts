/** MyAnonamouse account: shapes of /api/mam/* and helpers for the account panel. */

export interface MamStats {
  username: string | null;
  classname: string | null;
  uploaded_bytes: number;
  downloaded_bytes: number;
  buffer_bytes: number;
  ratio: number | null;
  seedbonus: number;
  vip_until: string | null;
  unsat_count: number | null; // Torrents not yet seeded 72 hours
  unsat_limit: number | null; // How many the user class allows
  uid?: number | null; // The account's user id
  fetched_at: number;
}

export interface MamAccountResponse {
  configured: boolean;
  stats: MamStats | null;
  error: string | null;
  points_per_gb?: number;
  step_gb?: number;
  // Estimated from Shelfmark's own balance readings; MAM's API has no rate.
  points_per_hour?: { per_hour: number; hours: number } | null;
  pending_bytes?: number; // Shelfmark's MAM downloads still active
  keep_ratio?: number; // Keep Ratio At Least, or 1.0 when that's off
  // Downloadable before the ratio drops below keep_ratio, after the active downloads
  room_bytes?: number;
}

export interface MamConnection {
  configured: boolean;
  ok: boolean;
  message: string;
  name?: string | null;
}

export interface MamStatusResponse {
  mam: MamConnection;
  torrent_client: MamConnection;
}

export interface MamPurchaseResponse extends MamAccountResponse {
  success: boolean;
  amount_gb: number;
  seedbonus: number | null;
}

export type UploadCreditAmount = number | 'max';

export interface MamAutobuySettings {
  ratio_enabled: boolean;
  ratio_threshold: number;
  ratio_amount: number;
  buffer_enabled: boolean;
  buffer_threshold_gb: number;
  buffer_amount: number;
  bonus_enabled: boolean;
  bonus_threshold: number;
  bonus_amount: number;
  reserve_points: number;
  interval_hours: number;
}

export interface MamCheckReport {
  at: number;
  trigger: string;
  skipped: string | null;
  purchases: { reason: string; amount_gb: number; success: boolean; error: string | null }[];
  notes: string[];
}

export interface MamPurchaseRecord {
  at: number;
  reason: string;
  requested: string;
  amount_gb: number;
  success: boolean;
  seedbonus: number | null;
  error: string | null;
}

export interface MamAutobuyResponse {
  settings?: MamAutobuySettings;
  last_check: MamCheckReport | null;
  history: MamPurchaseRecord[];
}

/** One line per auto-buy mode that is on, e.g. "Ratio below 2 → buy 50 GB". */
export const describeAutobuy = (settings: MamAutobuySettings): string[] => {
  const lines: string[] = [];
  if (settings.ratio_enabled) {
    lines.push(`Ratio below ${settings.ratio_threshold} → buy ${settings.ratio_amount} GB`);
  }
  if (settings.buffer_enabled) {
    lines.push(
      `Buffer below ${settings.buffer_threshold_gb} GB → buy ${settings.buffer_amount} GB`,
    );
  }
  if (settings.bonus_enabled) {
    lines.push(
      `Bonus points at ${formatPoints(settings.bonus_threshold)} or more → buy ${settings.bonus_amount} GB, repeatedly`,
    );
  }
  if (lines.length > 0 && settings.reserve_points > 0) {
    lines.push(`Always keeps ${formatPoints(settings.reserve_points)} points`);
  }
  return lines;
};

const REASON_LABELS: Record<string, string> = {
  manual: 'Manual',
  download: 'Before download',
  ratio: 'Low ratio',
  buffer: 'Low buffer',
  bonus: 'Excess points',
};

export const purchaseReasonLabel = (reason: string): string => REASON_LABELS[reason] ?? reason;

/** A report's outcome in one line. */
export const describeCheck = (report: MamCheckReport): string => {
  if (report.skipped) return report.skipped;
  const bought = report.purchases.filter((p) => p.success).reduce((t, p) => t + p.amount_gb, 0);
  const failed = report.purchases.find((p) => !p.success);
  const parts = [bought > 0 ? `Bought ${bought} GB` : 'Nothing needed buying'];
  if (failed) parts.push(`stopped: ${failed.error ?? 'purchase failed'}`);
  parts.push(...report.notes);
  return parts.join('; ');
};

export const UPLOAD_CREDIT_PRESETS_GB = [50, 100, 250, 500] as const;
export const DEFAULT_POINTS_PER_GB = 500;
export const DEFAULT_STEP_GB = 50;

const GIB = 1024 ** 3;

/** "80.5 GiB", "1.52 TiB", "-3.1 GiB" (a negative buffer). */
export const formatGib = (bytes: number): string => {
  const sign = bytes < 0 ? '-' : '';
  const gib = Math.abs(bytes) / GIB;
  if (gib >= 1024) {
    return `${sign}${(gib / 1024).toFixed(2)} TiB`;
  }
  return `${sign}${gib.toFixed(gib >= 100 ? 0 : 1)} GiB`;
};

/** The Room stat's tooltip: what it measures, and the plain buffer behind it. */
export const describeRoom = (
  keepRatio: number,
  bufferBytes: number,
  pendingBytes: number,
): string => {
  const lines = [
    keepRatio > 1
      ? `How much more can be downloaded (not freeleech) before the ratio drops below ${formatRatio(keepRatio)}, your Keep Ratio At Least setting.`
      : 'How much more can be downloaded (not freeleech) before the ratio drops below 1.00. Set Keep Ratio At Least to measure to a higher ratio.',
  ];
  if (pendingBytes > 0) {
    lines.push(`Counts the ${formatGib(pendingBytes)} Shelfmark's active MAM downloads will add.`);
  }
  lines.push(`Buffer (uploaded minus downloaded): ${formatGib(bufferBytes)}`);
  return lines.join('\n');
};

export const formatRatio = (ratio: number | null): string => {
  if (ratio === null) return '—';
  if (!Number.isFinite(ratio)) return '∞';
  return ratio.toFixed(2);
};

export const MAM_SITE_URL = 'https://www.myanonamouse.net';
export const MAM_STORE_URL = `${MAM_SITE_URL}/store.php`;

/** The account's profile page on MyAnonamouse, or the site when its id isn't known. */
export const mamProfileUrl = (uid: number | null | undefined): string =>
  uid ? `${MAM_SITE_URL}/u/${uid}` : MAM_SITE_URL;

/** When unsatisfied torrents free their slots, from the torrent client (/api/mam/unsat-timing). */
export interface MamUnsatTiming {
  available: boolean;
  reason?: string; // Why there's no timing (no client, client can't report it...)
  client?: string | null;
  next_seconds?: number | null; // Until the next torrent reaches 72 hours seeded
  within_window?: number; // Torrents reaching 72 hours within window_hours
  window_hours?: number;
  seeding?: number; // MAM torrents seeding but not yet at 72 hours
  downloading?: number; // Still downloading: their 72 hours haven't started
  // Until MAM allows downloads again, after a grab past the unsatisfied limit froze them
  frozen_seconds?: number | null;
  frozen_source?: 'detected' | 'manual' | null; // Read from MAM's refusal, or entered by hand
  announce_problem?: string | null; // MAM is rejecting the client's announces
}

/** Seconds as h:mm ("2:05"), rounded up so a slot is never promised early. */
export const formatHoursMinutes = (seconds: number): string => {
  const minutes = Math.max(0, Math.ceil(seconds / 60));
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
};

/** A wait in hours, roughly: "under 1 h", "14 h", "3 d 4 h", "5 weeks". */
export const formatWait = (hours: number): string => {
  if (hours < 1) return 'under 1 h';
  const total = Math.ceil(hours);
  if (total < 48) return `${total} h`;
  const days = Math.floor(total / 24);
  const rest = total % 24;
  if (days >= 28) return `${Math.round(total / 168)} weeks`;
  if (days >= 7) return `${Math.round(total / 24)} d`;
  return rest > 0 ? `${days} d ${rest} h` : `${days} d`;
};

/** A live countdown: "2:05:13", or "4:09" under an hour. */
export const formatCountdown = (seconds: number): string => {
  const total = Math.max(0, Math.ceil(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
};

/** "Next slot in 2:05 · 2 slots in the next 6 hours", or why there's nothing to wait for. */
export const describeUnsatTiming = (timing: MamUnsatTiming | null): string | null => {
  if (!timing?.available) return null;
  const hours = timing.window_hours ?? 6;
  if (timing.next_seconds === null || timing.next_seconds === undefined) {
    return timing.downloading
      ? `No slot frees up until a download finishes and seeds 72 hours`
      : 'No unsatisfied torrents seeding in your client';
  }
  const count = timing.within_window ?? 0;
  const slots = `${count} slot${count === 1 ? '' : 's'} in the next ${hours} hours`;
  return `Next slot in ${formatHoursMinutes(timing.next_seconds)} · ${slots}`;
};

/** Why MAM downloads are on hold whatever the free slots, or null. */
export const describeMamHold = (timing: MamUnsatTiming | null): string | null => {
  if (timing?.frozen_seconds) {
    return `MyAnonamouse has paused downloads (unsatisfied limit) · allowed again in ${formatHoursMinutes(
      timing.frozen_seconds,
    )}`;
  }
  return timing?.announce_problem ?? null;
};

/** Red at or past the unsatisfied limit, amber within 10% of it. */
export const unsatTone = (count: number | null, limit: number | null): string | undefined => {
  if (count === null || limit === null) return undefined;
  if (count >= limit) return 'text-red-600 dark:text-red-400';
  if (count >= limit * 0.9) return 'text-amber-600 dark:text-amber-400';
  return undefined;
};

/** Red below 1, amber below 2. */
export const ratioTone = (ratio: number | null): string | undefined => {
  if (ratio === null || !Number.isFinite(ratio)) return undefined;
  if (ratio < 1) return 'text-red-600 dark:text-red-400';
  if (ratio < 2) return 'text-amber-600 dark:text-amber-400';
  return undefined;
};

/** "4 / 50", or "4" when the limit isn't known. */
export const formatUnsat = (count: number | null, limit: number | null): string =>
  count === null ? '—' : `${count}${limit !== null ? ` / ${limit}` : ''}`;

export const formatPoints = (points: number): string => Math.floor(points).toLocaleString('en-US');

/**
 * Why a custom amount can't be bought, or null when it can: whole GB, at least one
 * step, in multiples of the step (MAM's store sells 50 GB and 100 GB).
 */
export const customAmountError = (value: string, stepGb = DEFAULT_STEP_GB): string | null => {
  const trimmed = value.trim();
  if (!trimmed) return 'Enter an amount';
  if (!/^\d+$/.test(trimmed)) return 'Whole GB only';
  const amount = Number(trimmed);
  if (amount < stepGb) return `At least ${stepGb} GB`;
  if (amount % stepGb !== 0) return `Multiples of ${stepGb} GB only`;
  return null;
};

/** Bonus points an amount costs, or null for "max affordable" (MAM decides). */
export const uploadCreditCost = (
  amount: UploadCreditAmount,
  pointsPerGb = DEFAULT_POINTS_PER_GB,
): number | null => (amount === 'max' ? null : amount * pointsPerGb);

/** Largest amount the bonus points cover, in whole steps. */
export const maxAffordableGb = (
  seedbonus: number,
  pointsPerGb = DEFAULT_POINTS_PER_GB,
  stepGb = DEFAULT_STEP_GB,
): number => Math.floor(seedbonus / pointsPerGb / stepGb) * stepGb;
