import { formatGib, formatPoints, formatRatio, formatWait } from '../../utils/mamAccount';
import type { QueueCredit, QueueEstimate, QueueEta, QueuePoints } from '../../utils/mamRatio';

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

const creditLine = (credit: QueueCredit): string =>
  `${credit.gb} GB credit · ${formatPoints(credit.points)} BP`;

/** In words, for a tooltip: why an item starts when it does. */
const describeEta = (eta: QueueEta, keepRatio: number, points: QueuePoints | null): string => {
  const ratio = formatRatio(keepRatio);
  const lines: string[] = [];
  if (eta.credit) {
    lines.push(
      `Counting what's ahead of it, ${eta.credit.gb} GB of upload credit (${formatPoints(
        eta.credit.points,
      )} bonus points) keeps the ratio at ${ratio}. ${describeCreditWait(eta.credit.hours, points)}${
        points?.perHour ? ` at ~${Math.round(points.perHour)} an hour` : ''
      }.`,
    );
  } else if (!eta.free) {
    lines.push(`Fits without the ratio dropping below ${ratio}.`);
  }
  if (eta.waitsFor === 'slot') {
    lines.push(
      eta.seconds === null
        ? "Waits for an unsatisfied slot; the torrent client can't say when one frees up."
        : 'Waits for an unsatisfied slot: estimated from when seeding torrents reach 72 hours (and those ahead of it free theirs).',
    );
  } else if (eta.waitsFor === 'pause') {
    lines.push('Waits for MyAnonamouse to lift its download pause.');
  }
  return lines.join('\n');
};

/** A queued item's ETA cell: when it can start, and what it waits for. */
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
  const title = describeEta(eta, keepRatio, points);
  let headline: string;
  let detail: string | null = null;
  let tone = '';
  if (eta.seconds === 0) {
    tone = 'text-emerald-700 dark:text-emerald-400';
    headline = 'Now';
    if (eta.credit) {
      headline = 'Buy credit';
      tone = 'text-amber-700 dark:text-amber-400';
      detail = creditLine(eta.credit);
    } else if (eta.free && isMam) {
      detail = 'Freeleech';
    }
  } else if (eta.seconds !== null) {
    headline = `in ${formatWait(eta.seconds / 3600)}`;
    if (eta.waitsFor === 'slot') detail = 'For a slot';
    else if (eta.waitsFor === 'pause') detail = 'MAM download pause';
    else if (eta.credit) detail = creditLine(eta.credit);
  } else if (eta.waitsFor === 'slot') {
    headline = 'For a slot';
    detail = 'Time unknown';
  } else {
    headline = eta.credit ? `${eta.credit.gb} GB credit` : 'Unknown';
    detail = points ? 'Points rate unknown' : 'Ask an admin';
  }
  if (!isMam && eta.seconds === 0) return <span className="opacity-60">—</span>;
  return (
    <span title={title}>
      <span className={`font-medium ${tone}`}>{headline}</span>
      {detail && <span className="block opacity-60">{detail}</span>}
    </span>
  );
};

const describeStart = (seconds: number | null): string => {
  if (seconds === null) return 'Unknown';
  return seconds === 0 ? 'Now' : `in ${formatWait(seconds / 3600)}`;
};

/** The top of the Queued page: how much is waiting, and how it sits with the ratio and slots. */
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
    const { credit } = estimate;
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
      credit && credit.gb > 0 ? (
        <Tile
          key="credit"
          label="Credit for all of it"
          value={`${credit.gb} GB`}
          detail={`${formatPoints(credit.points)} BP · ${describeCreditWait(credit.hours, points)}`}
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
      <Tile
        key="done"
        label="All started"
        value={describeStart(estimate.seconds)}
        detail="Ratio and slots allowing"
        title="When the last saved pick can start: once the ratio allows (with upload credit bought as the points come in) and an unsatisfied slot is free. Unknown when the points rate or the slot timing isn't known."
      />,
    );
  }
  return (
    <section
      aria-label="Queue summary"
      className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5"
    >
      {tiles}
    </section>
  );
};
