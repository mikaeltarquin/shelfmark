import { useState } from 'react';

import { useDependencyEffect } from '../hooks/useMountEffect';
import { getMamRatio, getMamUnsatTiming } from '../services/api';
import {
  describeUnsatTiming,
  formatCountdown,
  formatRatio,
  formatUnsat,
  ratioTone,
  unsatTone,
  type MamUnsatTiming,
} from '../utils/mamAccount';
import { unsatSlotsFull, type MamRatioSnapshot } from '../utils/mamRatio';
import { MouseIcon } from './MouseIcon';

// MAM's figures move slowly; the server also caches them for a minute.
const REFRESH_MS = 5 * 60 * 1000;

/** Ticks once a second toward `target` (ms since epoch), then calls `onDone` once. */
const SlotCountdown = ({ target, onDone }: { target: number; onDone: () => void }) => {
  const [now, setNow] = useState(() => Date.now());
  useDependencyEffect(() => {
    const timer = window.setInterval(() => {
      const next = Date.now();
      setNow(next);
      if (next >= target) {
        window.clearInterval(timer);
        onDone();
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [target]);
  return (
    <span className="flex items-center gap-1 text-[10px] leading-none font-normal opacity-60">
      <svg
        className="h-2.5 w-2.5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
      {formatCountdown((target - now) / 1000)}
    </span>
  );
};

interface MamHeaderButtonProps {
  onClick: () => void;
}

/** The header's MyAnonamouse button, showing the account's ratio and unsatisfied count. */
export const MamHeaderButton = ({ onClick }: MamHeaderButtonProps) => {
  const [stats, setStats] = useState<MamRatioSnapshot | null>(null);
  const [timing, setTiming] = useState<MamUnsatTiming | null>(null);
  // When the next unsatisfied torrent frees a slot, on this browser's clock.
  const [slotAt, setSlotAt] = useState<number | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useDependencyEffect(() => {
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
          if (cancelled) return;
          setTiming(next);
          // Nothing to count down at 0: the torrent is due, MAM just hasn't caught up.
          const seconds = next.available ? next.next_seconds : null;
          setSlotAt(
            typeof seconds === 'number' && seconds > 0 ? Date.now() + seconds * 1000 : null,
          );
        })
        .catch(() => {
          if (cancelled) return;
          setTiming(null);
          setSlotAt(null);
        });
    };
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [reloadKey]);

  const ratio = stats?.available ? (stats.ratio ?? null) : null;
  const unsatCount = stats?.available ? (stats.unsat_count ?? null) : null;
  const unsatLimit = stats?.available ? (stats.unsat_limit ?? null) : null;
  const hasStats = Boolean(stats?.available);
  // Out of slots: count down to the next one, if a seeding torrent will free it.
  const countdownTo = hasStats && unsatSlotsFull(stats) ? slotAt : null;
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
      className={`hover-action flex items-center gap-2 rounded-full px-3 text-gray-900 transition-all duration-200 dark:text-gray-100 ${
        countdownTo !== null ? 'py-0.5' : 'py-2'
      }`}
      aria-label={`MyAnonamouse account: ${summary}`}
      title={hasStats ? `MyAnonamouse · ${summary}` : 'MyAnonamouse'}
    >
      <MouseIcon className="h-5 w-5 shrink-0" />
      {hasStats ? (
        <span className="flex flex-col items-center gap-0.5 tabular-nums" aria-hidden="true">
          <span className="flex items-baseline gap-1.5 text-sm font-medium">
            <span className="hidden opacity-60 md:inline">Ratio</span>
            <span className={ratioTone(ratio)}>{formatRatio(ratio)}</span>
            <span className="opacity-40">·</span>
            <span className="hidden opacity-60 md:inline">Unsat</span>
            <span className={unsatTone(unsatCount, unsatLimit)}>
              {formatUnsat(unsatCount, unsatLimit)}
            </span>
          </span>
          {countdownTo !== null && (
            <SlotCountdown target={countdownTo} onDone={() => setReloadKey((key) => key + 1)} />
          )}
        </span>
      ) : (
        <span className="hidden text-sm font-medium sm:inline">MyAnonamouse</span>
      )}
    </button>
  );
};
