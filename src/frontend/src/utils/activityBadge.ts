export interface ActivityStatusCounts {
  queued: number; // Downloads waiting to start (for a worker or a MAM slot)
  ongoing: number; // Downloads under way
  completed: number;
  errored: number;
  pendingRequests: number;
}

interface ActivityBadge {
  count: number;
  className: string;
  title: string;
}

export interface ActivityBadges {
  // The Activity section, shown while it's collapsed: everything below added up.
  activity: ActivityBadge | null;
  queued: ActivityBadge | null;
  downloads: ActivityBadge | null;
  requests: ActivityBadge | null;
}

// Soft tints: a count is information, not an alarm. The pages say what failed.
const NEUTRAL = 'bg-gray-500/15 text-gray-700 dark:bg-gray-400/15 dark:text-gray-200';
const QUEUED = 'bg-sky-500/15 text-sky-700 dark:text-sky-300';
const REQUESTS = 'bg-amber-500/15 text-amber-700 dark:text-amber-300';

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

const badge = (count: number, className: string, parts: string[]): ActivityBadge | null =>
  count > 0 ? { count, className, title: parts.join(', ') } : null;

/**
 * The counts beside Activity and its pages. `savedQueued` is the saved picks queued to
 * download once there's room, which the Queued page lists after the downloads up next.
 * `requestsTab` is the Requests page's own count: the viewer's pending requests, or
 * every one an admin has to review.
 */
export const getActivityBadges = (
  counts: ActivityStatusCounts,
  {
    isAdmin,
    savedQueued,
    requestsTab = counts.pendingRequests,
  }: { isAdmin: boolean; savedQueued: number; requestsTab?: number },
): ActivityBadges => {
  // Only an admin's requests are theirs to act on, so only those count on Activity.
  const pendingRequests = isAdmin ? counts.pendingRequests : 0;
  const queued = badge(counts.queued + savedQueued, QUEUED, [
    ...(counts.queued > 0 ? [`${plural(counts.queued, 'download')} up next`] : []),
    ...(savedQueued > 0 ? [`${savedQueued} waiting for room`] : []),
  ]);
  const downloads = badge(counts.ongoing + counts.completed + counts.errored, NEUTRAL, [
    ...(counts.ongoing > 0 ? [`${counts.ongoing} downloading`] : []),
    ...(counts.completed > 0 ? [`${counts.completed} finished`] : []),
    ...(counts.errored > 0 ? [`${counts.errored} failed`] : []),
  ]);
  const requests = badge(requestsTab, REQUESTS, [
    isAdmin
      ? `${plural(requestsTab, 'request')} to review`
      : `${plural(requestsTab, 'request')} pending`,
  ]);
  const shown = [
    queued,
    downloads,
    badge(pendingRequests, REQUESTS, [`${plural(pendingRequests, 'request')} to review`]),
  ].filter((b): b is ActivityBadge => b !== null);
  const activity = badge(
    shown.reduce((total, b) => total + b.count, 0),
    NEUTRAL,
    shown.map((b) => b.title),
  );
  return { activity, queued, downloads, requests };
};
