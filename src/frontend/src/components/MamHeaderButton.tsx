import { useState } from 'react';

import { useMountEffect } from '../hooks/useMountEffect';
import { getMamRatio, getMamUnsatTiming } from '../services/api';
import {
  describeUnsatTiming,
  formatRatio,
  formatUnsat,
  ratioTone,
  unsatTone,
  type MamUnsatTiming,
} from '../utils/mamAccount';
import type { MamRatioSnapshot } from '../utils/mamRatio';
import { MouseIcon } from './MouseIcon';

// MAM's figures move slowly; the server also caches them for a minute.
const REFRESH_MS = 5 * 60 * 1000;

interface MamHeaderButtonProps {
  onClick: () => void;
}

/** The header's MyAnonamouse button, showing the account's ratio and unsatisfied count. */
export const MamHeaderButton = ({ onClick }: MamHeaderButtonProps) => {
  const [stats, setStats] = useState<MamRatioSnapshot | null>(null);
  const [timing, setTiming] = useState<MamUnsatTiming | null>(null);

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
      getMamUnsatTiming()
        .then((next) => {
          if (!cancelled) setTiming(next);
        })
        .catch(() => {
          if (!cancelled) setTiming(null);
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
  const slots = describeUnsatTiming(timing);
  const summary = hasStats
    ? `Ratio ${formatRatio(ratio)}, unsatisfied ${formatUnsat(unsatCount, unsatLimit)}${
        slots ? `. ${slots}` : ''
      }`
    : 'MyAnonamouse';

  return (
    <button
      type="button"
      onClick={onClick}
      className="hover-action flex items-center gap-2 rounded-full px-3 py-2 text-gray-900 transition-all duration-200 dark:text-gray-100"
      aria-label={`MyAnonamouse account: ${summary}`}
      title={hasStats ? `MyAnonamouse · ${summary}` : 'MyAnonamouse'}
    >
      <MouseIcon className="h-5 w-5 shrink-0" />
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
