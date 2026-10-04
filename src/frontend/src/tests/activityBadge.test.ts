import { describe, it, expect } from 'vitest';

import { getActivityBadges, type ActivityStatusCounts } from '../utils/activityBadge';

const counts = (fields: Partial<ActivityStatusCounts> = {}): ActivityStatusCounts => ({
  queued: 0,
  ongoing: 0,
  completed: 0,
  errored: 0,
  pendingRequests: 0,
  ...fields,
});

describe('activityBadge.getActivityBadges', () => {
  it('shows nothing when there is no activity', () => {
    const badges = getActivityBadges(counts(), { isAdmin: true, savedQueued: 0 });
    expect(badges).toEqual({ activity: null, queued: null, downloads: null, requests: null });
  });

  it('counts queued downloads and saved picks on Queued, not on Downloads', () => {
    const badges = getActivityBadges(counts({ queued: 2, ongoing: 1 }), {
      isAdmin: true,
      savedQueued: 3,
    });
    expect(badges.queued?.count).toBe(5);
    expect(badges.queued?.title).toBe('2 downloads up next, 3 waiting for room');
    expect(badges.downloads?.count).toBe(1);
    expect(badges.activity?.count).toBe(6);
  });

  it('keeps failures in a neutral badge, said in its title', () => {
    const badges = getActivityBadges(counts({ ongoing: 1, errored: 2 }), {
      isAdmin: true,
      savedQueued: 0,
    });
    expect(badges.downloads?.count).toBe(3);
    expect(badges.downloads?.title).toBe('1 downloading, 2 failed');
    expect(badges.downloads?.className).not.toMatch(/red/);
    expect(badges.activity?.className).not.toMatch(/red/);
  });

  it('adds pending requests to Activity for admins only', () => {
    const admin = getActivityBadges(counts({ pendingRequests: 4 }), {
      isAdmin: true,
      savedQueued: 0,
    });
    expect(admin.requests?.count).toBe(4);
    expect(admin.activity?.count).toBe(4);
    const user = getActivityBadges(counts({ pendingRequests: 4 }), {
      isAdmin: false,
      savedQueued: 0,
      requestsTab: 2,
    });
    expect(user.requests?.count).toBe(2); // Their own, on the Requests page
    expect(user.activity).toBeNull();
  });
});
