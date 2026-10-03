import type { ReactNode } from 'react';
import { useLayoutEffect, useRef, useState } from 'react';

import { withBasePath } from '../../utils/basePath';
import { LibraryAppIcon } from '../shared/LibraryAppIcon';
import { Tooltip } from '../shared/Tooltip';
import type { ActivityCardAction, ActivityCardBadge } from './activityCardModel';
import { STATUS_BADGE_STYLES, STATUS_TOOLTIP_CLASSES, getProgressConfig } from './activityStyles';
import type { ActivityItem } from './activityTypes';

// What an activity item shows wherever it's listed: its status badges, its links and its
// action buttons. Shared by the Requests cards and the Downloads and History tables.

export const IconButton = ({
  title,
  className,
  onClick,
  children,
}: {
  title: string;
  className: string;
  onClick: () => void;
  children: ReactNode;
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={title}
    className={`inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors ${className}`}
  >
    {children}
  </button>
);

export const actionKey = (action: ActivityCardAction): string => {
  switch (action.kind) {
    case 'download-remove':
    case 'download-stop':
    case 'download-retry':
    case 'download-dismiss':
      return `${action.kind}-${action.bookId}`;
    case 'request-approve':
      return `${action.kind}-${action.requestId}-${action.record.id}`;
    case 'request-reject':
    case 'request-cancel':
    case 'request-dismiss':
      return `${action.kind}-${action.requestId}`;
    default:
      return 'action';
  }
};

const actionUiConfig = (
  action: ActivityCardAction,
): { title: string; className: string; icon: 'cross' | 'check' | 'stop' | 'retry' } => {
  switch (action.kind) {
    case 'download-remove':
      return {
        title: 'Remove from queue',
        className: 'text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30',
        icon: 'cross',
      };
    case 'download-stop':
      return {
        title: 'Stop download',
        className: 'text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30',
        icon: 'stop',
      };
    case 'download-dismiss':
      return {
        title: 'Clear (stays in History)',
        className: 'text-gray-500 hover:text-red-600 hover:bg-red-100 dark:hover:bg-red-900/30',
        icon: 'cross',
      };
    case 'download-retry':
      return {
        title: 'Retry',
        className: 'text-sky-600 dark:text-sky-400 hover:bg-sky-100 dark:hover:bg-sky-900/30',
        icon: 'retry',
      };
    case 'request-approve':
      return {
        title: 'Approve',
        className:
          'text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/30',
        icon: 'check',
      };
    case 'request-reject':
      return {
        title: 'Reject',
        className: 'text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30',
        icon: 'cross',
      };
    case 'request-cancel':
      return {
        title: 'Cancel request',
        className: 'text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30',
        icon: 'cross',
      };
    case 'request-dismiss':
      return {
        title: 'Clear',
        className: 'text-gray-500 hover:text-red-600 hover:bg-red-100 dark:hover:bg-red-900/30',
        icon: 'cross',
      };
    default:
      return {
        title: 'Action',
        className: 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700',
        icon: 'cross',
      };
  }
};

const ActionIcon = ({ icon }: { icon: 'cross' | 'check' | 'stop' | 'retry' }) => {
  if (icon === 'stop') {
    return (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <rect x="6" y="6" width="12" height="12" rx="2" />
      </svg>
    );
  }
  if (icon === 'check') {
    return (
      <svg
        className="h-4 w-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.25"
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="m5 13 4 4L19 7" />
      </svg>
    );
  }
  if (icon === 'retry') {
    return (
      <svg
        className="h-4 w-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M18.363 5.634A8.997 9.002 29.494 0 0 7.5 4.206 8.997 9.002 29.494 0 0 3.306 14.33 8.997 9.002 29.494 0 0 11.996 21a8.997 9.002 29.494 0 0 8.694-6.673m-2.327-8.693L20.87 8.14m.017-4.994v5.015m0 0h-5.013"
        />
      </svg>
    );
  }
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
};

/** "MyAnonamouse" for its pages, else the site's host: where a source link goes. */
export const sourcePageName = (url: string): string => {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host === 'myanonamouse.net' ? 'MyAnonamouse' : host;
  } catch {
    return 'its source';
  }
};

