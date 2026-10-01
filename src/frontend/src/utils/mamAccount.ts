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

export const formatRatio = (ratio: number | null): string => {
  if (ratio === null) return '—';
  if (!Number.isFinite(ratio)) return '∞';
  return ratio.toFixed(2);
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
