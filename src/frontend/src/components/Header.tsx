import { useState, useRef, useMemo, forwardRef, useImperativeHandle } from 'react';

import { useDismiss } from '../hooks/useDismiss';
import { useMountEffect } from '../hooks/useMountEffect';
import type { DynamicFieldOption } from '../services/api';
import type {
  ContentType,
  ActingAsUserSelection,
  MetadataSearchField,
  QueryTargetOption,
} from '../types';
import { formatActingAsUserName } from '../utils/actingAsUser';
import { DropdownList } from './DropdownList';
import { ThemeToggle } from './layout/ThemeToggle';
import { MamHeaderButton } from './MamHeaderButton';
import type { SearchBarHandle, SuggestionPickResult } from './SearchBar';
import { SearchBar } from './SearchBar';
import { LibraryAppIcon } from './shared/LibraryAppIcon';

interface HeaderHandle {
  submitSearch: () => void;
}

interface HeaderProps {
  calibreWebUrl?: string;
  calibreWebName?: string; // Where the link goes ("Calibre-Web"), from the config
  audiobookLibraryUrl?: string;
  audiobookLibraryName?: string; // e.g. "Audiobookshelf"
  logoUrl?: string;
  title?: string;
  searchInput?: string | number | boolean;
  searchInputLabel?: string;
  onSearchChange?: (value: string | number | boolean, label?: string) => void;
  onSuggestionPick?: (option: DynamicFieldOption) => SuggestionPickResult;
  onSearch?: () => void;
  onAdvancedToggle?: () => void;
  isAdvancedActive?: boolean;
  isLoading?: boolean;
  onMenuClick?: () => void; // Opens the navigation drawer on small screens
  onMamAccountClick?: () => void; // Admins with a MyAnonamouse session ID only
  mamStatsKey?: number; // Changes when the account changed (a purchase), to re-read its stats
  isAdmin?: boolean;
  onLogoClick?: () => void;
  authRequired?: boolean;
  isAuthenticated?: boolean;
  username?: string | null;
  displayName?: string | null;
  actingAsUser?: ActingAsUserSelection | null;
  onActingAsUserChange?: (user: ActingAsUserSelection | null) => void;
  adminUsers?: ActingAsUserSelection[];
  isAdminUsersLoading?: boolean;
  adminUsersError?: string | null;
  hasLoadedAdminUsers?: boolean;
  onLoadAdminUsers?: () => Promise<void> | void;
  onLogout?: () => void;
  contentType?: ContentType;
  onContentTypeChange?: (type: ContentType) => void;
  allowedContentTypes?: ContentType[];
  combinedMode?: boolean;
  combinedModeLocked?: boolean;
  onCombinedModeChange?: (enabled: boolean) => void;
  queryTargets?: QueryTargetOption[];
  activeQueryTarget?: string;
  onQueryTargetChange?: (target: string) => void;
  activeQueryField?: MetadataSearchField | null;
}

