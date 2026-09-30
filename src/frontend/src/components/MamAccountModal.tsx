import { useCallback, useState } from 'react';

import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { useMountEffect } from '../hooks/useMountEffect';
import { buyMamUploadCredit, getMamAccount, getMamStatus } from '../services/api';
import {
  customAmountError,
  DEFAULT_POINTS_PER_GB,
  DEFAULT_STEP_GB,
  formatGib,
  formatPoints,
  formatRatio,
  maxAffordableGb,
  UPLOAD_CREDIT_PRESETS_GB,
  uploadCreditCost,
  type MamAccountResponse,
  type MamConnection,
  type MamStatusResponse,
  type UploadCreditAmount,
} from '../utils/mamAccount';

// Mounted only while open, so each opening starts fresh and loads once.
interface MamAccountModalProps {
  onClose: () => void;
}

type Choice = number | 'max' | 'custom';

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : 'Request failed';

const Stat = ({ label, value, tone }: { label: string; value: string; tone?: string }) => (
  <div className="rounded-xl border border-(--border-muted) bg-(--bg-soft) px-3 py-2.5">
    <p className="text-xs tracking-wide uppercase opacity-60">{label}</p>
    <p className={`mt-0.5 text-base font-semibold tabular-nums ${tone ?? ''}`}>{value}</p>
  </div>
);

const ConnectionRow = ({
  label,
  connection,
}: {
  label: string;
  connection: MamConnection | null;
}) => {
  let dot = 'bg-zinc-400';
  let text = 'Checking…';
  if (connection) {
    dot = connection.ok ? 'bg-emerald-500' : 'bg-red-500';
    text = connection.message;
  }
  return (
    <li className="flex items-start gap-3 py-2">
      <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs wrap-break-word opacity-70">{text}</p>
      </div>
    </li>
  );
};

const chipClass = (selected: boolean) =>
  `rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
    selected
      ? 'border-emerald-600 bg-emerald-600 text-white'
      : 'border-(--border-muted) bg-(--bg-soft) hover:bg-(--hover-surface)'
  }`;

const ratioTone = (ratio: number | null): string | undefined => {
  if (ratio === null || !Number.isFinite(ratio)) return undefined;
  if (ratio < 1) return 'text-red-600 dark:text-red-400';
  if (ratio < 2) return 'text-amber-600 dark:text-amber-400';
  return undefined;
};

