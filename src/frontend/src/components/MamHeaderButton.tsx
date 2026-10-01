import { useState } from 'react';

import { useMountEffect } from '../hooks/useMountEffect';
import { getMamRatio } from '../services/api';
import { formatRatio, formatUnsat, ratioTone, unsatTone } from '../utils/mamAccount';
import type { MamRatioSnapshot } from '../utils/mamRatio';

// MAM's figures move slowly; the server also caches them for a minute.
const REFRESH_MS = 5 * 60 * 1000;

interface MamHeaderButtonProps {
  onClick: () => void;
}

/** The header's MyAnonamouse button, showing the account's ratio and unsatisfied count. */
export const MamHeaderButton = ({ onClick }: MamHeaderButtonProps) => {
  const [stats, setStats] = useState<MamRatioSnapshot | null>(null);

  useMountEffect(() => {
    let cancelled = false;
    const load = () => {
      getMamRatio()
        .then((snapshot) => {
          if (!cancelled) setStats(snapshot);
        })
        .catch(() => {
          if (!cancelled) setStats(null);
        });
    };
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  });

  const ratio = stats?.available ? (stats.ratio ?? null) : null;
  const unsatCount = stats?.available ? (stats.unsat_count ?? null) : null;
  const unsatLimit = stats?.available ? (stats.unsat_limit ?? null) : null;
  const hasStats = Boolean(stats?.available);
  const summary = hasStats
    ? `Ratio ${formatRatio(ratio)}, unsatisfied ${formatUnsat(unsatCount, unsatLimit)}`
    : 'MyAnonamouse';

  return (
    <button
      type="button"
      onClick={onClick}
      className="hover-action flex items-center gap-2 rounded-full px-3 py-2 text-gray-900 transition-all duration-200 dark:text-gray-100"
      aria-label={`MyAnonamouse account: ${summary}`}
      title={hasStats ? `MyAnonamouse · ${summary}` : 'MyAnonamouse'}
    >
      <svg
        className="h-5 w-5 shrink-0"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth="1.5"
        stroke="currentColor"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z"
        />
      </svg>
      {hasStats ? (
        <span
          className="flex items-baseline gap-1.5 text-sm font-medium tabular-nums"
          aria-hidden="true"
        >
          <span className="hidden opacity-60 md:inline">Ratio</span>
          <span className={ratioTone(ratio)}>{formatRatio(ratio)}</span>
          <span className="opacity-40">·</span>
          <span className="hidden opacity-60 md:inline">Unsat</span>
          <span className={unsatTone(unsatCount, unsatLimit)}>
            {formatUnsat(unsatCount, unsatLimit)}
          </span>
        </span>
      ) : (
        <span className="hidden text-sm font-medium sm:inline">MyAnonamouse</span>
      )}
    </button>
  );
};
