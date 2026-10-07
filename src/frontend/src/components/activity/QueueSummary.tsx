import { formatGib, formatPoints, formatRatio, formatWait } from '../../utils/mamAccount';
import type { QueueEstimate, QueueEta, QueuePoints } from '../../utils/mamRatio';

interface QueueSummaryProps {
  count: number; // Downloads up next plus saved items waiting
  sizeBytes: number; // Their total size
  estimate: QueueEstimate | null; // The saved items against the ratio, when MAM is set up
  points: QueuePoints | null;
}

const Tile = ({
  label,
  value,
  detail,
  tone,
  title,
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: string;
  title?: string;
}) => (
  <div
    className="rounded-xl border border-(--border-muted) bg-(--bg-soft) px-3 py-2.5"
    title={title}
  >
    <p className="text-xs tracking-wide uppercase opacity-60">{label}</p>
    <p className={`mt-0.5 text-base font-semibold tabular-nums ${tone ?? ''}`}>{value}</p>
    {detail && <p className="mt-0.5 text-xs opacity-70">{detail}</p>}
  </div>
);

/** How long the points for some upload credit take, in words: "~14 h of bonus points". */
const describeCreditWait = (hours: number | null, points: QueuePoints | null): string => {
  if (hours === 0) return 'You have the bonus points now';
  if (hours !== null) return `~${formatWait(hours)} of bonus points`;
  return points ? 'Points rate not known yet' : 'Ask an admin to buy upload credit';
};

/** A queued item's ETA cell: when it fits the ratio, and what that takes. */
export const QueueEtaCell = ({
  eta,
  keepRatio,
  points,
  isMam,
}: {
  eta: QueueEta;
  keepRatio: number;
  points: QueuePoints | null;
  isMam: boolean;
}) => {
  if (eta.kind === 'free') {
    return <span className="opacity-60">{isMam ? 'Freeleech' : '—'}</span>;
  }
  if (eta.kind === 'fits') {
    return (
      <span
        className="text-emerald-700 dark:text-emerald-400"
        title={`Fits without the ratio dropping below ${formatRatio(keepRatio)}. It can still wait for an unsatisfied slot.`}
      >
        Fits now
      </span>
    );
  }
  let headline = `${eta.creditGb} GB credit`;
  if (eta.hours === 0) headline = 'Buy credit';
  else if (eta.hours !== null) headline = `~${formatWait(eta.hours)}`;
  return (
    <span
      title={`Counting what's ahead of it, ${eta.creditGb} GB of upload credit (${formatPoints(
        eta.points,
      )} bonus points) keeps the ratio at ${formatRatio(keepRatio)}. ${describeCreditWait(
        eta.hours,
        points,
      )}${points?.perHour ? ` at ~${Math.round(points.perHour)} an hour` : ''}.`}
    >
      <span className="font-medium">{headline}</span>
      <span className="block opacity-60">
        {eta.creditGb} GB · {formatPoints(eta.points)} BP
      </span>
    </span>
  );
};

/** The top of the Queued page: how much is waiting, and how it sits with the ratio. */
export const QueueSummary = ({ count, sizeBytes, estimate, points }: QueueSummaryProps) => {
  if (count === 0) return null;
  const tiles = [
    <Tile
      key="size"
      label="In queue"
      value={formatGib(sizeBytes)}
      detail={`${count} item${count === 1 ? '' : 's'}`}
    />,
  ];
  if (estimate) {
    const ratio = formatRatio(estimate.keepRatio);
    tiles.push(
      <Tile
        key="charge"
        label="Counts against ratio"
        value={formatGib(estimate.chargeBytes)}
        detail="Saved picks, not freeleech"
        title="What the saved picks waiting for room add to the downloaded total on MyAnonamouse. Downloads up next are already counted in the room."
      />,
      <Tile
        key="room"
        label={`Room to ${ratio}`}
        value={formatGib(estimate.roomBytes)}
        detail="After active downloads"
        tone={estimate.roomBytes < 0 ? 'text-red-600 dark:text-red-400' : undefined}
        title={`How much more can be downloaded before the ratio drops below ${ratio} (Keep Ratio At Least), counting the downloads up next and in progress.`}
      />,
    );
    tiles.push(
      estimate.creditGb > 0 ? (
        <Tile
          key="credit"
          label="Credit for all of it"
          value={`${estimate.creditGb} GB`}
          detail={`${formatPoints(estimate.points)} BP · ${describeCreditWait(estimate.hours, points)}`}
          tone="text-amber-700 dark:text-amber-400"
          title={`Upload credit to buy so the whole queue downloads without the ratio dropping below ${ratio}${
            points?.perHour
              ? `. Bonus points come in at ~${Math.round(points.perHour)} an hour`
              : ''
          }.`}
        />
      ) : (
        <Tile
          key="credit"
          label="Credit for all of it"
          value="None"
          detail={`The queue fits ratio ${ratio}`}
          tone="text-emerald-700 dark:text-emerald-400"
        />
      ),
    );
  }
  return (
    <section aria-label="Queue summary" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {tiles}
    </section>
  );
};
