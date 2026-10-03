import { Link } from 'react-router-dom';

import { useEscapeKey } from '../../hooks/useEscapeKey';
import { NavIcon, type NavIconName } from './NavIcon';

interface NavBadge {
  count: number;
  // Tailwind classes for the pill, e.g. 'bg-sky-500 text-white'.
  className: string;
  title?: string;
}

interface NavChild {
  key: string;
  label: string;
  to: string;
  active: boolean;
  badge?: NavBadge | null;
}

export interface NavItem {
  key: string;
  label: string;
  icon: NavIconName;
  // A link, or an action when the section opens somewhere else (a dialog).
  to?: string;
  onClick?: () => void;
  active: boolean;
  badge?: NavBadge | null;
  // Shown under the item while its section is open, as in Sonarr and Radarr.
  children?: NavChild[];
}

interface AppSidebarProps {
  items: NavItem[];
  topOffset: number;
  // The small-screen drawer.
  mobileOpen: boolean;
  onMobileClose: () => void;
}

const Badge = ({ badge }: { badge: NavBadge }) => (
  <span
    className={`ml-auto inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[11px] leading-none font-semibold ${badge.className}`}
    title={badge.title}
  >
    {badge.count}
  </span>
);

const itemClassName = (active: boolean) =>
  `flex w-full items-center gap-3 border-l-[3px] py-2.5 pr-4 pl-[13px] text-left text-sm font-medium transition-colors ${
    active
      ? 'border-sky-500 bg-(--hover-surface) text-sky-600 dark:text-sky-400'
      : 'border-transparent text-gray-700 hover:bg-(--hover-surface) hover:text-gray-900 dark:text-gray-300 dark:hover:text-white'
  }`;

const childClassName = (active: boolean) =>
  `flex w-full items-center gap-2 py-1.5 pr-4 pl-12 text-left text-sm transition-colors ${
    active
      ? 'font-medium text-sky-600 dark:text-sky-400'
      : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
  }`;

const NavList = ({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) => (
  <ul className="py-2">
    {items.map((item) => {
      const content = (
        <>
          <NavIcon name={item.icon} />
          <span>{item.label}</span>
          {item.badge && item.badge.count > 0 && <Badge badge={item.badge} />}
        </>
      );
      const showChildren = item.active && item.children && item.children.length > 0;
      return (
        <li key={item.key}>
          {item.to ? (
            <Link
              to={item.to}
              onClick={onNavigate}
              className={itemClassName(item.active)}
              aria-current={item.active && !showChildren ? 'page' : undefined}
            >
              {content}
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => {
                onNavigate?.();
                item.onClick?.();
              }}
              className={itemClassName(item.active)}
            >
              {content}
            </button>
          )}
          {showChildren && (
            <ul className="pb-2">
              {item.children?.map((child) => (
                <li key={child.key}>
                  <Link
                    to={child.to}
                    onClick={onNavigate}
                    className={childClassName(child.active)}
                    aria-current={child.active ? 'page' : undefined}
                  >
                    <span className="truncate">{child.label}</span>
                    {child.badge && child.badge.count > 0 && <Badge badge={child.badge} />}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </li>
      );
    })}
  </ul>
);

/** The main navigation: a fixed column on wide screens, a drawer on small ones. */
export const AppSidebar = ({ items, topOffset, mobileOpen, onMobileClose }: AppSidebarProps) => {
  useEscapeKey(mobileOpen, onMobileClose);

  return (
    <>
      <nav
        aria-label="Main"
        className="fixed bottom-0 left-0 z-30 hidden w-56 overflow-y-auto border-r border-(--border-muted) bg-(--bg-soft) lg:block"
        style={{ top: `${topOffset}px`, paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <NavList items={items} />
      </nav>

      <div className="lg:hidden">
        <button
          type="button"
          className={`fixed inset-0 z-45 bg-black/50 transition-opacity duration-300 ${
            mobileOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
          onClick={onMobileClose}
          aria-label="Close menu"
          tabIndex={-1}
        />
        <nav
          aria-label="Main"
          aria-hidden={!mobileOpen}
          inert={!mobileOpen}
          className={`fixed top-0 bottom-0 left-0 z-50 w-64 overflow-y-auto bg-(--bg-soft) transition-transform duration-300 ${
            mobileOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'
          }`}
          style={{
            paddingTop: 'env(safe-area-inset-top)',
            paddingBottom: 'env(safe-area-inset-bottom)',
          }}
        >
          <NavList items={items} onNavigate={onMobileClose} />
        </nav>
      </div>
    </>
  );
};