export const MamAccountModal = ({ onClose }: MamAccountModalProps) => {
  const [isClosing, setIsClosing] = useState(false);
  const [account, setAccount] = useState<MamAccountResponse | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [status, setStatus] = useState<MamStatusResponse | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [choice, setChoice] = useState<Choice>(50);
  const [customValue, setCustomValue] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [isBuying, setIsBuying] = useState(false);
  const [purchaseMessage, setPurchaseMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  const refresh = useCallback(async (force: boolean) => {
    setIsRefreshing(true);
    setStatus(null);
    const accountRequest = getMamAccount(force)
      .then((response) => {
        setAccount(response);
        setAccountError(null);
      })
      .catch((error: unknown) => setAccountError(errorText(error)));
    const statusRequest = getMamStatus()
      .then(setStatus)
      .catch((error: unknown) => {
        const failed = { configured: true, ok: false, message: errorText(error) };
        setStatus({ mam: failed, torrent_client: failed });
      });
    await Promise.all([accountRequest, statusRequest]);
    setIsRefreshing(false);
  }, []);

  useMountEffect(() => {
    void refresh(false);
  });

  const handleClose = useCallback(() => {
    if (isBuying) return;
    setIsClosing(true);
    setTimeout(() => {
      onClose();
      setIsClosing(false);
    }, 150);
  }, [isBuying, onClose]);

  useBodyScrollLock(true);
  useEscapeKey(true, handleClose);

  const stats = account?.stats ?? null;
  const pointsPerGb = account?.points_per_gb ?? DEFAULT_POINTS_PER_GB;
  const stepGb = account?.step_gb ?? DEFAULT_STEP_GB;
  const maxGb = stats ? maxAffordableGb(stats.seedbonus, pointsPerGb, stepGb) : 0;

  const customError = choice === 'custom' ? customAmountError(customValue, stepGb) : null;
  let amount: UploadCreditAmount | null = null;
  if (choice === 'custom') {
    amount = customError ? null : Number(customValue.trim());
  } else {
    amount = choice;
  }
  const cost = amount === null ? null : uploadCreditCost(amount, pointsPerGb);
  const affordable =
    stats !== null && (amount === 'max' ? maxGb > 0 : cost !== null && cost <= stats.seedbonus);
  const canBuy = amount !== null && affordable && !isBuying && account?.configured === true;

  let costLine = '';
  if (stats && amount === 'max') {
    costLine =
      maxGb > 0
        ? `About ${maxGb} GB for ${formatPoints(maxGb * pointsPerGb)} BP; MAM decides the exact amount`
        : 'Not enough bonus points for any upload credit';
  } else if (stats && cost !== null) {
    costLine = `${formatPoints(cost)} BP of your ${formatPoints(stats.seedbonus)} BP`;
    if (cost > stats.seedbonus) costLine += ' — not enough bonus points';
  }

  const amountLabel = amount === 'max' ? 'max affordable' : `${amount ?? ''} GB`;

  const buy = async () => {
    if (!canBuy || amount === null) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    setIsBuying(true);
    setPurchaseMessage(null);
    try {
      const result = await buyMamUploadCredit(amount);
      setAccount(result);
      if (result.success) {
        setPurchaseMessage({ ok: true, text: `Added ${result.amount_gb} GB of upload credit.` });
      } else {
        const partial =
          result.amount_gb > 0 ? ` ${result.amount_gb} GB was added before it stopped.` : '';
        setPurchaseMessage({ ok: false, text: `${result.error ?? 'Purchase failed.'}${partial}` });
      }
    } catch (error) {
      setPurchaseMessage({ ok: false, text: errorText(error) });
    } finally {
      setIsBuying(false);
    }
  };

  const selectChoice = (next: Choice) => {
    setChoice(next);
    setConfirming(false);
    setPurchaseMessage(null);
  };

  const titleId = 'mam-account-modal-title';
  const error = accountError ?? account?.error ?? null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className={`absolute inset-0 bg-black/60 transition-opacity duration-150 ${isClosing ? 'opacity-0' : 'opacity-100'}`}
        onClick={handleClose}
        tabIndex={-1}
        aria-label="Close MyAnonamouse account"
      />

      <div
        className={`relative flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border border-(--border-muted) shadow-2xl ${isClosing ? 'settings-modal-exit' : 'settings-modal-enter'}`}
        style={{ background: 'var(--bg)' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="flex items-center justify-between gap-3 border-b border-(--border-muted) px-6 py-4">
          <div className="min-w-0">
            <h3 id={titleId} className="text-lg font-semibold">
              MyAnonamouse
            </h3>
            <p className="truncate text-sm opacity-70">
              {stats?.username
                ? `${stats.username}${stats.classname ? ` · ${stats.classname}` : ''}`
                : 'Account'}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => void refresh(true)}
              disabled={isRefreshing || isBuying}
              className="rounded-lg px-3 py-1.5 text-sm transition-colors hover:bg-(--hover-surface) disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isRefreshing ? 'Refreshing…' : 'Refresh'}
            </button>
            <button
              type="button"
              onClick={handleClose}
              disabled={isBuying}
              className="rounded-lg p-1.5 transition-colors hover:bg-(--hover-surface) disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Close MyAnonamouse account"
            >
              <svg
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </header>

        <div className="space-y-6 overflow-y-auto px-6 py-5">
          {error && (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
              {error}
            </p>
          )}

          <section aria-label="Account stats">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat
                label="Ratio"
                value={stats ? formatRatio(stats.ratio) : '…'}
                tone={stats ? ratioTone(stats.ratio) : undefined}
              />
              <Stat
                label="Buffer"
                value={stats ? formatGib(stats.buffer_bytes) : '…'}
                tone={
                  stats && stats.buffer_bytes < 0 ? 'text-red-600 dark:text-red-400' : undefined
                }
              />
              <Stat label="Bonus points" value={stats ? formatPoints(stats.seedbonus) : '…'} />
              <Stat
                label="VIP until"
                value={stats ? (stats.vip_until?.slice(0, 10) ?? '—') : '…'}
              />
              <Stat label="Uploaded" value={stats ? formatGib(stats.uploaded_bytes) : '…'} />
              <Stat label="Downloaded" value={stats ? formatGib(stats.downloaded_bytes) : '…'} />
            </div>
          </section>

          <section aria-label="Connections">
            <h4 className="text-sm font-semibold">Connections</h4>
            <ul className="mt-1 divide-y divide-(--border-muted)">
              <ConnectionRow label="MyAnonamouse" connection={status?.mam ?? null} />
              <ConnectionRow
                label={status?.torrent_client.name ?? 'Torrent client'}
                connection={status?.torrent_client ?? null}
              />
            </ul>
          </section>

          <section aria-label="Buy upload credit">
            <h4 className="text-sm font-semibold">Buy upload credit</h4>
            <p className="mt-0.5 text-xs opacity-70">
              {formatPoints(pointsPerGb)} bonus points per GB, bought in {stepGb} GB steps.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {UPLOAD_CREDIT_PRESETS_GB.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className={chipClass(choice === preset)}
                  onClick={() => selectChoice(preset)}
                >
                  {preset} GB
                </button>
              ))}
              <button
                type="button"
                className={chipClass(choice === 'max')}
                onClick={() => selectChoice('max')}
              >
                Max affordable
              </button>
              <label className="flex items-center gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  value={customValue}
                  placeholder="Custom"
                  aria-label="Custom amount in GB"
                  onFocus={() => selectChoice('custom')}
                  onChange={(event) => {
                    setCustomValue(event.target.value);
                    selectChoice('custom');
                  }}
                  className={`w-24 rounded-full border bg-(--bg-soft) px-3 py-1.5 text-sm ${
                    choice === 'custom' ? 'border-emerald-600' : 'border-(--border-muted)'
                  }`}
                />
                <span className="text-sm opacity-70">GB</span>
              </label>
            </div>
            <p className="mt-2 min-h-5 text-xs opacity-80">
              {choice === 'custom' && customError ? customError : costLine}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void buy()}
                disabled={!canBuy}
                className={`rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  confirming
                    ? 'bg-amber-600 hover:bg-amber-700'
                    : 'bg-emerald-600 hover:bg-emerald-700'
                }`}
              >
                {isBuying && 'Buying…'}
                {!isBuying && confirming && `Confirm: buy ${amountLabel}`}
                {!isBuying && !confirming && `Buy ${amountLabel}`}
              </button>
              {confirming && (
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="rounded-lg px-3 py-2 text-sm transition-colors hover:bg-(--hover-surface)"
                >
                  Cancel
                </button>
              )}
            </div>
            {purchaseMessage && (
              <p
                role="status"
                className={`mt-3 text-sm ${
                  purchaseMessage.ok
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-red-700 dark:text-red-300'
                }`}
              >
                {purchaseMessage.text}
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};
