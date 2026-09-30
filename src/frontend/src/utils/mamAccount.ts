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
  fetched_at: number;
}

export interface MamAccountResponse {
  configured: boolean;
  stats: MamStats | null;
  error: string | null;
  points_per_gb?: number;
  step_gb?: number;
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