const applyTheme = (preference: string): void => {
  let effective = preference;
  if (preference === 'auto') {
    effective = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  document.documentElement.setAttribute('data-theme', effective);
  document.documentElement.style.colorScheme = effective;
};

const EMPTY_ADMIN_USERS: ActingAsUserSelection[] = [];
const EMPTY_QUERY_TARGETS: QueryTargetOption[] = [];

export const Header = forwardRef<HeaderHandle, HeaderProps>(
  (
    {
      calibreWebUrl,
      calibreWebName = 'Books',
      audiobookLibraryUrl,
      audiobookLibraryName = 'Audiobooks',
      logoUrl,
      title = 'Shelfmark',
      searchInput = '',
      searchInputLabel,
      onSearchChange,
      onSuggestionPick,
      onSearch,
      onAdvancedToggle,
      isAdvancedActive = false,
      isLoading = false,
      onMenuClick,
      onMamAccountClick,
      mamStatsKey,
      isAdmin = false,
      onLogoClick,
      authRequired = false,
      isAuthenticated = false,
      username,
      displayName,
      actingAsUser = null,
      onActingAsUserChange,
      adminUsers = EMPTY_ADMIN_USERS,
      isAdminUsersLoading = false,
      adminUsersError = null,
      hasLoadedAdminUsers = false,
      onLoadAdminUsers,
      onLogout,
      contentType = 'ebook',
      onContentTypeChange,
      allowedContentTypes,
      combinedMode,
      combinedModeLocked,
      onCombinedModeChange,
      queryTargets = EMPTY_QUERY_TARGETS,
      activeQueryTarget = 'general',
      onQueryTargetChange,
      activeQueryField = null,
    },
    ref,
  ) => {
    const searchBarRef = useRef<SearchBarHandle>(null);

    useImperativeHandle(ref, () => ({
      submitSearch: () => {
        searchBarRef.current?.submit();
      },
    }));
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [isClosing, setIsClosing] = useState(false);
    const [shouldAnimateIn, setShouldAnimateIn] = useState(false);
    let dropdownAnimationClass = '';
    if (isClosing) {
      dropdownAnimationClass = 'animate-fade-out-up';
    } else if (shouldAnimateIn) {
      dropdownAnimationClass = 'animate-fade-in-down';
    }
    const dropdownRef = useRef<HTMLDivElement>(null);

    const actingAsOptions = useMemo(
      () => [
        { value: '', label: 'Myself' },
        ...adminUsers.map((user) => {
          const displayLabel = formatActingAsUserName(user);
          return {
            value: String(user.id),
            label: displayLabel,
            description: displayLabel !== user.username ? `@${user.username}` : undefined,
          };
        }),
      ],
      [adminUsers],
    );

    const selectedActingAsValue = actingAsUser ? String(actingAsUser.id) : '';
    const dropdownPanelWidthClass = 'w-48';

    useMountEffect(() => {
      const saved = localStorage.getItem('preferred-theme') || 'auto';
      applyTheme(saved);

      // Remove preload class and inline theme-init styles now that the
      // external CSS is loaded and React has mounted.
      requestAnimationFrame(() => {
        document.documentElement.classList.remove('preload');
        document.getElementById('theme-init')?.remove();
      });
    });

    useMountEffect(() => {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = (e: MediaQueryListEvent) => {
        if (localStorage.getItem('preferred-theme') === 'auto') {
          const effective = e.matches ? 'dark' : 'light';
          document.documentElement.setAttribute('data-theme', effective);
          document.documentElement.style.colorScheme = effective;
        }
      };
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    });

    // Helper function to close dropdown with animation
    const closeDropdown = () => {
      setIsClosing(true);
      setTimeout(() => {
        setIsDropdownOpen(false);
        setIsClosing(false);
      }, 150); // Match the animation duration
    };

    useDismiss(isDropdownOpen && !isClosing, [dropdownRef], closeDropdown);

    const handleLogout = () => {
      closeDropdown();
      onLogout?.();
    };

    const toggleDropdown = () => {
      if (isDropdownOpen) {
        closeDropdown();
      } else {
        if (isAdmin && !hasLoadedAdminUsers && !isAdminUsersLoading) {
          void onLoadAdminUsers?.();
        }
        setShouldAnimateIn(true);
        setIsDropdownOpen(true);
        // Reset animation flag after animation completes
        setTimeout(() => setShouldAnimateIn(false), 200);
      }
    };

    const handleHeaderSearch = () => {
      onSearch?.();
    };

    const handleSearchChange = (value: string | number | boolean, label?: string) => {
      onSearchChange?.(value, label);
    };

    const handleActingAsChange = (nextValue: string[] | string) => {
      if (Array.isArray(nextValue)) {
        return;
      }

      if (nextValue === '') {
        onActingAsUserChange?.(null);
        return;
      }

      const selectedUser = adminUsers.find((user) => String(user.id) === nextValue);
      if (!selectedUser) {
        return;
      }

      onActingAsUserChange?.(selectedUser);
    };

    const showAccount = authRequired && isAuthenticated && Boolean(username);
    const showActingAs = isAdmin && Boolean(onActingAsUserChange);
    const accountName = displayName || username || '';

    // With both links set the bar is crowded: their names show only on wide screens.
    const linkLabelClass =
      calibreWebUrl && audiobookLibraryUrl
        ? 'hidden text-sm font-medium xl:inline'
        : 'hidden text-sm font-medium lg:inline';

    const logoNode = logoUrl ? <img src={logoUrl} alt="" className="h-8 w-8 shrink-0" /> : null;

    return (
      <header
        className="w-full border-b border-(--border-muted) bg-(--bg-soft)"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2 px-3 py-2 lg:flex-nowrap lg:pl-0">
          {onMenuClick && (
            <button
              type="button"
              onClick={onMenuClick}
              className="hover-action rounded-full p-2 lg:hidden"
              aria-label="Open menu"
            >
              <svg
                className="h-6 w-6"
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
                  d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
                />
              </svg>
            </button>
          )}

          {/* Logo and name, as wide as the navigation column below it */}
          {onLogoClick ? (
            <button
              type="button"
              onClick={onLogoClick}
              className="flex shrink-0 cursor-pointer items-center gap-2.5 border-0 bg-transparent p-0 lg:w-56 lg:pl-4"
              aria-label={`${title}: back to search`}
            >
              {logoNode}
              <span className="hidden text-lg font-semibold sm:inline">{title}</span>
            </button>
          ) : (
            <div className="flex shrink-0 items-center gap-2.5 lg:w-56 lg:pl-4">
              {logoNode}
              <span className="hidden text-lg font-semibold sm:inline">{title}</span>
            </div>
          )}

          {/* Search: its own row on small screens, between the logo and the buttons on wide ones.
              The box is positioned so its Content / Search by panel floats below the bar. */}
          <div className="relative order-last w-full min-w-0 md:order-none md:w-auto md:max-w-3xl md:flex-1">
            <SearchBar
              ref={searchBarRef}
              value={searchInput}
              valueLabel={searchInputLabel}
              onChange={handleSearchChange}
              onSuggestionPick={onSuggestionPick}
              onSubmit={handleHeaderSearch}
              onAdvancedToggle={onAdvancedToggle}
              isAdvancedActive={isAdvancedActive}
              isLoading={isLoading}
              contentType={contentType}
              onContentTypeChange={onContentTypeChange}
              allowedContentTypes={allowedContentTypes}
              combinedMode={combinedMode}
              combinedModeLocked={combinedModeLocked}
              onCombinedModeChange={onCombinedModeChange}
              queryTargets={queryTargets}
              activeQueryTarget={activeQueryTarget}
              onQueryTargetChange={onQueryTargetChange}
              activeQueryField={activeQueryField}
              floatingControlsPanel
            />
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-1 lg:pr-3">
            {/* Book Library Button */}
            {calibreWebUrl && (
              <a
                href={calibreWebUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="hover-action flex items-center gap-2 rounded-full px-3 py-2 text-gray-900 transition-all duration-200 dark:text-gray-100"
                aria-label={`Open ${calibreWebName}`}
                title={calibreWebName}
              >
                <LibraryAppIcon className="h-5 w-5" />
                <span className={linkLabelClass}>{calibreWebName}</span>
              </a>
            )}

            {/* Audiobook Library Button */}
            {audiobookLibraryUrl && (
              <a
                href={audiobookLibraryUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="hover-action flex items-center gap-2 rounded-full px-3 py-2 text-gray-900 transition-all duration-200 dark:text-gray-100"
                aria-label={`Open ${audiobookLibraryName}`}
                title={audiobookLibraryName}
              >
                <LibraryAppIcon className="h-5 w-5" />
                <span className={linkLabelClass}>{audiobookLibraryName}</span>
              </a>
            )}

            {/* MyAnonamouse account, with its ratio and unsatisfied count */}
            {onMamAccountClick && <MamHeaderButton key={mamStatsKey} onClick={onMamAccountClick} />}

            <ThemeToggle />

            {/* Account menu: who is signed in, and who admins download for */}
            {(showAccount || showActingAs) && (
              <div className="relative" ref={dropdownRef}>
                <button
                  type="button"
                  onClick={toggleDropdown}
                  className={`hover-action relative rounded-full p-1.5 transition-colors ${
                    isDropdownOpen ? 'bg-(--hover-action)' : ''
                  }`}
                  aria-label="Account menu"
                  aria-expanded={isDropdownOpen}
                  aria-haspopup="true"
                  title={showAccount ? accountName : 'Account'}
                >
                  {showAccount ? (
                    <span
                      className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold uppercase"
                      style={{ backgroundColor: 'var(--hover-action)', color: 'var(--text)' }}
                    >
                      {accountName.slice(0, 2)}
                    </span>
                  ) : (
                    <svg
                      className="h-7 w-7"
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
                        d="M17.982 18.725A7.488 7.488 0 0 0 12 15.75a7.488 7.488 0 0 0-5.982 2.975m11.963 0a9 9 0 1 0-11.963 0m11.963 0A8.966 8.966 0 0 1 12 21a8.966 8.966 0 0 1-5.982-2.275M15 9.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
                      />
                    </svg>
                  )}
                  {actingAsUser && (
                    <span
                      className="absolute top-0.5 right-0.5 h-2.5 w-2.5 rounded-full border border-(--bg-soft) bg-sky-500"
                      title={`Downloading as ${formatActingAsUserName(actingAsUser)}`}
                    />
                  )}
                </button>

                {(isDropdownOpen || isClosing) && (
                  <div
                    className={`absolute right-0 mt-2 ${dropdownPanelWidthClass} z-50 rounded-lg border shadow-lg ${
                      dropdownAnimationClass
                    }`}
                    style={{
                      background: 'var(--bg)',
                      borderColor: 'var(--border-muted)',
                    }}
                  >
                    {showAccount && (
                      <div className="flex items-center gap-2.5 px-4 py-3">
                        <span
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold uppercase"
                          style={{ backgroundColor: 'var(--hover-surface)', color: 'var(--text)' }}
                        >
                          {accountName.slice(0, 2)}
                        </span>
                        <div className="min-w-0 flex-1 truncate text-sm font-medium">
                          {accountName}
                        </div>
                        {onLogout && (
                          <button
                            type="button"
                            onClick={handleLogout}
                            className="hover-action shrink-0 rounded-full p-2 text-red-600 transition-colors dark:text-red-400"
                            title="Sign Out"
                            aria-label="Sign Out"
                          >
                            <svg
                              className="h-5 w-5"
                              xmlns="http://www.w3.org/2000/svg"
                              fill="none"
                              viewBox="0 0 24 24"
                              strokeWidth="1.5"
                              stroke="currentColor"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9"
                              />
                            </svg>
                          </button>
                        )}
                      </div>
                    )}

                    {showActingAs && (
                      <div
                        className={`space-y-2 px-4 py-3 ${showAccount ? 'border-t' : ''}`}
                        style={{ borderColor: 'var(--border-muted)' }}
                      >
                        <div className="text-xs font-medium tracking-wide uppercase opacity-70">
                          Download as
                        </div>
                        <div
                          className={isAdminUsersLoading ? 'pointer-events-none opacity-60' : ''}
                        >
                          <DropdownList
                            options={actingAsOptions}
                            value={selectedActingAsValue}
                            onChange={handleActingAsChange}
                            placeholder="Myself"
                            widthClassName="w-full"
                            buttonClassName="rounded-lg text-sm"
                          />
                        </div>
                        {isAdminUsersLoading && (
                          <div className="text-xs opacity-70">Loading users...</div>
                        )}
                        {adminUsersError && (
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-xs text-red-600 dark:text-red-400">
                              {adminUsersError}
                            </div>
                            <button
                              type="button"
                              onClick={() => void onLoadAdminUsers?.()}
                              className="text-xs font-medium text-sky-600 hover:text-sky-700 dark:text-sky-400 dark:hover:text-sky-300"
                            >
                              Retry
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </header>
    );
  },
);
