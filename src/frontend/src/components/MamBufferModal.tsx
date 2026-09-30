import { useCallback, useState } from 'react';

import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { buyMamUploadCredit, checkMamBuffer, type DownloadReleasePayload } from '../services/api';
import {
  customAmountError,
  DEFAULT_POINTS_PER_GB,
  DEFAULT_STEP_GB,
  formatGib,
  formatPoints,
  maxAffordableGb,
  uploadCreditCost,
  type UploadCreditAmount,
} from '../utils/mamAccount';
import type { MamBufferCheck } from '../utils/mamRatio';

interface MamBufferModalProps {
  check: MamBufferCheck;
  releases: DownloadReleasePayload[];
  // Called with true once the downloads fit (after a purchase), false to give up.
  onResolve: (proceed: boolean) => void;
}

type Choice = number | 'max' | 'custom';

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : 'Request failed';

const chipClass = (selected: boolean) =>
  `rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
    selected
      ? 'border-emerald-600 bg-emerald-600 text-white'
      : 'border-(--border-muted) bg-(--bg-soft) hover:bg-(--hover-surface)'
  }`;

/** Offers upload credit when MAM downloads don't fit in the account's buffer. */
export const MamBufferModal = ({
  check: initialCheck,
  releases,
  onResolve,
}: MamBufferModalProps) => {
  const [check, setCheck] = useState(initialCheck);
  const [choice, setChoice] = useState<Choice>(initialCheck.recommended_gb);
  const [customValue, setCustomValue] = useState('');
  const [isBuying, setIsBuying] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const cancel = useCallback(() => {
    if (!isBuying) onResolve(false);
  }, [isBuying, onResolve]);

  useBodyScrollLock(true);
  useEscapeKey(true, cancel);

  const seedbonus = check.seedbonus ?? 0;
  const presets = [...new Set([check.recommended_gb, check.recommended_gb + DEFAULT_STEP_GB * 2])];
  const customError = choice === 'custom' ? customAmountError(customValue) : null;
  let amount: UploadCreditAmount | null = null;
  if (choice === 'custom') {
    amount = customError ? null : Number(customValue.trim());
  } else {
    amount = choice;
  }
  const cost = amount === null ? null : uploadCreditCost(amount);
  const maxGb = maxAffordableGb(seedbonus);
  const affordable = amount === 'max' ? maxGb > 0 : cost !== null && cost <= seedbonus;

  let costLine = '';
  if (amount === 'max') {
    costLine =
      maxGb > 0
        ? `About ${maxGb} GB for ${formatPoints(maxGb * DEFAULT_POINTS_PER_GB)} BP`
        : 'Not enough bonus points';
  } else if (cost !== null) {
    costLine = `${formatPoints(cost)} BP of your ${formatPoints(seedbonus)} BP`;
    if (cost > seedbonus) costLine += ' — not enough bonus points';
  }

  const buyAndContinue = async () => {
    if (amount === null || !affordable || isBuying) return;
    setIsBuying(true);
    setMessage(null);
    try {
      const result = await buyMamUploadCredit(amount);
      if (!result.success && result.amount_gb <= 0) {
        setMessage({ ok: false, text: result.error ?? 'Purchase failed.' });
        return;
      }
      const recheck = await checkMamBuffer(releases);
      if (recheck.ok) {
        onResolve(true);
        return;
      }
      setCheck(recheck);
      setChoice(recheck.recommended_gb);
      const bought = result.amount_gb > 0 ? `Added ${result.amount_gb} GB. ` : '';
      setMessage({
        ok: false,
        text: `${bought}${result.error ? `${result.error}. ` : ''}Still ${formatGib(recheck.missing_bytes)} short.`,
      });
    } catch (error) {
      setMessage({ ok: false, text: errorText(error) });
    } finally {
      setIsBuying(false);
    }
  };

  const select = (next: Choice) => {
    setChoice(next);
    setMessage(null);
  };

  const titleId = 'mam-buffer-modal-title';
  const buyLabel = amount === 'max' ? 'max affordable' : `${amount ?? ''} GB`;

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/60"
        onClick={cancel}
        tabIndex={-1}
        aria-label="Cancel download"
      />
      <div
        className="settings-modal-enter relative w-full max-w-lg rounded-xl border border-(--border-muted) shadow-2xl"
        style={{ background: 'var(--bg)' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="border-b border-(--border-muted) px-6 py-4">
          <h3 id={titleId} className="text-lg font-semibold">
            Not enough MyAnonamouse buffer
          </h3>
        </header>

        <div className="space-y-4 px-6 py-5 text-sm">
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1">
            <dt className="opacity-70">These downloads</dt>
            <dd className="text-right tabular-nums">{formatGib(check.request_bytes)}</dd>
            {check.pending_bytes > 0 && (
              <>
                <dt className="opacity-70">Still downloading</dt>
                <dd className="text-right tabular-nums">{formatGib(check.pending_bytes)}</dd>
              </>
            )}
            <dt className="opacity-70">Buffer</dt>
            <dd className="text-right tabular-nums">{formatGib(check.buffer_bytes ?? 0)}</dd>
            <dt className="font-medium">Short by</dt>
            <dd className="text-right font-medium text-red-600 tabular-nums dark:text-red-400">
              {formatGib(check.missing_bytes)}
            </dd>
          </dl>

          {check.can_buy ? (
            <div>
              <p className="font-medium">Buy upload credit and download</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {presets.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className={chipClass(choice === preset)}
                    onClick={() => select(preset)}
                  >
                    {preset} GB{preset === check.recommended_gb ? ' (enough)' : ''}
                  </button>
                ))}
                <button
                  type="button"
                  className={chipClass(choice === 'max')}
                  onClick={() => select('max')}
                >
                  Max affordable
                </button>
                <input
                  type="text"
                  inputMode="numeric"
                  value={customValue}
                  placeholder="Custom"
                  aria-label="Custom amount in GB"
                  onFocus={() => select('custom')}
                  onChange={(event) => {
                    setCustomValue(event.target.value);
                    select('custom');
                  }}
                  className={`w-24 rounded-full border bg-(--bg-soft) px-3 py-1.5 ${
                    choice === 'custom' ? 'border-emerald-600' : 'border-(--border-muted)'
                  }`}
                />
              </div>
              <p className="mt-2 min-h-5 text-xs opacity-80">
                {choice === 'custom' && customError ? customError : costLine}
              </p>
            </div>
          ) : (
            <p className="opacity-80">
              Ask an admin to add upload credit to the MyAnonamouse account, then try again.
            </p>
          )}

          {message && (
            <p
              role="status"
              className={
                message.ok
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-red-700 dark:text-red-300'
              }
            >
              {message.text}
            </p>
          )}
        </div>

        <footer className="flex items-center justify-end gap-3 border-t border-(--border-muted) px-6 py-4">
          <button
            type="button"
            onClick={cancel}
            disabled={isBuying}
            className="rounded-lg border border-(--border-muted) bg-(--bg-soft) px-4 py-2 text-sm font-medium transition-colors hover:bg-(--hover-surface) disabled:cursor-not-allowed disabled:opacity-50"
          >
            {check.can_buy ? 'Cancel' : 'Close'}
          </button>
          {check.can_buy && (
            <button
              type="button"
              onClick={() => void buyAndContinue()}
              disabled={amount === null || !affordable || isBuying}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isBuying ? 'Buying…' : `Buy ${buyLabel} and download`}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
};
