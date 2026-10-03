/** "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago". */
export const timeAgo = (epochMillis: number, now: number = Date.now()): string => {
  if (!Number.isFinite(epochMillis) || epochMillis <= 0) return '';
  const minutes = Math.max(0, Math.round((now - epochMillis) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
};

/** An ISO date as `timeAgo` puts it; empty when it can't be read. */
export const isoTimeAgo = (iso: string): string => {
  const then = Date.parse(iso);
  return Number.isNaN(then) ? '' : timeAgo(then);
};

/** The full date and time, for a tooltip on a relative one. */
export const formatDateTime = (epochMillis: number): string =>
  Number.isFinite(epochMillis) && epochMillis > 0
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
        epochMillis,
      )
    : '';