/** The status badges, with a download's progress filling its badge. */
export const ActivityStatusBadges = ({
  badges,
  className = 'mt-1.5',
}: {
  badges: ActivityCardBadge[];
  className?: string;
}) => {
  const badgeRefs = useRef<Record<string, HTMLSpanElement | null>>({});
  const [badgeOverflow, setBadgeOverflow] = useState<Record<string, boolean>>({});

  useLayoutEffect(() => {
    const measureBadgeOverflow = () => {
      const nextOverflow: Record<string, boolean> = {};
      badges.forEach((badge, index) => {
        const badgeId = `${badge.key}-${index}`;
        const element = badgeRefs.current[badgeId];
        nextOverflow[badgeId] = Boolean(element && element.scrollWidth - element.clientWidth > 1);
      });

      setBadgeOverflow((current) => {
        const currentKeys = Object.keys(current);
        const nextKeys = Object.keys(nextOverflow);
        if (
          currentKeys.length === nextKeys.length &&
          nextKeys.every((key) => current[key] === nextOverflow[key])
        ) {
          return current;
        }
        return nextOverflow;
      });
    };

    measureBadgeOverflow();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measureBadgeOverflow);
      return () => window.removeEventListener('resize', measureBadgeOverflow);
    }

    const observer = new ResizeObserver(measureBadgeOverflow);
    badges.forEach((badge, index) => {
      const badgeId = `${badge.key}-${index}`;
      const element = badgeRefs.current[badgeId];
      if (element) {
        observer.observe(element);
      }
    });

    return () => observer.disconnect();
  }, [badges]);

  return (
    <div className={`flex min-w-0 items-center gap-2 ${className}`}>
      {badges.map((badge, index) => {
        const badgeId = `${badge.key}-${index}`;
        const badgeStyle = STATUS_BADGE_STYLES[badge.visualStatus];
        const progressConfig = badge.isActiveDownload
          ? getProgressConfig(badge.visualStatus, badge.progress)
          : null;

        const isError = badge.visualStatus === 'error';

        return (
          <Tooltip
            key={badgeId}
            content={badgeOverflow[badgeId] ? badge.text : undefined}
            delay={0}
            position="bottom"
            unstyled
            interactive={isError}
            className={STATUS_TOOLTIP_CLASSES[badge.visualStatus]}
          >
            <span
              ref={(element) => {
                if (element) {
                  badgeRefs.current[badgeId] = element;
                } else {
                  delete badgeRefs.current[badgeId];
                }
              }}
              className={`relative truncate rounded-md px-2 py-0.5 text-[11px] font-medium ${badgeStyle.bg} ${badgeStyle.text} ${badge.isActiveDownload ? 'min-w-0 flex-1' : 'inline-block max-w-full'}`}
            >
              {progressConfig && badgeStyle.fillColor && (
                <span
                  className="absolute inset-y-0 left-0 overflow-hidden rounded-md transition-[width] duration-300"
                  style={{ width: `${progressConfig.percent}%` }}
                >
                  <span
                    className="absolute inset-0 rounded-md"
                    style={{ backgroundColor: badgeStyle.fillColor }}
                  />
                  <span
                    className="activity-wave absolute inset-0 rounded-md opacity-30"
                    style={{
                      background:
                        'linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.55) 50%, transparent 100%)',
                      backgroundSize: '200% 100%',
                    }}
                  />
                </span>
              )}
              <span className="relative">{badge.text}</span>
            </span>
          </Tooltip>
        );
      })}
    </div>
  );
};

/** Links for an item: open it in your library app, on its source, or save the file. */
export const ActivityLinkButtons = ({
  item,
  onOpenInLibrary,
}: {
  item: ActivityItem;
  onOpenInLibrary?: (item: ActivityItem) => void;
}) => {
  const canShowDownloadLink =
    item.kind === 'download' &&
    item.visualStatus === 'complete' &&
    Boolean(item.downloadBookId) &&
    Boolean(item.downloadPath);

  return (
    <>
      {onOpenInLibrary && item.kind === 'download' && item.visualStatus === 'complete' && (
        <Tooltip content="Open in your library" delay={0} position="bottom">
          <IconButton
            title="Open in your library"
            className="text-gray-500 hover:bg-sky-100 hover:text-sky-600 dark:hover:bg-sky-900/30 dark:hover:text-sky-400"
            onClick={() => onOpenInLibrary(item)}
          >
            <LibraryAppIcon />
          </IconButton>
        </Tooltip>
      )}
      {item.infoUrl && (
        <Tooltip content={`Open on ${sourcePageName(item.infoUrl)}`} delay={0} position="bottom">
          <a
            href={item.infoUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open on ${sourcePageName(item.infoUrl)}`}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-sky-100 hover:text-sky-600 dark:hover:bg-sky-900/30 dark:hover:text-sky-400"
          >
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M14 5h5v5M19 5l-8 8M10 5H6a1 1 0 00-1 1v12a1 1 0 001 1h12a1 1 0 001-1v-4"
              />
            </svg>
          </a>
        </Tooltip>
      )}
      {canShowDownloadLink && item.downloadBookId && (
        <Tooltip content="Save file to this device" delay={0} position="bottom">
          <a
            href={withBasePath(`/api/localdownload?id=${encodeURIComponent(item.downloadBookId)}`)}
            aria-label="Save file to this device"
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-sky-100 hover:text-sky-600 dark:hover:bg-sky-900/30 dark:hover:text-sky-400"
          >
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 4v11m0 0l-4-4m4 4l4-4M5 20h14"
              />
            </svg>
          </a>
        </Tooltip>
      )}
    </>
  );
};

/** One action as an icon button: Remove, Stop, Retry, Clear, Approve and so on. */
export const ActivityActionButton = ({
  action,
  isRetryAfterFailure = false,
  onClick,
}: {
  action: ActivityCardAction;
  isRetryAfterFailure?: boolean;
  onClick: () => void;
}) => {
  const config = actionUiConfig(action);
  const icon = action.kind === 'request-approve' && isRetryAfterFailure ? 'retry' : config.icon;
  const actionTitle =
    action.kind === 'request-approve' && isRetryAfterFailure ? 'Retry' : config.title;
  return (
    <Tooltip content={actionTitle} delay={0} position="bottom">
      <IconButton title={actionTitle} className={config.className} onClick={onClick}>
        <ActionIcon icon={icon} />
      </IconButton>
    </Tooltip>
  );
};
