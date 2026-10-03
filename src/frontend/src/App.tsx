import type { CSSProperties, ReactNode } from 'react';
import { useState, useCallback, useRef, useMemo } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';

import {
  ACTIVITY_TAB_LABELS,
  ActivityPage,
  type ActivityItem,
  type ActivityTabKey,
} from './components/activity';
import { SavedPanel } from './components/activity/SavedPanel';
import { AdvancedFilters } from './components/AdvancedFilters';
import { ConfigSetupBanner } from './components/ConfigSetupBanner';
import { DetailsModal, type DetailsNotice } from './components/DetailsModal';
import { Header } from './components/Header';
import { AppSidebar, type NavItem } from './components/layout/AppSidebar';
import { LibraryPage } from './components/library/LibraryPage';
import { MamAccountModal } from './components/MamAccountModal';
import { MamBufferModal } from './components/MamBufferModal';
import { MetadataConfigSession } from './components/MetadataConfigSession';
import { OnBehalfConfirmationModal } from './components/OnBehalfConfirmationModal';
import { OnboardingModal } from './components/OnboardingModal';
import { ReleaseModal } from './components/ReleaseModal';
import { RequestConfirmationModal } from './components/RequestConfirmationModal';
import { ResultsSection } from './components/ResultsSection';
import type { SuggestionPickResult } from './components/SearchBar';
import {
  SETTINGS_CATEGORIES,
  SelfSettingsModal,
  SettingsPage,
  parseSettingsRoute,
  resolveSettingsCategory,
  settingsPath,
} from './components/settings';
import { SystemPage } from './components/system/SystemPage';
import { ToastContainer } from './components/ToastContainer';
import { UrlSearchBootstrapMount } from './components/UrlSearchBootstrapMount';
import {
  BookActivityLoader,
  BookActivityProvider,
  useBookActivityStore,
} from './contexts/BookActivityContext';
import {
  SavedItemsLoader,
  SavedItemsProvider,
  useSavedItemsStore,
  type SavedContentType,
} from './contexts/SavedItemsContext';
import { SearchModeProvider } from './contexts/SearchModeContext';
import { useSocket } from './contexts/SocketContext';
import { DEFAULT_LANGUAGES, DEFAULT_SUPPORTED_FORMATS } from './data/languages';
import { useBookTargetDeselectSync } from './hooks/app/useBookTargetDeselectSync';
import { useContentTypePreferences } from './hooks/app/useContentTypePreferences';
import { useShowOnboardingDebug } from './hooks/app/useShowOnboardingDebug';
import { useStatusChangeNotifications } from './hooks/app/useStatusChangeNotifications';
import {
  resolveDefaultModeFromPolicy,
  resolveSourceModeFromPolicy,
} from './hooks/requestPolicyCore';
import { useActivity } from './hooks/useActivity';
import { useAuth } from './hooks/useAuth';
import { useDownloadTracking } from './hooks/useDownloadTracking';
import { useLatestCallback } from './hooks/useLatestCallback';
import { useMountEffect } from './hooks/useMountEffect';
import { useRealtimeStatus } from './hooks/useRealtimeStatus';
import { useRequestPolicy } from './hooks/useRequestPolicy';
import { useRequests } from './hooks/useRequests';
import { useSearch } from './hooks/useSearch';
import { primeSettingsCache } from './hooks/useSettings';
import { useToast } from './hooks/useToast';
import { useExternalHashChange, useSyncUrlSearchHash, useUrlSearch } from './hooks/useUrlSearch';
import { primeUsersCache } from './hooks/useUsersFetch';
import { LoginPage } from './pages/LoginPage';
import {
  getSourceRecordInfo,
  getMetadataBookInfo,
  downloadRelease,
  cancelDownload,
  retryDownload,
  getConfig,
  getStatus,
  getAdminUsers,
  getMetadataProviders,
  getMetadataSearchConfig,
  createRequests,
  isApiResponseError,
  updateSelfUser,
  setBookTargetState,
  checkMamBuffer,
  getMamRatio,
  type DownloadReleasePayload,
  type DynamicFieldOption,
} from './services/api';
import type {
  Book,
  Release,
  RequestRecord,
  RequestSubmissionResult,
  StatusData,
  AppConfig,
  ContentType,
  ButtonStateInfo,
  RequestPolicyMode,
  CreateRequestPayload,
  ActingAsUserSelection,
  MetadataProviderSummary,
  MetadataSearchConfig,
  MetadataSearchField,
  QueuedDownloadResult,
  QueryTargetOption,
  SearchMode,
} from './types';
import { isMetadataBook } from './types';
import { formatActingAsUserName } from './utils/actingAsUser';
import { getActivityBadgeState } from './utils/activityBadge';
import { findActivityBook, findLibraryLink } from './utils/activityBook';
import { buildLoginRedirectPath, getReturnToFromSearch } from './utils/authRedirect';
import { withBasePath } from './utils/basePath';
import { emitBookTargetChange } from './utils/bookTargetEvents';
import { bookSupportsTargets } from './utils/bookTargetLoader';
import { buildSearchQuery } from './utils/buildSearchQuery';
import { isPartRelease, releaseNarrators } from './utils/combinedSelection';
import { wasDownloadQueuedAfterResponseError } from './utils/downloadRecovery';
import { getDynamicOptionGroup } from './utils/dynamicFieldOptions';
import { resolveDefaultLanguageCodes } from './utils/languageFilters';
import type { MamBufferCheck, MamRatioSnapshot } from './utils/mamRatio';
import { getConfiguredMetadataProviderForContentType } from './utils/metadataProviders';
import { getEffectiveMetadataSort } from './utils/metadataSort';
import { isRecord } from './utils/objectHelpers';
import { policyTrace } from './utils/policyTrace';
import {
  buildQueryTargets,
  findQueryTarget,
  generalSuggestionAction,
  getDefaultQueryTargetKey,
  searchBarQueryField,
} from './utils/queryTargets';
import { buildReleaseDownloadPayload, type ReleaseDownloadOptions } from './utils/releasePayload';
import { applyRequestNoteToPayload } from './utils/requestConfirmation';
import { bookFromRequestData } from './utils/requestFulfil';
import {
  buildDirectRequestPayload,
  buildReleaseDataFromDirectBook,
  buildMetadataBookRequestData,
  buildReleaseDataFromMetadataRelease,
  getBrowseSource,
  getRequestSuccessMessage,
  toContentType,
} from './utils/requestPayload';
import {
  applyDirectPolicyModeToButtonState,
  applyUniversalPolicyModeToButtonState,
} from './utils/requestPolicyUi';
import {
  combinedPicks,
  savedStage,
  type SavedItem,
  type SavedPick,
  type SavedStage,
} from './utils/savedItems';
import { getSearchByPreference, setSearchByPreference } from './utils/searchByPreference';
import { buildUrlSearchHash } from './utils/urlSearchHash';

// eslint-disable-next-line import/no-unassigned-import -- global app stylesheet is loaded for side effects
import './styles.css';

const ACTIVITY_TABS: ActivityTabKey[] = ['queued', 'downloads', 'requests', 'history'];

// The section of the app a path belongs to, for the navigation and the main content.
type AppSection = 'search' | 'library' | 'activity' | 'wanted' | 'settings' | 'system';
const sectionOfPath = (pathname: string): AppSection => {
  const [, first] = pathname.split('/');
  if (
    first === 'library' ||
    first === 'activity' ||
    first === 'wanted' ||
    first === 'settings' ||
    first === 'system'
  ) {
    return first;
  }
  return 'search';
};

// Loads the activity history when the History page opens.
const ActivityHistoryLoader = ({ onLoad }: { onLoad: () => void }) => {
  useMountEffect(() => {
    onLoad();
  });
  return null;
};

const POLICY_GUARD_ERROR_CODES = new Set(['policy_requires_request', 'policy_blocked']);
const isPolicyGuardError = (error: unknown): boolean => {
  return (
    isApiResponseError(error) &&
    error.status === 403 &&
    Boolean(error.code && POLICY_GUARD_ERROR_CODES.has(error.code))
  );
};

const asRequestPolicyMode = (value: unknown): RequestPolicyMode | null => {
  return value === 'download' ||
    value === 'request_release' ||
    value === 'request_book' ||
    value === 'blocked'
    ? value
    : null;
};

const getPolicyGuardRequiredMode = (error: unknown): RequestPolicyMode | null => {
  if (!isPolicyGuardError(error) || !isApiResponseError(error)) {
    return null;
  }
  const explicitMode = asRequestPolicyMode(error.requiredMode);
  if (explicitMode) {
    return explicitMode;
  }
  if (error.code === 'policy_blocked') {
    return 'blocked';
  }
  return null;
};

const getErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
};

const isQueuedDownloadResult = (value: unknown): value is QueuedDownloadResult => {
  if (!isRecord(value)) {
    return false;
  }

  return value.kind === 'download' && value.status === 'queued';
};

const getSubmissionSuccessMessage = (
  results: RequestSubmissionResult[],
  fallback: string,
): string => {
  const queuedDownloads = results.filter(isQueuedDownloadResult);
  if (queuedDownloads.length === 0) {
    return fallback;
  }

  if (queuedDownloads.length === results.length) {
    if (queuedDownloads.length === 1) {
      const title =
        typeof queuedDownloads[0].title === 'string' && queuedDownloads[0].title.trim()
          ? queuedDownloads[0].title.trim()
          : 'Untitled';
      return `Download queued: ${title}`;
    }
    return 'Downloads queued';
  }

  return 'Download queued and request submitted';
};

const CONFIRMED_DOWNLOAD_INTERRUPTED_MESSAGE =
  'Download queued, but the proxy interrupted the response. Status will refresh shortly.';

type CombinedSelectionState = {
  phase: 'ebook' | 'audiobook';
  ebookMode: RequestPolicyMode;
  audiobookMode: RequestPolicyMode;
  stagedEbook?: { book: Book; release: Release };
  // Any number: one per narration the user wants.
  stagedAudiobooks: Release[];
};

// What "Save for later" in the MAM hold-back prompt keeps: the exact picks being downloaded.
type HoldBackSaveTarget = {
  book: Book;
  contentType: SavedContentType;
  picks: SavedPick[];
  onSaved?: () => void;
};

type PendingOnBehalfDownload =
  | {
      type: 'book';
      book: Book;
      actingAsUser: ActingAsUserSelection;
    }
  | {
      type: 'release';
      book: Book;
      release: Release;
      releaseContentType: ContentType;
      actingAsUser: ActingAsUserSelection;
      options?: ReleaseDownloadOptions;
    }
  | {
      type: 'combined';
      book: Book;
      combinedState: CombinedSelectionState;
      actingAsUser: ActingAsUserSelection;
    };

interface AuthenticatedAppBootstrapProps {
  refreshStatus: () => Promise<void>;
  refreshRequestPolicy: (options?: { force?: boolean }) => Promise<unknown>;
  refreshActivitySnapshot: () => Promise<void>;
  loadConfig: (mode?: 'initial' | 'settings-saved') => void | Promise<void>;
}

const AuthenticatedAppBootstrap = ({
  refreshStatus,
  refreshRequestPolicy,
  refreshActivitySnapshot,
  loadConfig,
}: AuthenticatedAppBootstrapProps) => {
  useMountEffect(() => {
    void refreshStatus();
    void refreshRequestPolicy({ force: true });
    void refreshActivitySnapshot();
    void loadConfig('initial');
  });

  return null;
};

const AdminSettingsWarmupMount = () => {
  useMountEffect(() => {
    void primeUsersCache();
    void primeSettingsCache();
  });

  return null;
};

function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const section = sectionOfPath(location.pathname);
  const { toasts, showToast, removeToast } = useToast();
  const { socket } = useSocket();

  // Realtime status with WebSocket and polling fallback
  // Socket connection is managed by SocketProvider in main.tsx
  const { status: currentStatus, forceRefresh: fetchStatus } = useRealtimeStatus({
    pollInterval: 5000,
  });

  // Download tracking for universal mode
  const {
    bookToReleaseMap,
    trackRelease,
    markBookCompleted,
    clearTracking,
    getButtonState,
    getUniversalButtonState,
  } = useDownloadTracking(currentStatus);

  // Authentication state and handlers
  // Initialized first since search hook needs auth state
  const {
    isAuthenticated,
    authRequired,
    authChecked,
    isAdmin: authIsAdmin,
    authMode,
    username,
    displayName,
    oidcButtonLabel,
    hideLocalAuth,
    oidcAutoRedirect,
    loginError,
    isLoggingIn,
    setIsAuthenticated,
    refreshAuth,
    handleLogin,
    handleLogout,
  } = useAuth({
    showToast,
  });

  // Declared here because the content type default below reads from it
  const [config, setConfig] = useState<AppConfig | null>(null);

  // Content type state (ebook vs audiobook) - defined before useSearch since it's passed to it
  const { contentType, setContentType, combinedMode, setCombinedMode } = useContentTypePreferences(
    config?.default_content_type,
  );

  const {
    policy: requestPolicy,
    getDefaultMode,
    getSourceMode,
    requestsEnabled: requestsPolicyEnabled,
    allowNotes: allowRequestNotes,
    refresh: refreshRequestPolicy,
  } = useRequestPolicy({
    enabled: isAuthenticated,
    isAdmin: authIsAdmin,
  });

  const requestRoleIsAdmin = requestPolicy?.is_admin ?? false;

  // Compute which content types this user is allowed to search for.
  // If a content type's default policy mode is 'blocked', hide it from the dropdown.
  const allowedContentTypes = useMemo((): ContentType[] => {
    // If policy not loaded yet or user is admin, allow everything
    if (!requestPolicy || requestRoleIsAdmin || !requestsPolicyEnabled) {
      return ['ebook', 'audiobook'];
    }
    const types: ContentType[] = [];
    if (getDefaultMode('ebook') !== 'blocked') types.push('ebook');
    if (getDefaultMode('audiobook') !== 'blocked') types.push('audiobook');
    // If both are blocked, still show both (user can see results, just can't download)
    return types.length > 0 ? types : ['ebook', 'audiobook'];
  }, [requestPolicy, requestRoleIsAdmin, requestsPolicyEnabled, getDefaultMode]);

  const effectiveContentType = useMemo(
    () =>
      allowedContentTypes.includes(contentType)
        ? contentType
        : (allowedContentTypes[0] ?? contentType),
    [allowedContentTypes, contentType],
  );

  const {
    cancelRequest: cancelUserRequest,
    fulfilRequest: fulfilSidebarRequest,
    rejectRequest: rejectSidebarRequest,
  } = useRequests({
    isAdmin: requestRoleIsAdmin,
  });

  const {
    activityStatus,
    requestItems,
    dismissedActivityKeys,
    historyItems,
    activityHistoryLoaded,
    pendingRequestCount,
    isActivitySnapshotLoading,
    activityHistoryLoading,
    activityHistoryHasMore,
    refreshActivitySnapshot,
    refreshActivityHistory,
    resetActivity,
    handleActivityTabChange,
    handleActivityHistoryLoadMore,
    handleRequestDismiss,
    handleDownloadDismiss,
    handleClearCompleted,
  } = useActivity({
    isAuthenticated,
    isAdmin: requestRoleIsAdmin,
    showToast,
    socket,
  });

  const dismissedDownloadTaskIds = useMemo(() => {
    const result = new Set<string>();
    for (const key of dismissedActivityKeys) {
      if (typeof key !== 'string' || !key.startsWith('download:')) {
        continue;
      }
      const taskId = key.substring('download:'.length).trim();
      if (taskId) {
        result.add(taskId);
      }
    }
    return result;
  }, [dismissedActivityKeys]);

  const isDownloadTaskDismissed = useCallback(
    (taskId: string) => {
      return dismissedDownloadTaskIds.has(taskId);
    },
    [dismissedDownloadTaskIds],
  );

  const statusForButtonState = useMemo(() => {
    if (!currentStatus.complete || dismissedDownloadTaskIds.size === 0) {
      return currentStatus;
    }

    const filteredComplete = Object.fromEntries(
      Object.entries(currentStatus.complete).filter(
        ([taskId]) => !dismissedDownloadTaskIds.has(taskId),
      ),
    ) as Record<string, Book>;

    if (Object.keys(filteredComplete).length === Object.keys(currentStatus.complete).length) {
      return currentStatus;
    }

    return {
      ...currentStatus,
      complete: filteredComplete,
    };
  }, [currentStatus, dismissedDownloadTaskIds]);

  // Use real-time buckets for active work and persisted activity snapshot
  // buckets for terminal history. Filter out dismissed items so the sidebar
  // counts stay consistent with the activity panel.
  const activitySidebarStatus = useMemo<StatusData>(() => {
    const filterDismissed = (
      bucket: Record<string, Book> | undefined,
    ): Record<string, Book> | undefined => {
      if (!bucket || dismissedDownloadTaskIds.size === 0) return bucket;
      const filtered = Object.fromEntries(
        Object.entries(bucket).filter(([taskId]) => !dismissedDownloadTaskIds.has(taskId)),
      ) as Record<string, Book>;
      return Object.keys(filtered).length > 0 ? filtered : undefined;
    };

    return {
      queued: currentStatus.queued,
      resolving: currentStatus.resolving,
      locating: currentStatus.locating,
      downloading: currentStatus.downloading,
      complete: filterDismissed(activityStatus.complete),
      error: filterDismissed(activityStatus.error),
      cancelled: filterDismissed(activityStatus.cancelled),
    };
  }, [activityStatus, currentStatus, dismissedDownloadTaskIds]);

  const showRequestsTab = useMemo(() => {
    if (requestRoleIsAdmin) {
      return true;
    }
    if (!isAuthenticated || !requestsPolicyEnabled) {
      return false;
    }
    if (!requestPolicy) {
      return false;
    }
    return !(
      requestPolicy.defaults.ebook === 'download' && requestPolicy.defaults.audiobook === 'download'
    );
  }, [requestRoleIsAdmin, isAuthenticated, requestsPolicyEnabled, requestPolicy]);

  // Search state and handlers
  const {
    books,
    setBooks,
    isSearching,
    searchInput,
    setSearchInput,
    showAdvanced,
    setShowAdvanced,
    advancedFilters,
    setAdvancedFilters,
    updateAdvancedFilters,
    handleSearch,
    handleResetSearch,
    reSortByDownloads,
    searchFieldValues,
    updateSearchFieldValue,
    searchFieldLabels,
    // Pagination (universal mode)
    hasMore,
    isLoadingMore,
    loadMore,
    totalFound,
    directTotalResults,
    resultsSourceUrl,
  } = useSearch({
    showToast,
    setIsAuthenticated,
    authRequired,
    onSearchReset: clearTracking,
    contentType: effectiveContentType,
  });

  // When a book is removed from the Hardcover list currently being browsed, remove it from results
  useBookTargetDeselectSync({
    activeListValue: searchFieldValues.hardcover_list,
    setBooks,
  });

  const [pendingRequestPayload, setPendingRequestPayload] = useState<CreateRequestPayload | null>(
    null,
  );
  const [pendingRequestExtraPayloads, setPendingRequestExtraPayloads] = useState<
    CreateRequestPayload[]
  >([]);
  const [actingAsUser, setActingAsUser] = useState<ActingAsUserSelection | null>(null);
  const [adminUsers, setAdminUsers] = useState<ActingAsUserSelection[]>([]);
  const [isAdminUsersLoading, setIsAdminUsersLoading] = useState(false);
  const [adminUsersError, setAdminUsersError] = useState<string | null>(null);
  const [hasLoadedAdminUsers, setHasLoadedAdminUsers] = useState(false);
  const [pendingOnBehalfDownload, setPendingOnBehalfDownload] =
    useState<PendingOnBehalfDownload | null>(null);
  const [fulfillingRequest, setFulfillingRequest] = useState<{
    requestId: number;
    book: Book;
    contentType: ContentType;
  } | null>(null);
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);
  // A note shown with one book's details (a failed download, from Activity).
  const [detailsNotice, setDetailsNotice] = useState<{
    bookId: string;
    notice: DetailsNotice;
  } | null>(null);
  const [releaseBook, setReleaseBook] = useState<Book | null>(null);
  const [activeResultsSort, setActiveResultsSort] = useState('');

  const resetSearchResultsState = useCallback(() => {
    setBooks([]);
    setSelectedBook(null);
    setReleaseBook(null);
    setActiveResultsSort('');
    clearTracking();
  }, [clearTracking, setBooks]);

  const loadAdminUsers = useCallback(async () => {
    if (!isAuthenticated || !authIsAdmin || !requestRoleIsAdmin) {
      return;
    }

    setIsAdminUsersLoading(true);
    setAdminUsersError(null);
    try {
      const users = await getAdminUsers();
      const nextAdminUsers = users.map((user) => ({
        id: user.id,
        username: user.username,
        displayName: user.display_name,
      }));
      const availableNextAdminUsers = nextAdminUsers.filter((user) => {
        return !username || user.username !== username;
      });

      setAdminUsers(nextAdminUsers);
      setHasLoadedAdminUsers(true);

      if (actingAsUser && !availableNextAdminUsers.some((user) => user.id === actingAsUser.id)) {
        setActingAsUser(null);
        setPendingOnBehalfDownload(null);
      }
    } catch (error) {
      console.error('Failed to load admin users:', error);
      setAdminUsersError('Failed to load users');
    } finally {
      setIsAdminUsersLoading(false);
    }
  }, [actingAsUser, authIsAdmin, isAuthenticated, requestRoleIsAdmin, username]);

  const availableActingAsUsers = useMemo(() => {
    return adminUsers.filter((user) => !username || user.username !== username);
  }, [adminUsers, username]);

  const effectiveActingAsUser = useMemo(() => {
    if (!actingAsUser || !isAuthenticated || !authIsAdmin || !requestRoleIsAdmin) {
      return null;
    }
    if (username && actingAsUser.username === username) {
      return null;
    }
    if (hasLoadedAdminUsers && !isAdminUsersLoading) {
      return availableActingAsUsers.some((user) => user.id === actingAsUser.id)
        ? actingAsUser
        : null;
    }
    return actingAsUser;
  }, [
    actingAsUser,
    authIsAdmin,
    availableActingAsUsers,
    hasLoadedAdminUsers,
    isAdminUsersLoading,
    isAuthenticated,
    requestRoleIsAdmin,
    username,
  ]);

  const effectivePendingOnBehalfDownload = useMemo(() => {
    if (!pendingOnBehalfDownload || !effectiveActingAsUser) {
      return null;
    }

    if (pendingOnBehalfDownload.actingAsUser.id !== effectiveActingAsUser.id) {
      return null;
    }

    return {
      ...pendingOnBehalfDownload,
      actingAsUser: effectiveActingAsUser,
    };
  }, [effectiveActingAsUser, pendingOnBehalfDownload]);

  // Combined mode state (ebook + audiobook in one transaction)
  const [combinedState, setCombinedState] = useState<CombinedSelectionState | null>(null);

  const [metadataProviders, setMetadataProviders] = useState<MetadataProviderSummary[]>([]);
  const [configuredMetadataProvider, setConfiguredMetadataProvider] = useState<string | null>(null);
  const [configuredAudiobookMetadataProvider, setConfiguredAudiobookMetadataProvider] = useState<
    string | null
  >(null);
  const [configuredCombinedMetadataProvider, setConfiguredCombinedMetadataProvider] = useState<
    string | null
  >(null);
  // Falls back to the stored "Search By" default from the user's last-used mode;
  // an invalid/stale value is harmless since effectiveActiveQueryTarget below re-validates
  // it against the current queryTargets once config/search fields are known.
  const [activeQueryTarget, setActiveQueryTarget] = useState(
    () => getSearchByPreference() || 'general',
  );
  // The navigation drawer on small screens.
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [headerHeight, setHeaderHeight] = useState(0);
  const headerObserverRef = useRef<ResizeObserver | null>(null);
  const showDownloadsPage = useCallback(() => {
    void navigate('/activity/downloads');
  }, [navigate]);
  const headerRef = useCallback((el: HTMLDivElement | null) => {
    if (headerObserverRef.current) {
      headerObserverRef.current.disconnect();
      headerObserverRef.current = null;
    }
    if (!el) return;
    setHeaderHeight(el.getBoundingClientRect().height);
    const observer = new ResizeObserver(() => {
      setHeaderHeight(el.getBoundingClientRect().height);
    });
    observer.observe(el);
    headerObserverRef.current = observer;
  }, []);
  const [mamAccountOpen, setMamAccountOpen] = useState(false);
  // Bumped when the account dialog closes, so the header re-reads ratio and unsatisfied.
  const [mamStatsKey, setMamStatsKey] = useState(0);
  // Account figures for the projected-ratio line in the combined picker.
  const [mamRatio, setMamRatio] = useState<MamRatioSnapshot | null>(null);
  const [mamBufferPrompt, setMamBufferPrompt] = useState<{
    check: MamBufferCheck;
    releases: DownloadReleasePayload[];
    saveTarget?: HoldBackSaveTarget;
    resolve: (proceed: boolean) => void;
  } | null>(null);
  const [selfSettingsOpen, setSelfSettingsOpen] = useState(false);
  const [configBannerOpen, setConfigBannerOpen] = useState(false);

  // Wire up logout callback to clear search state
  const handleLogoutWithCleanup = useCallback(async () => {
    await handleLogout();
    resetSearchResultsState();
    setActiveQueryTarget('general');
    setPendingRequestPayload(null);
    setPendingRequestExtraPayloads([]);
    setActingAsUser(null);
    setAdminUsers([]);
    setAdminUsersError(null);
    setHasLoadedAdminUsers(false);
    setPendingOnBehalfDownload(null);
    setFulfillingRequest(null);
    resetActivity();
    setSelfSettingsOpen(false);
  }, [handleLogout, resetActivity, resetSearchResultsState]);

  const handleSettingsClick = useCallback(() => {
    if (config?.settings_enabled) {
      if (authIsAdmin) {
        void primeUsersCache();
        void primeSettingsCache();
        void navigate('/settings');
      } else {
        setSelfSettingsOpen(true);
      }
      return;
    }
    setConfigBannerOpen(true);
  }, [authIsAdmin, config?.settings_enabled, navigate]);

  const [onboardingOpen, setOnboardingOpen] = useState(false);
  useShowOnboardingDebug({
    setOnboardingOpen,
  });

  // URL-based search: parse URL params for automatic search on page load
  const urlSearchEnabled = isAuthenticated && config !== null;
  // Bumped when the hash changes to something we didn't write - a shared link pasted into
  // an already-open tab. Re-parses the URL and remounts the bootstrap so it applies.
  const [urlSearchNonce, setUrlSearchNonce] = useState(0);
  const { parsedParams, wasProcessed } = useUrlSearch({
    enabled: urlSearchEnabled,
    nonce: urlSearchNonce,
  });
  const [hasExecutedUrlSearchBootstrap, setHasExecutedUrlSearchBootstrap] = useState(false);
  // Same fact as the state above, readable from loadConfig's async continuation, which
  // closes over the render it started in and would otherwise see a stale `false`.
  const urlSearchBootstrapAppliedRef = useRef(false);
  useExternalHashChange(() => {
    urlSearchBootstrapAppliedRef.current = false;
    setHasExecutedUrlSearchBootstrap(false);
    setUrlSearchNonce((value) => value + 1);
  });

  const prevSearchModeRef = useRef<string | undefined>(undefined);

  // Calculate status counts for header badges (memoized)
  const statusCounts = useMemo(() => {
    const dismissedKeySet = new Set(dismissedActivityKeys);
    const countVisibleDownloads = (
      bucket: Record<string, Book> | undefined,
      options: { filterDismissed: boolean },
    ): number => {
      const { filterDismissed } = options;
      if (!bucket) {
        return 0;
      }
      if (!filterDismissed) {
        return Object.keys(bucket).length;
      }
      return Object.keys(bucket).filter((taskId) => !dismissedKeySet.has(`download:${taskId}`))
        .length;
    };

    const ongoing = [
      activitySidebarStatus.queued,
      activitySidebarStatus.resolving,
      activitySidebarStatus.locating,
      activitySidebarStatus.downloading,
    ].reduce((sum, status) => sum + countVisibleDownloads(status, { filterDismissed: false }), 0);

    const completed = countVisibleDownloads(activitySidebarStatus.complete, {
      filterDismissed: true,
    });
    const errored = countVisibleDownloads(activitySidebarStatus.error, { filterDismissed: true });
    const pendingVisibleRequests = requestItems.filter((item) => {
      const requestId = item.requestId;
      if (!requestId || item.requestRecord?.status !== 'pending') {
        return false;
      }
      return !dismissedKeySet.has(`request:${requestId}`);
    }).length;

    return {
      ongoing,
      completed,
      errored,
      pendingRequests: pendingVisibleRequests,
    };
  }, [activitySidebarStatus, dismissedActivityKeys, requestItems]);

  // Compute visibility states
  const hasResults = books.length > 0;
  const isInitialState = !hasResults;

  useStatusChangeNotifications({
    currentStatus,
    config,
    showToast,
    showDownloadsPage,
    bookToReleaseMap,
    markBookCompleted,
  });

  // Load config function
  const loadConfig = useCallback(
    async (mode: 'initial' | 'settings-saved' = 'initial') => {
      try {
        const [cfg, metadataProviderState] = await Promise.all([
          getConfig(),
          getMetadataProviders(),
        ]);
        const nextCombinedModeAllowed =
          cfg.search_mode === 'universal' &&
          (cfg.show_combined_selector ?? true) &&
          getDefaultMode('ebook') !== 'blocked' &&
          getDefaultMode('audiobook') !== 'blocked';
        const nextEffectiveCombinedMode =
          nextCombinedModeAllowed && (combinedMode || cfg.force_combined_search);
        const activeConfiguredProvider =
          nextEffectiveCombinedMode && metadataProviderState.configured_provider_combined
            ? metadataProviderState.configured_provider_combined
            : getConfiguredMetadataProviderForContentType({
                contentType: effectiveContentType,
                configuredMetadataProvider: metadataProviderState.configured_provider,
                configuredAudiobookMetadataProvider:
                  metadataProviderState.configured_provider_audiobook,
              });
        let nextMetadataConfig: MetadataSearchConfig | null = null;

        if (cfg.search_mode === 'universal') {
          try {
            nextMetadataConfig = await getMetadataSearchConfig(
              effectiveContentType,
              activeConfiguredProvider ?? undefined,
            );
          } catch (metadataConfigError) {
            console.error(
              'Failed to load metadata search config during config sync:',
              metadataConfigError,
            );
          }
        }

        const resolvedMetadataDefaultSort = getEffectiveMetadataSort({
          currentSort: '',
          defaultSort: nextMetadataConfig?.default_sort || cfg.metadata_default_sort || 'relevance',
          sortOptions: nextMetadataConfig?.sort_options ?? cfg.metadata_sort_options,
        });

        // Check if search mode changed (only on settings save)
        if (mode === 'settings-saved' && prevSearchModeRef.current !== cfg.search_mode) {
          resetSearchResultsState();
        }

        prevSearchModeRef.current = cfg.search_mode;
        setConfig({
          ...cfg,
          metadata_default_sort: resolvedMetadataDefaultSort,
          metadata_sort_options: nextMetadataConfig?.sort_options ?? cfg.metadata_sort_options,
        });
        setMetadataProviders(metadataProviderState.providers);
        setConfiguredMetadataProvider(metadataProviderState.configured_provider);
        setConfiguredAudiobookMetadataProvider(metadataProviderState.configured_provider_audiobook);
        setConfiguredCombinedMetadataProvider(metadataProviderState.configured_provider_combined);

        // Show onboarding modal on first run (settings enabled but not completed yet)
        if (mode === 'initial' && cfg.settings_enabled && !cfg.onboarding_complete) {
          setOnboardingOpen(true);
        }

        // Determine the default sort based on search mode
        const defaultSort =
          cfg.search_mode === 'universal' ? resolvedMetadataDefaultSort : (cfg.default_sort ?? '');

        if (cfg?.supported_formats) {
          // Seeding the defaults must not undo filters a shared link already applied.
          // The URL bootstrap is gated on config being loaded, so normally it runs after
          // this and wins on its own - but nothing guarantees this is the only 'initial'
          // load (React's StrictMode double-invokes the mount effect that triggers it in
          // development), and a late one would reset `formats` to the full supported list
          // and drop the link's own sort.
          if (mode === 'initial' && !urlSearchBootstrapAppliedRef.current) {
            setAdvancedFilters((prev) => ({
              ...prev,
              formats: cfg.supported_formats,
              sort: defaultSort,
            }));
          } else if (mode === 'settings-saved') {
            // On settings save, update formats and reset sort to new default
            setAdvancedFilters((prev) => ({
              ...prev,
              formats: prev.formats.filter((f) => cfg.supported_formats.includes(f)),
              sort: defaultSort,
            }));
          }
        }
      } catch (error) {
        console.error('Failed to load config:', error);
      }
    },
    [
      combinedMode,
      effectiveContentType,
      getDefaultMode,
      resetSearchResultsState,
      setAdvancedFilters,
    ],
  );

  const effectiveSearchMode: SearchMode = config?.search_mode ?? 'direct';

  // Combined mode requires universal mode, config enabled, and both content types accessible
  const combinedModeAllowed = useMemo(() => {
    if (effectiveSearchMode !== 'universal') return false;
    if (config?.show_combined_selector === false) return false;
    const ebookMode = getDefaultMode('ebook');
    const audiobookMode = getDefaultMode('audiobook');
    return ebookMode !== 'blocked' && audiobookMode !== 'blocked';
  }, [effectiveSearchMode, config?.show_combined_selector, getDefaultMode]);
  const combinedModeLocked = combinedModeAllowed && config?.force_combined_search === true;
  const effectiveCombinedMode = combinedModeAllowed && (combinedMode || combinedModeLocked);
  const savedStore = useSavedItemsStore({
    contentType: effectiveCombinedMode ? 'combined' : effectiveContentType,
    autoGetAvailable: Boolean(config?.saved_auto_get_enabled),
    onShowToast: showToast,
  });
  // Marks books already saved or downloaded, wherever they show.
  const bookActivity = useBookActivityStore({
    status: currentStatus,
    savedItems: savedStore.items,
  });
  // A book downloaded from Saved, or picked again and downloaded, leaves Saved: book-only
  // saves go with any of its releases, release picks only with one of the picked ones.
  const clearSavedAfterDownload = useCallback(
    (book: Book, release?: Release) => {
      const item = savedStore.savedFor(book);
      if (!item) return;
      const matches =
        !release ||
        item.kind === 'book' ||
        item.releases.some(
          (pick) =>
            pick.release.source === release.source && pick.release.source_id === release.source_id,
        );
      if (matches) void savedStore.remove(item, { quiet: true });
    },
    [savedStore],
  );
  const effectiveCombinedState = effectiveCombinedMode ? combinedState : null;

  const defaultMetadataProviderForContentType =
    effectiveCombinedMode && configuredCombinedMetadataProvider
      ? configuredCombinedMetadataProvider
      : getConfiguredMetadataProviderForContentType({
          contentType: effectiveContentType,
          configuredMetadataProvider,
          configuredAudiobookMetadataProvider,
        });
  const effectiveMetadataProvider =
    effectiveSearchMode === 'universal' ? defaultMetadataProviderForContentType || null : null;
  const metadataConfigSessionKey =
    isAuthenticated && effectiveSearchMode === 'universal'
      ? `${effectiveContentType}:${effectiveMetadataProvider ?? ''}`
      : null;
  const [activeMetadataConfigState, setActiveMetadataConfigState] = useState<{
    sessionKey: string;
    config: MetadataSearchConfig | null;
  } | null>(null);
  const activeMetadataConfig =
    metadataConfigSessionKey && activeMetadataConfigState?.sessionKey === metadataConfigSessionKey
      ? activeMetadataConfigState.config
      : null;
  const resolvedMetadataSortOptions = useMemo(
    () => activeMetadataConfig?.sort_options ?? config?.metadata_sort_options ?? [],
    [activeMetadataConfig?.sort_options, config?.metadata_sort_options],
  );
  const resolvedMetadataDefaultSort = useMemo(
    () =>
      getEffectiveMetadataSort({
        currentSort: '',
        defaultSort:
          activeMetadataConfig?.default_sort || config?.metadata_default_sort || 'relevance',
        sortOptions: resolvedMetadataSortOptions,
      }),
    [
      activeMetadataConfig?.default_sort,
      config?.metadata_default_sort,
      resolvedMetadataSortOptions,
    ],
  );

  // Non-admins in universal mode have nothing in the advanced panel
  const hasAdvancedContent = requestRoleIsAdmin || effectiveSearchMode === 'direct';
  const effectiveShowAdvanced = hasAdvancedContent ? showAdvanced : false;

  const runSearchWithPolicyRefresh = useCallback(
    (opts: {
      query: string;
      fieldValues?: Record<string, string | number | boolean>;
      contentTypeOverride?: ContentType;
      searchModeOverride?: SearchMode;
      providerOverride?: string;
      sort?: string;
    }) => {
      void refreshRequestPolicy();
      void handleSearch({
        query: opts.query,
        config,
        fieldValues: opts.fieldValues,
        contentTypeOverride: opts.contentTypeOverride,
        searchMode: opts.searchModeOverride,
        providerOverride: opts.providerOverride,
        sort: opts.sort,
      });
    },
    [refreshRequestPolicy, handleSearch, config],
  );

  const handleSettingsSaved = useCallback(() => {
    void loadConfig('settings-saved');
  }, [loadConfig]);

  // Show book details
  const handleShowDetails = async (id: string): Promise<void> =>
    showBookDetails(
      books.find((entry) => entry.id === id),
      id,
    );

  // Also used by the library browser, whose "missing" books are not search results.
  const showBookDetails = async (book: Book | undefined, id: string): Promise<void> => {
    const metadataBook = book && isMetadataBook(book) ? book : null;

    if (metadataBook) {
      try {
        const fullBook = await getMetadataBookInfo(metadataBook.provider, metadataBook.provider_id);
        setSelectedBook({
          ...metadataBook,
          description: fullBook.description || metadataBook.description,
          series_id: fullBook.series_id || metadataBook.series_id,
          series_name: fullBook.series_name,
          series_position: fullBook.series_position,
          series_count: fullBook.series_count,
          library: fullBook.library ?? metadataBook.library,
          library_sources: fullBook.library_sources ?? metadataBook.library_sources,
          library_holdings: fullBook.library_holdings,
        });
      } catch (error) {
        console.error('Failed to load book description, using search data:', error);
        setSelectedBook(metadataBook);
      }
    } else {
      try {
        if (!book?.source) {
          throw new Error('Book is missing source context');
        }
        const fullBook = await getSourceRecordInfo(book.source, id);
        setSelectedBook(fullBook);
      } catch (error) {
        console.error('Failed to load book details, using search data:', error);
        if (book) {
          setSelectedBook(book);
        } else {
          showToast('Failed to load book details', 'error');
        }
      }
    }
  };

  const submitRequests = useCallback(
    async (payloads: CreateRequestPayload[], successMessage: string): Promise<boolean> => {
      try {
        const results = await createRequests(payloads);
        await refreshActivitySnapshot();
        if (results.some(isQueuedDownloadResult)) {
          await fetchStatus();
        }
        showToast(getSubmissionSuccessMessage(results, successMessage), 'success');
        await refreshRequestPolicy({ force: true });
        return true;
      } catch (error) {
        console.error('Request creation failed:', error);
        showToast(getErrorMessage(error, 'Failed to create request'), 'error');
        if (isPolicyGuardError(error)) {
          await refreshRequestPolicy({ force: true });
        }
        return false;
      }
    },
    [fetchStatus, showToast, refreshRequestPolicy, refreshActivitySnapshot],
  );

  const openRequestConfirmation = useCallback(
    (
      payload: CreateRequestPayload,
      extraPayloads: CreateRequestPayload[] = [],
      onBehalfOfUserId: number | undefined = effectiveActingAsUser?.id,
    ) => {
      const applyOnBehalf = (requestPayload: CreateRequestPayload): CreateRequestPayload => {
        if (typeof onBehalfOfUserId !== 'number') {
          return requestPayload;
        }
        return {
          ...requestPayload,
          on_behalf_of_user_id: onBehalfOfUserId,
        };
      };

      setPendingRequestPayload(applyOnBehalf(payload));
      setPendingRequestExtraPayloads(extraPayloads.map(applyOnBehalf));
    },
    [effectiveActingAsUser?.id],
  );

  const handleConfirmRequest = useCallback(
    async (
      payload: CreateRequestPayload,
      extraPayloads?: CreateRequestPayload[],
    ): Promise<boolean> => {
      const requestPayloads = [payload, ...(extraPayloads ?? pendingRequestExtraPayloads)].map(
        (requestPayload) =>
          applyRequestNoteToPayload(requestPayload, payload.note ?? '', allowRequestNotes),
      );
      const success = await submitRequests(
        requestPayloads,
        requestPayloads.length === 1
          ? getRequestSuccessMessage(requestPayloads[0])
          : 'Requests submitted',
      );
      if (!success) return false;

      setPendingRequestPayload(null);
      setPendingRequestExtraPayloads([]);
      return true;
    },
    [allowRequestNotes, pendingRequestExtraPayloads, submitRequests],
  );

  const getDirectPolicyMode = useCallback(
    (book: Book): RequestPolicyMode => {
      return getSourceMode(getBrowseSource(book), 'ebook');
    },
    [getSourceMode],
  );

  const getUniversalDefaultPolicyMode = useCallback((): RequestPolicyMode => {
    return getDefaultMode(effectiveContentType);
  }, [effectiveContentType, getDefaultMode]);

  const getCombinedSelectionPhases = useCallback(
    (state: Pick<CombinedSelectionState, 'ebookMode' | 'audiobookMode'>): ContentType[] => {
      const phases: ContentType[] = [];
      if (state.ebookMode !== 'request_book') {
        phases.push('ebook');
      }
      if (state.audiobookMode !== 'request_book') {
        phases.push('audiobook');
      }
      return phases;
    },
    [],
  );

  // When downloading a book while browsing a Hardcover list the user owns,
  // automatically remove it from that list (fire-and-forget).
  // Stable identity for the download handlers below, while still reading the current
  // search field values, labels and metadata config. Not an Effect Event: the callers
  // are download handlers, not Effects. See useLatestCallback.
  const removeBookFromActiveList = useLatestCallback((book: Book) => {
    if (config?.hardcover_auto_remove_on_download === false) return;
    if (!bookSupportsTargets(book)) return;
    const activeList = searchFieldValues.hardcover_list;
    if (!activeList) return;
    const target = String(activeList);
    const provider = book.provider;
    const bookId = book.provider_id;
    if (!provider || !bookId) return;

    // Only auto-remove from lists the user owns (Reading Status / My Lists)
    const listField = activeMetadataConfig?.search_fields.find(
      (f) => f.key === 'hardcover_list' && f.type === 'DynamicSelectSearchField',
    );
    if (listField && listField.type === 'DynamicSelectSearchField') {
      const group = getDynamicOptionGroup(listField.options_endpoint, target);
      if (group && group !== 'Reading Status' && group !== 'My Lists') return;
    }

    void setBookTargetState(provider, bookId, target, false)
      .then((result) => {
        if (result.changed) {
          emitBookTargetChange({
            provider,
            bookId,
            target,
            selected: false,
          });
          const listName = searchFieldLabels['hardcover_list'];
          showToast(`Removed from ${listName || 'list'}`, 'info');
        }
      })
      .catch(() => undefined);
  });

  const executeBookDownload = useCallback(
    async (book: Book, onBehalfOfUserId?: number): Promise<void> => {
      const source = getBrowseSource(book);
      const directContentType: ContentType = 'ebook';
      const payload = buildReleaseDataFromDirectBook(book);
      const requestStartedAtSeconds = Date.now() / 1000;
      try {
        await downloadRelease(payload, onBehalfOfUserId);
        await fetchStatus();
        removeBookFromActiveList(book);
        clearSavedAfterDownload(book);
      } catch (error) {
        console.error('Download failed:', error);
        if (isPolicyGuardError(error)) {
          const requiredMode = getPolicyGuardRequiredMode(error);
          policyTrace('direct.action:policy_guard', {
            bookId: book.id,
            source,
            contentType: directContentType,
            requiredMode,
            code: isApiResponseError(error) ? error.code : null,
          });
          if (requiredMode === 'request_release') {
            openRequestConfirmation(buildDirectRequestPayload(book), [], onBehalfOfUserId);
            await refreshRequestPolicy({ force: true });
            return;
          }
          showToast('Download blocked by policy', 'error');
          await refreshRequestPolicy({ force: true });
          return;
        }
        try {
          const status = await getStatus();
          if (
            wasDownloadQueuedAfterResponseError(status, payload.source_id, requestStartedAtSeconds)
          ) {
            await fetchStatus();
            removeBookFromActiveList(book);
            showToast(CONFIRMED_DOWNLOAD_INTERRUPTED_MESSAGE, 'info');
            return;
          }
        } catch (verificationError) {
          console.warn('Failed to verify download after response error:', verificationError);
        }
        showToast(getErrorMessage(error, 'Failed to queue download'), 'error');
        throw error;
      }
    },
    [
      clearSavedAfterDownload,
      fetchStatus,
      openRequestConfirmation,
      refreshRequestPolicy,
      removeBookFromActiveList,
      showToast,
    ],
  );

  // Resolves true when MyAnonamouse downloads may go ahead: they fit in the buffer,
  // or upload credit was bought for them. Never blocks when MAM can't be checked.
  // saveTarget offers "Save for later" in the hold-back prompt, with exactly these picks.
  const ensureMamBuffer = useCallback(
    async (
      payloads: DownloadReleasePayload[],
      saveTarget?: HoldBackSaveTarget,
    ): Promise<boolean> => {
      if (!config?.mam_account_available || payloads.length === 0) return true;
      let check: MamBufferCheck;
      try {
        check = await checkMamBuffer(payloads);
      } catch (error) {
        console.warn('MAM buffer check failed, downloading anyway:', error);
        return true;
      }
      if (check.ok) return true;
      return new Promise<boolean>((resolve) => {
        setMamBufferPrompt({ check, releases: payloads, saveTarget, resolve });
      });
    },
    [config?.mam_account_available],
  );

  const executeReleaseDownload = useCallback(
    async (
      book: Book,
      release: Release,
      releaseContentType: ContentType,
      onBehalfOfUserId?: number,
      options?: ReleaseDownloadOptions,
    ): Promise<void> => {
      const requestStartedAtSeconds = Date.now() / 1000;
      try {
        trackRelease(book.id, release.source_id);
        await downloadRelease(
          buildReleaseDownloadPayload(book, release, releaseContentType, options),
          onBehalfOfUserId,
        );
        await fetchStatus();
        removeBookFromActiveList(book);
        clearSavedAfterDownload(book, release);
      } catch (error) {
        console.error('Release download failed:', error);
        if (isPolicyGuardError(error)) {
          const requiredMode = getPolicyGuardRequiredMode(error);
          const normalizedContentType = toContentType(releaseContentType);
          policyTrace('release.action:policy_guard', {
            bookId: book.id,
            releaseId: release.source_id,
            source: release.source,
            requiredMode,
            code: isApiResponseError(error) ? error.code : null,
            contentType: normalizedContentType,
          });
          if (requiredMode === 'request_release') {
            openRequestConfirmation(
              {
                book_data: buildMetadataBookRequestData(book, normalizedContentType),
                release_data: buildReleaseDataFromMetadataRelease(
                  book,
                  release,
                  normalizedContentType,
                ),
                context: {
                  source: release.source,
                  content_type: normalizedContentType,
                  request_level: 'release',
                },
              },
              [],
              onBehalfOfUserId,
            );
            await refreshRequestPolicy({ force: true });
            return;
          }
          if (requiredMode === 'request_book') {
            setReleaseBook(null);
            openRequestConfirmation(
              {
                book_data: buildMetadataBookRequestData(book, normalizedContentType),
                release_data: null,
                context: {
                  source: release.source,
                  content_type: normalizedContentType,
                  request_level: 'book',
                },
              },
              [],
              onBehalfOfUserId,
            );
            await refreshRequestPolicy({ force: true });
            return;
          }
          showToast('Download blocked by policy', 'error');
          await refreshRequestPolicy({ force: true });
          return;
        }
        try {
          const status = await getStatus();
          if (
            wasDownloadQueuedAfterResponseError(status, release.source_id, requestStartedAtSeconds)
          ) {
            await fetchStatus();
            removeBookFromActiveList(book);
            showToast(CONFIRMED_DOWNLOAD_INTERRUPTED_MESSAGE, 'info');
            return;
          }
        } catch (verificationError) {
          console.warn(
            'Failed to verify release download after response error:',
            verificationError,
          );
        }
        showToast(getErrorMessage(error, 'Failed to queue download'), 'error');
        throw error;
      }
    },
    [
      clearSavedAfterDownload,
      fetchStatus,
      openRequestConfirmation,
      refreshRequestPolicy,
      removeBookFromActiveList,
      showToast,
      trackRelease,
    ],
  );

  const executeCombinedAction = useCallback(
    async (
      book: Book,
      selection: CombinedSelectionState,
      onBehalfOfUserId?: number,
    ): Promise<void> => {
      const ebookRelease = selection.stagedEbook?.release;
      const audiobookReleases = selection.stagedAudiobooks;
      const ebookMode = ebookRelease
        ? getSourceMode(ebookRelease.source, 'ebook')
        : selection.ebookMode;
      const audiobookModes = audiobookReleases.map((release) =>
        getSourceMode(release.source, 'audiobook'),
      );

      const buildRequestPayload = (
        release: Release | undefined,
        releaseContentType: ContentType,
        mode: RequestPolicyMode,
      ): CreateRequestPayload => {
        const payload =
          mode === 'request_release'
            ? (() => {
                if (!release) {
                  throw new Error('Missing release for combined request payload');
                }
                return {
                  book_data: buildMetadataBookRequestData(book, releaseContentType),
                  release_data: buildReleaseDataFromMetadataRelease(
                    book,
                    release,
                    releaseContentType,
                  ),
                  context: {
                    source: release.source,
                    content_type: releaseContentType,
                    request_level: 'release' as const,
                  },
                };
              })()
            : {
                book_data: buildMetadataBookRequestData(book, releaseContentType),
                release_data: null,
                context: {
                  source: '*',
                  content_type: releaseContentType,
                  request_level: 'book' as const,
                },
              };

        if (typeof onBehalfOfUserId !== 'number') {
          return payload;
        }

        return {
          ...payload,
          on_behalf_of_user_id: onBehalfOfUserId,
        };
      };

      const requestPayloads: CreateRequestPayload[] = [];

      if (ebookMode === 'download' && ebookRelease) {
        // Only audiobooks being downloaded now: a request may never be fulfilled, and
        // the ebook would be left waiting in its narrator's folder. Parts of a book
        // published in parts each get their own folder, none of them the ebook's.
        const companionAudiobookNarrators = audiobookReleases
          .filter(
            (release, index) => audiobookModes[index] === 'download' && !isPartRelease(release),
          )
          .map(releaseNarrators);
        await executeReleaseDownload(book, ebookRelease, 'ebook', onBehalfOfUserId, {
          companionAudiobookNarrators,
        });
      } else if (ebookMode !== 'download' && (ebookRelease || ebookMode === 'request_book')) {
        requestPayloads.push(buildRequestPayload(ebookRelease, 'ebook', ebookMode));
      }

      const audiobookDownloads: Promise<void>[] = [];
      audiobookReleases.forEach((audiobookRelease, index) => {
        const audiobookMode = audiobookModes[index] ?? selection.audiobookMode;
        if (audiobookMode === 'download') {
          audiobookDownloads.push(
            executeReleaseDownload(book, audiobookRelease, 'audiobook', onBehalfOfUserId),
          );
        } else {
          requestPayloads.push(buildRequestPayload(audiobookRelease, 'audiobook', audiobookMode));
        }
      });
      await Promise.all(audiobookDownloads);
      if (audiobookReleases.length === 0 && selection.audiobookMode === 'request_book') {
        requestPayloads.push(buildRequestPayload(undefined, 'audiobook', 'request_book'));
      }

      if (requestPayloads.length > 0) {
        openRequestConfirmation(requestPayloads[0], requestPayloads.slice(1), onBehalfOfUserId);
      }
    },
    [executeReleaseDownload, getSourceMode, openRequestConfirmation],
  );

  const handleConfirmOnBehalfDownload = useCallback(async (): Promise<boolean> => {
    if (!effectivePendingOnBehalfDownload) {
      return true;
    }

    const onBehalfOfUserId = effectivePendingOnBehalfDownload.actingAsUser.id;
    try {
      if (effectivePendingOnBehalfDownload.type === 'book') {
        await executeBookDownload(effectivePendingOnBehalfDownload.book, onBehalfOfUserId);
      } else if (effectivePendingOnBehalfDownload.type === 'combined') {
        await executeCombinedAction(
          effectivePendingOnBehalfDownload.book,
          effectivePendingOnBehalfDownload.combinedState,
          onBehalfOfUserId,
        );
      } else {
        await executeReleaseDownload(
          effectivePendingOnBehalfDownload.book,
          effectivePendingOnBehalfDownload.release,
          effectivePendingOnBehalfDownload.releaseContentType,
          onBehalfOfUserId,
          effectivePendingOnBehalfDownload.options,
        );
      }
      setPendingOnBehalfDownload(null);
      return true;
    } catch {
      return false;
    }
  }, [
    effectivePendingOnBehalfDownload,
    executeBookDownload,
    executeCombinedAction,
    executeReleaseDownload,
  ]);

  // Direct-mode action (download or release-level request based on policy).
  const handleDownload = async (book: Book): Promise<void> => {
    const source = getBrowseSource(book);
    const directContentType: ContentType = 'ebook';
    let mode = getDirectPolicyMode(book);
    policyTrace('direct.action:start', {
      bookId: book.id,
      source,
      contentType: directContentType,
      cachedMode: mode,
      isAdmin: requestRoleIsAdmin,
    });
    try {
      const latestPolicy = await refreshRequestPolicy({ force: true });
      const effectiveIsAdmin = latestPolicy?.is_admin ?? requestRoleIsAdmin;
      mode = resolveSourceModeFromPolicy(latestPolicy, effectiveIsAdmin, source, directContentType);
      policyTrace('direct.action:resolved', {
        bookId: book.id,
        source,
        contentType: directContentType,
        resolvedMode: mode,
        effectiveIsAdmin,
        defaults: latestPolicy?.defaults ?? null,
        requestsEnabled: latestPolicy?.requests_enabled ?? null,
      });
    } catch (error) {
      console.warn('Failed to refresh request policy before direct action:', error);
      policyTrace('direct.action:refresh_failed', {
        bookId: book.id,
        source,
        contentType: directContentType,
        mode,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    if (mode === 'blocked') {
      policyTrace('direct.action:block', { bookId: book.id, mode });
      showToast('Download blocked by policy', 'error');
      await refreshRequestPolicy({ force: true });
      return;
    }

    if (mode === 'request_release') {
      policyTrace('direct.action:request_modal', { bookId: book.id, mode });
      openRequestConfirmation(buildDirectRequestPayload(book));
      return;
    }

    if (effectiveActingAsUser) {
      setPendingOnBehalfDownload({
        type: 'book',
        book,
        actingAsUser: effectiveActingAsUser,
      });
      return;
    }

    await executeBookDownload(book);
  };

  // Cancel download
  const handleCancel = async (id: string) => {
    try {
      await cancelDownload(id);
      await Promise.all([fetchStatus(), refreshActivitySnapshot()]);
    } catch (error) {
      console.error('Cancel failed:', error);
      showToast('Failed to cancel/clear download', 'error');
    }
  };

  const handleRetry = async (id: string) => {
    try {
      await retryDownload(id);
      // A retried download leaves History for the Downloads list.
      await Promise.all([fetchStatus(), refreshActivitySnapshot(), refreshActivityHistory()]);
    } catch (error) {
      console.error('Retry failed:', error);
      showToast('Failed to retry download', 'error');
    }
  };

  // An Activity row opens its book's details, with a note and Retry for a failed download.
  // A finished download opens in its library app. The tab opens at once (a tab opened
  // after the lookup would be taken for a popup) and goes there, or closes if it's not
  // in the library yet.
  const handleOpenInLibrary = async (item: ActivityItem) => {
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    try {
      const url = await findLibraryLink(item);
      if (url && tab) {
        tab.location.href = url;
        return;
      }
      tab?.close();
      if (url) {
        window.open(url, '_blank', 'noopener,noreferrer');
        return;
      }
      showToast(`"${item.title}" isn't in your library yet. It may still be scanning.`, 'info');
    } catch (error) {
      tab?.close();
      console.error('Could not find the book in the library:', error);
      showToast('Could not look up the book in your library', 'error');
    }
  };

  const handleOpenActivityDetails = async (item: ActivityItem) => {
    const failed =
      item.kind === 'download' &&
      (item.visualStatus === 'error' || item.visualStatus === 'cancelled');
    const retryId = item.downloadBookId;
    const notice: DetailsNotice | null = failed
      ? {
          tone: 'error',
          title:
            item.visualStatus === 'cancelled'
              ? 'This download was cancelled'
              : 'This download failed',
          detail: item.statusDetail,
          ...(item.downloadRetryAvailable && retryId
            ? {
                actionLabel: 'Retry download',
                onAction: async () => {
                  await handleRetry(retryId);
                  setSelectedBook(null);
                },
              }
            : {}),
        }
      : null;
    let book: Book | null = null;
    try {
      book = await findActivityBook(item);
    } catch (error) {
      console.warn('Could not look up the book:', error);
    }
    if (!book) {
      // Not found directly: search for it (a failed row keeps its own Retry button).
      void navigate('/');
      runSearchWithPolicyRefresh({ query: `${item.title} ${item.author}`.trim() });
      showToast(`Searching for "${item.title}"`, 'info');
      return;
    }
    setDetailsNotice(notice ? { bookId: book.id, notice } : null);
    setSelectedBook(book);
  };

  // Universal-mode "Get" action (open releases, request-book, or block by policy).
  const handleGetReleases = async (book: Book) => {
    let mode = getUniversalDefaultPolicyMode();
    const normalizedContentType = toContentType(effectiveContentType);
    policyTrace('universal.get:start', {
      bookId: book.id,
      contentType: normalizedContentType,
      cachedMode: mode,
      isAdmin: requestRoleIsAdmin,
    });
    try {
      const latestPolicy = await refreshRequestPolicy({ force: true });
      const effectiveIsAdmin = latestPolicy?.is_admin ?? requestRoleIsAdmin;
      mode = resolveDefaultModeFromPolicy(latestPolicy, effectiveIsAdmin, effectiveContentType);
      policyTrace('universal.get:resolved', {
        bookId: book.id,
        contentType: normalizedContentType,
        resolvedMode: mode,
        effectiveIsAdmin,
        defaults: latestPolicy?.defaults ?? null,
        requestsEnabled: latestPolicy?.requests_enabled ?? null,
      });
    } catch (error) {
      console.warn('Failed to refresh request policy before universal action:', error);
      policyTrace('universal.get:refresh_failed', {
        bookId: book.id,
        contentType: normalizedContentType,
        mode,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    if (mode === 'blocked') {
      policyTrace('universal.get:block', { bookId: book.id, contentType: normalizedContentType });
      showToast('This title is unavailable by policy', 'error');
      return;
    }

    // Combined mode is only available when both default content types are accessible.
    if (effectiveCombinedMode) {
      const latestPolicy2 = await refreshRequestPolicy({ force: true }).catch(() => null);
      const effectiveIsAdmin2 = latestPolicy2?.is_admin ?? requestRoleIsAdmin;
      const ebookMode = resolveDefaultModeFromPolicy(latestPolicy2, effectiveIsAdmin2, 'ebook');
      const audiobookMode = resolveDefaultModeFromPolicy(
        latestPolicy2,
        effectiveIsAdmin2,
        'audiobook',
      );

      if (ebookMode === 'request_book' && audiobookMode === 'request_book') {
        const ebookPayload: CreateRequestPayload = {
          book_data: buildMetadataBookRequestData(book, 'ebook'),
          release_data: null,
          context: { source: '*', content_type: 'ebook', request_level: 'book' },
        };
        const audiobookPayload: CreateRequestPayload = {
          book_data: buildMetadataBookRequestData(book, 'audiobook'),
          release_data: null,
          context: { source: '*', content_type: 'audiobook', request_level: 'book' },
        };
        openRequestConfirmation(ebookPayload, [audiobookPayload]);
        return;
      }

      const selectionPhases = getCombinedSelectionPhases({ ebookMode, audiobookMode });
      setMamRatio(null);
      if (config?.mam_account_available) {
        getMamRatio()
          .then(setMamRatio)
          .catch((error: unknown) => console.warn('Could not load MAM ratio:', error));
      }
      setCombinedState({
        phase: selectionPhases[0],
        ebookMode,
        audiobookMode,
        stagedAudiobooks: [],
      });
    } else {
      if (mode === 'request_book') {
        policyTrace('universal.get:request_modal', {
          bookId: book.id,
          requestLevel: 'book',
          contentType: normalizedContentType,
        });
        openRequestConfirmation({
          book_data: buildMetadataBookRequestData(book, normalizedContentType),
          release_data: null,
          context: {
            source: '*',
            content_type: normalizedContentType,
            request_level: 'book',
          },
        });
        return;
      }
    }

    if (book.provider && book.provider_id) {
      try {
        policyTrace('universal.get:open_release_modal', {
          bookId: book.id,
          contentType: normalizedContentType,
        });
        const fullBook = await getMetadataBookInfo(book.provider, book.provider_id);
        setReleaseBook({
          ...book,
          description: fullBook.description || book.description,
          series_id: fullBook.series_id || book.series_id,
          series_name: fullBook.series_name,
          series_position: fullBook.series_position,
          series_count: fullBook.series_count,
        });
      } catch (error) {
        console.error('Failed to load book description, using search data:', error);
        policyTrace('universal.get:open_release_modal_fallback', {
          bookId: book.id,
          contentType: normalizedContentType,
          message: error instanceof Error ? error.message : String(error),
        });
        setReleaseBook(book);
      }
    } else {
      policyTrace('universal.get:open_release_modal_no_provider', {
        bookId: book.id,
        contentType: normalizedContentType,
      });
      setReleaseBook(book);
    }
  };

  // Handle download from ReleaseModal (universal mode release rows).
  const handleReleaseDownload = async (
    book: Book,
    release: Release,
    releaseContentType: ContentType,
    options?: ReleaseDownloadOptions,
  ) => {
    policyTrace('release.action:start', {
      bookId: book.id,
      releaseId: release.source_id,
      source: release.source,
      contentType: toContentType(releaseContentType),
    });

    if (effectiveActingAsUser) {
      setPendingOnBehalfDownload({
        type: 'release',
        book,
        release,
        releaseContentType,
        actingAsUser: effectiveActingAsUser,
        options,
      });
      return;
    }

    const payload = buildReleaseDownloadPayload(book, release, releaseContentType, options);
    const saveTarget: HoldBackSaveTarget = {
      book,
      contentType: toContentType(releaseContentType),
      picks: [{ content_type: toContentType(releaseContentType), release }],
    };
    if (!(await ensureMamBuffer([payload], saveTarget))) return;
    await executeReleaseDownload(book, release, releaseContentType, undefined, options);
  };

  const handleReleaseRequest = useCallback(
    async (book: Book, release: Release, releaseContentType: ContentType): Promise<void> => {
      void refreshRequestPolicy();
      const normalizedContentType = toContentType(releaseContentType);
      openRequestConfirmation({
        book_data: buildMetadataBookRequestData(book, normalizedContentType),
        release_data: buildReleaseDataFromMetadataRelease(book, release, normalizedContentType),
        context: {
          source: release.source,
          content_type: normalizedContentType,
          request_level: 'release',
        },
      });
    },
    [openRequestConfirmation, refreshRequestPolicy],
  );

  const handleReleaseBookRequest = useCallback(
    async (book: Book, modalContentType: ContentType): Promise<void> => {
      void refreshRequestPolicy();
      const normalizedContentType = toContentType(modalContentType);
      openRequestConfirmation({
        book_data: buildMetadataBookRequestData(book, normalizedContentType),
        release_data: null,
        context: {
          source: '*',
          content_type: normalizedContentType,
          request_level: 'book',
        },
      });
    },
    [openRequestConfirmation, refreshRequestPolicy],
  );

  // Combined mode callbacks
  const handleCombinedNext = useCallback(
    (release: Release | null) => {
      if (!releaseBook || !combinedState) return;
      const phases = getCombinedSelectionPhases(combinedState);
      const nextPhase = phases[phases.indexOf(combinedState.phase) + 1];

      setCombinedState({
        ...combinedState,
        phase: nextPhase,
        stagedEbook: release ? { book: releaseBook, release } : undefined,
      });
    },
    [combinedState, getCombinedSelectionPhases, releaseBook],
  );

  const handleCombinedBack = useCallback((audiobookReleases: Release[]) => {
    setCombinedState((prev) =>
      prev ? { ...prev, phase: 'ebook', stagedAudiobooks: audiobookReleases } : null,
    );
  }, []);

  const handleCombinedClearSelection = useCallback((selectionContentType: ContentType) => {
    setCombinedState((prev) => {
      if (!prev) {
        return null;
      }
      if (selectionContentType === 'ebook') {
        return { ...prev, stagedEbook: undefined };
      }
      return { ...prev, stagedAudiobooks: [] };
    });
  }, []);

  const handleCombinedDownload = useCallback(
    async (releases: Release[]) => {
      if (!combinedState || !releaseBook) return;

      const [release] = releases;
      const nextCombinedState: CombinedSelectionState =
        combinedState.phase === 'ebook'
          ? {
              ...combinedState,
              stagedEbook: release ? { book: releaseBook, release } : undefined,
            }
          : {
              ...combinedState,
              stagedAudiobooks: releases,
            };

      // Check the buffer for everything picked at once, before queueing any of it.
      const mamPayloads = [
        ...(nextCombinedState.stagedEbook &&
        getSourceMode(nextCombinedState.stagedEbook.release.source, 'ebook') === 'download'
          ? [
              buildReleaseDownloadPayload(
                releaseBook,
                nextCombinedState.stagedEbook.release,
                'ebook',
              ),
            ]
          : []),
        ...nextCombinedState.stagedAudiobooks
          .filter((audiobook) => getSourceMode(audiobook.source, 'audiobook') === 'download')
          .map((audiobook) => buildReleaseDownloadPayload(releaseBook, audiobook, 'audiobook')),
      ];
      // Saving is for the signed-in user, so it isn't offered when acting for someone else.
      const saveTarget: HoldBackSaveTarget | undefined = effectiveActingAsUser
        ? undefined
        : {
            book: releaseBook,
            contentType: 'combined',
            picks: combinedPicks(
              nextCombinedState.stagedEbook?.release,
              nextCombinedState.stagedAudiobooks,
            ),
            onSaved: () => {
              setCombinedState(null);
              setReleaseBook(null);
            },
          };
      if (!(await ensureMamBuffer(mamPayloads, saveTarget))) return;

      if (effectiveActingAsUser) {
        setPendingOnBehalfDownload({
          type: 'combined',
          book: releaseBook,
          combinedState: nextCombinedState,
          actingAsUser: effectiveActingAsUser,
        });
        setCombinedState(null);
        setReleaseBook(null);
        return;
      }

      await executeCombinedAction(releaseBook, nextCombinedState);
      setCombinedState(null);
      setReleaseBook(null);
    },
    [
      combinedState,
      effectiveActingAsUser,
      ensureMamBuffer,
      executeCombinedAction,
      getSourceMode,
      releaseBook,
    ],
  );

  // Get a saved item: its picked releases go through the usual download path (buffer and
  // unsatisfied checks, request policy); a book saved on its own opens its releases.
  const handleSavedGet = async (item: SavedItem): Promise<void> => {
    try {
      if (item.kind === 'book' || item.releases.length === 0) {
        if (effectiveSearchMode === 'universal') {
          await handleGetReleases(item.book);
        } else {
          await handleDownload(item.book);
        }
        return;
      }
      if (item.kind === 'release') {
        const [pick] = item.releases;
        await handleReleaseDownload(item.book, pick.release, pick.content_type);
        return;
      }
      const ebook = item.releases.find((pick) => pick.content_type === 'ebook')?.release;
      const audiobooks = item.releases
        .filter((pick) => pick.content_type === 'audiobook')
        .map((pick) => pick.release);
      const selection: CombinedSelectionState = {
        phase: 'audiobook',
        ebookMode: 'download',
        audiobookMode: 'download',
        stagedEbook: ebook ? { book: item.book, release: ebook } : undefined,
        stagedAudiobooks: audiobooks,
      };
      const mamPayloads = [
        ...(ebook && getSourceMode(ebook.source, 'ebook') === 'download'
          ? [buildReleaseDownloadPayload(item.book, ebook, 'ebook')]
          : []),
        ...audiobooks
          .filter((audiobook) => getSourceMode(audiobook.source, 'audiobook') === 'download')
          .map((audiobook) => buildReleaseDownloadPayload(item.book, audiobook, 'audiobook')),
      ];
      if (!(await ensureMamBuffer(mamPayloads))) return;
      await executeCombinedAction(item.book, selection);
    } catch (error) {
      console.warn('Could not get saved item:', error);
    }
  };

  // Saved items in two Activity tabs: queued to download on their own, and kept for later.
  const savedPanelFor = (stage: SavedStage) => (
    <SavedPanel
      stage={stage}
      items={savedStore.items}
      loaded={savedStore.loaded}
      autoGetAvailable={Boolean(config?.saved_auto_get_enabled)}
      onGet={handleSavedGet}
      onRemove={(item) => savedStore.remove(item)}
      onRefresh={savedStore.refresh}
      onAutoGet={savedStore.setAutoGet}
    />
  );
  const savedCounts: Record<SavedStage, number> = {
    queued: savedStore.items.filter((item) => savedStage(item) === 'queued').length,
    later: savedStore.items.filter((item) => savedStage(item) === 'later').length,
  };

  const handleRequestCancel = useCallback(
    async (requestId: number) => {
      try {
        await cancelUserRequest(requestId);
        await refreshActivitySnapshot();
        showToast('Request cancelled', 'success');
      } catch (error) {
        showToast(getErrorMessage(error, 'Failed to cancel request'), 'error');
      }
    },
    [cancelUserRequest, refreshActivitySnapshot, showToast],
  );

  const handleRequestReject = useCallback(
    async (requestId: number, adminNote?: string) => {
      if (!requestRoleIsAdmin) {
        return;
      }

      try {
        await rejectSidebarRequest(requestId, adminNote);
        await refreshActivitySnapshot();
        showToast('Request rejected', 'success');
      } catch (error) {
        showToast(getErrorMessage(error, 'Failed to reject request'), 'error');
      }
    },
    [refreshActivitySnapshot, requestRoleIsAdmin, rejectSidebarRequest, showToast],
  );

  const handleRequestApprove = useCallback(
    async (
      requestId: number,
      record: RequestRecord,
      options?: {
        browseOnly?: boolean;
        manualApproval?: boolean;
      },
    ) => {
      if (!requestRoleIsAdmin) {
        return;
      }

      if (options?.manualApproval) {
        try {
          await fulfilSidebarRequest(requestId, undefined, undefined, true);
          await refreshActivitySnapshot();
          showToast('Request approved', 'success');
          await fetchStatus();
        } catch (error) {
          showToast(getErrorMessage(error, 'Failed to approve request'), 'error');
        }
        return;
      }

      const shouldBrowse = Boolean(options?.browseOnly) || record.request_level === 'book';

      if (!shouldBrowse && record.request_level === 'release') {
        try {
          await fulfilSidebarRequest(requestId, record.release_data || undefined);
          await refreshActivitySnapshot();
          showToast('Request approved', 'success');
          await fetchStatus();
        } catch (error) {
          showToast(getErrorMessage(error, 'Failed to approve request'), 'error');
        }
        return;
      }

      setReleaseBook(null);
      setFulfillingRequest({
        requestId,
        book: bookFromRequestData(record.book_data),
        contentType: record.content_type,
      });
      void refreshRequestPolicy({ force: true });
    },
    [
      requestRoleIsAdmin,
      fulfilSidebarRequest,
      showToast,
      fetchStatus,
      refreshActivitySnapshot,
      refreshRequestPolicy,
    ],
  );

  const handleBrowseFulfilDownload = useCallback(
    async (book: Book, release: Release, releaseContentType: ContentType) => {
      if (!fulfillingRequest) {
        return;
      }

      try {
        await fulfilSidebarRequest(
          fulfillingRequest.requestId,
          buildReleaseDataFromMetadataRelease(book, release, toContentType(releaseContentType)),
        );
        await refreshActivitySnapshot();
        showToast(`Request approved: ${book.title || 'Untitled'}`, 'success');
        setFulfillingRequest(null);
        await fetchStatus();
      } catch (error) {
        console.error('Browse fulfil failed:', error);
        showToast(getErrorMessage(error, 'Failed to fulfil request'), 'error');
        throw error;
      }
    },
    [fulfillingRequest, fulfilSidebarRequest, showToast, fetchStatus, refreshActivitySnapshot],
  );

  const getDirectActionButtonState = useCallback(
    (bookId: string): ButtonStateInfo => {
      const baseState = getButtonState(bookId);
      const book = books.find((entry) => entry.id === bookId);
      if (!book) {
        return baseState;
      }
      if (baseState.state === 'complete' && isDownloadTaskDismissed(bookId)) {
        return applyDirectPolicyModeToButtonState(
          { text: 'Download', state: 'download' },
          getDirectPolicyMode(book),
        );
      }
      const mode = getDirectPolicyMode(book);
      return applyDirectPolicyModeToButtonState(baseState, mode);
    },
    [books, getButtonState, getDirectPolicyMode, isDownloadTaskDismissed],
  );

  const getUniversalActionButtonState = useCallback(
    (bookId: string): ButtonStateInfo => {
      const baseState = getUniversalButtonState(bookId);
      const trackedReleaseIds = bookToReleaseMap[bookId] || [];
      const allTrackedReleasesDismissed =
        trackedReleaseIds.length > 0 &&
        trackedReleaseIds.every((releaseId) => isDownloadTaskDismissed(releaseId));

      if (
        baseState.state === 'complete' &&
        (isDownloadTaskDismissed(bookId) || allTrackedReleasesDismissed)
      ) {
        return applyUniversalPolicyModeToButtonState(
          { text: 'Get', state: 'download' },
          getUniversalDefaultPolicyMode(),
        );
      }
      const mode = getUniversalDefaultPolicyMode();
      return applyUniversalPolicyModeToButtonState(baseState, mode);
    },
    [
      bookToReleaseMap,
      getUniversalButtonState,
      getUniversalDefaultPolicyMode,
      isDownloadTaskDismissed,
    ],
  );

  const bookLanguages = useMemo(
    () => config?.book_languages || DEFAULT_LANGUAGES,
    [config?.book_languages],
  );
  const supportedFormats = config?.supported_formats || DEFAULT_SUPPORTED_FORMATS;
  const defaultLanguageCodes = useMemo(
    () => resolveDefaultLanguageCodes(config?.default_language, bookLanguages),
    [config?.default_language, bookLanguages],
  );

  const logoUrl = withBasePath('/logo.png');

  // Manual search is only allowed when the default policy permits browsing releases
  const universalDefaultMode = getUniversalDefaultPolicyMode();
  const manualSearchAllowed =
    effectiveSearchMode === 'universal' &&
    (universalDefaultMode === 'download' || universalDefaultMode === 'request_release');

  // Keep the last known search fields so queryTargets doesn't collapse to
  // [general] while the metadata config briefly reloads on content type switch.
  // Held in state rather than a ref written during render: a ref read back in the same
  // pass is what `react/refs` forbids, and this is the adjust-state-during-render shape
  // React documents for exactly this - carry the previous value until a new one arrives.
  const [stableSearchFields, setStableSearchFields] = useState<MetadataSearchField[]>(
    () => activeMetadataConfig?.search_fields ?? [],
  );
  const incomingSearchFields = activeMetadataConfig?.search_fields;
  if (incomingSearchFields && incomingSearchFields !== stableSearchFields) {
    setStableSearchFields(incomingSearchFields);
  }

  const queryTargets = useMemo<QueryTargetOption[]>(
    () =>
      buildQueryTargets({
        searchMode: effectiveSearchMode,
        metadataSearchFields: stableSearchFields,
        manualSearchAllowed,
      }),
    [effectiveSearchMode, stableSearchFields, manualSearchAllowed],
  );
  const effectiveActiveQueryTarget = useMemo(() => {
    if (queryTargets.some((target) => target.key === activeQueryTarget)) {
      return activeQueryTarget;
    }
    return getDefaultQueryTargetKey(queryTargets);
  }, [queryTargets, activeQueryTarget]);

  // Persist only what the user explicitly picked in the selector. Persisting the derived
  // `effectiveActiveQueryTarget` instead would overwrite the stored default with `general`
  // every time it collapses for reasons the user didn't choose: a cold load before the
  // metadata search fields resolve, the logo reset, logout, or a `view_series` browse.
  const handleQueryTargetChange = useCallback((nextTarget: string) => {
    setActiveQueryTarget(nextTarget);
    setSearchByPreference(nextTarget);
  }, []);

  const activeQueryOption = useMemo(
    () =>
      queryTargets.find((target) => target.key === effectiveActiveQueryTarget) ?? queryTargets[0],
    [queryTargets, effectiveActiveQueryTarget],
  );

  const activeQueryField = searchBarQueryField(
    activeQueryOption,
    effectiveSearchMode,
    stableSearchFields,
    activeMetadataConfig?.capabilities.find(
      (capability) => capability.key === 'general_suggestions',
    )?.suggestions_endpoint,
  );
  const seriesBrowseCapability = useMemo(
    () =>
      activeMetadataConfig?.capabilities.find(
        (capability) => capability.key === 'view_series' && capability.field_key,
      ) ?? null,
    [activeMetadataConfig?.capabilities],
  );
  const seriesBrowseTarget = useMemo(
    () =>
      seriesBrowseCapability?.field_key
        ? (queryTargets.find((target) => target.field?.key === seriesBrowseCapability.field_key) ??
          null)
        : null,
    // `seriesBrowseCapability` whole: the body reads `.field_key` off it unguarded
    // inside the ternary, so that object is the dependency the compiler infers.
    [queryTargets, seriesBrowseCapability],
  );

  const activeQueryValue = useMemo(() => {
    if (
      !activeQueryOption ||
      activeQueryOption.source === 'general' ||
      activeQueryOption.source === 'manual' ||
      activeQueryOption.source === 'direct-field'
    ) {
      return searchInput;
    }

    if (!activeQueryOption.field) {
      return '';
    }

    if (activeQueryOption.field.type === 'TextSearchField') {
      return searchInput;
    }

    if (activeQueryOption.field.type === 'CheckboxSearchField') {
      return (
        searchFieldValues[activeQueryOption.field.key] ?? activeQueryOption.field.default ?? false
      );
    }

    return searchFieldValues[activeQueryOption.field.key] ?? '';
  }, [activeQueryOption, searchInput, searchFieldValues]);

  // The sort the app applies with no user choice, mirroring what loadConfig seeds
  // advancedFilters.sort with - a sort equal to it is a default, not a shared intent.
  const urlHashDefaultSort =
    effectiveSearchMode === 'universal'
      ? resolvedMetadataDefaultSort
      : (config?.default_sort ?? '');

  // Keep the URL hash fragment live as search state changes. Gated until any URL-driven
  // bootstrap has applied (or there was nothing to apply), so we don't clobber a shared
  // link's params with the initial default state before they've been read.
  const readyToSyncUrlHash = wasProcessed && (!parsedParams || hasExecutedUrlSearchBootstrap);
  const urlSearchHash = useMemo(
    () =>
      buildUrlSearchHash({
        queryValue: activeQueryValue,
        searchBy: effectiveActiveQueryTarget,
        contentType,
        combinedMode,
        advancedFilters,
        defaultSort: urlHashDefaultSort,
        defaultFormats: supportedFormats,
      }),
    [
      activeQueryValue,
      effectiveActiveQueryTarget,
      contentType,
      combinedMode,
      advancedFilters,
      urlHashDefaultSort,
      supportedFormats,
    ],
  );
  useSyncUrlSearchHash({ enabled: readyToSyncUrlHash, hash: urlSearchHash });

  const activeQueryValueLabel = useMemo(() => {
    if (!activeQueryOption?.field) {
      return undefined;
    }
    return searchFieldLabels[activeQueryOption.field.key];
  }, [activeQueryOption, searchFieldLabels]);
  const activeQueryUsesSeriesBrowse = Boolean(
    seriesBrowseCapability?.field_key &&
    activeQueryOption?.source === 'provider-field' &&
    activeQueryOption.field?.key === seriesBrowseCapability.field_key &&
    activeQueryValue !== '' &&
    activeQueryValue !== false,
  );
  const activeQueryUsesListBrowse =
    activeQueryOption?.source === 'provider-field' &&
    activeQueryOption.field?.type === 'DynamicSelectSearchField' &&
    activeQueryValue !== '' &&
    activeQueryValue !== false;
  const effectiveMetadataSort = getEffectiveMetadataSort({
    currentSort: advancedFilters.sort,
    defaultSort: resolvedMetadataDefaultSort,
    sortOptions: resolvedMetadataSortOptions,
  });
  const visibleResultsSort =
    activeResultsSort ||
    (effectiveSearchMode === 'universal' ? effectiveMetadataSort : advancedFilters.sort);

  const getAppliedUniversalSort = useCallback(
    (sortOverride?: string) => {
      const requestedSort = sortOverride ?? effectiveMetadataSort;
      const seriesBrowseSort = seriesBrowseCapability?.sort ?? '';

      if (activeQueryUsesSeriesBrowse && seriesBrowseSort) {
        return seriesBrowseSort;
      }

      return requestedSort;
    },
    [activeQueryUsesSeriesBrowse, effectiveMetadataSort, seriesBrowseCapability?.sort],
  );

  const handleActiveQueryValueChange = useCallback(
    (value: string | number | boolean, label?: string) => {
      if (
        !activeQueryOption ||
        activeQueryOption.source === 'general' ||
        activeQueryOption.source === 'manual' ||
        activeQueryOption.source === 'direct-field'
      ) {
        setSearchInput(typeof value === 'string' ? value : String(value ?? ''));
        return;
      }

      if (activeQueryOption.field) {
        if (activeQueryOption.field.type === 'TextSearchField') {
          setSearchInput(typeof value === 'string' ? value : String(value ?? ''));
          // Typing (no label) drops the label of a picked suggestion: the search bar
          // shows a label over the value, so a stale "Brandon Sanderson" would replace
          // every keystroke.
          updateSearchFieldValue(activeQueryOption.field.key, value, label);
          return;
        }
        updateSearchFieldValue(activeQueryOption.field.key, value, label);
      }
    },
    [activeQueryOption, setSearchInput, updateSearchFieldValue],
  );

  const handleSearchModeChange = useCallback(
    (nextMode: SearchMode) => {
      resetSearchResultsState();
      setConfig((prev) => (prev ? { ...prev, search_mode: nextMode } : prev));
      if (nextMode !== 'universal') {
        setCombinedMode(false);
      }
      updateSelfUser({ settings: { SEARCH_MODE: nextMode } })
        .then(() => loadConfig('settings-saved'))
        .catch((err) => console.error('Failed to save search mode:', err));
    },
    [loadConfig, resetSearchResultsState, setCombinedMode],
  );

  const handleMetadataProviderChange = useCallback(
    (provider: string) => {
      if (effectiveCombinedMode) {
        setConfiguredCombinedMetadataProvider(provider);
      } else if (effectiveContentType === 'audiobook') {
        setConfiguredAudiobookMetadataProvider(provider);
      } else {
        setConfiguredMetadataProvider(provider);
      }
      let key = 'METADATA_PROVIDER';
      if (effectiveCombinedMode) {
        key = 'METADATA_PROVIDER_COMBINED';
      } else if (effectiveContentType === 'audiobook') {
        key = 'METADATA_PROVIDER_AUDIOBOOK';
      }
      updateSelfUser({ settings: { [key]: provider } })
        .then(() => loadConfig('settings-saved'))
        .catch((err) => console.error('Failed to save metadata provider:', err));
    },
    [effectiveCombinedMode, effectiveContentType, loadConfig],
  );

  const buildCurrentSearchRequest = useCallback(
    (sortOverride?: string) => {
      const appliedSort =
        effectiveSearchMode === 'universal'
          ? getAppliedUniversalSort(sortOverride)
          : (sortOverride ?? advancedFilters.sort);
      const nextFilters =
        appliedSort === advancedFilters.sort && sortOverride === undefined
          ? advancedFilters
          : { ...advancedFilters, sort: appliedSort };

      if (effectiveSearchMode === 'direct') {
        const directFilters = {
          ...nextFilters,
          isbn: '',
          author: '',
          title: '',
        };

        if (activeQueryOption?.source === 'direct-field') {
          const nextValue =
            typeof activeQueryValue === 'string'
              ? activeQueryValue
              : String(activeQueryValue ?? '');
          if (activeQueryOption.key === 'isbn') {
            directFilters.isbn = nextValue;
          } else if (activeQueryOption.key === 'author') {
            directFilters.author = nextValue;
          } else if (activeQueryOption.key === 'title') {
            directFilters.title = nextValue;
          }
        }

        const query = buildSearchQuery({
          searchInput: activeQueryOption?.source === 'general' ? searchInput : '',
          showAdvanced: true,
          advancedFilters: directFilters,
          bookLanguages,
          defaultLanguage: defaultLanguageCodes,
          searchMode: effectiveSearchMode,
        });

        return {
          query,
          fieldValues: {},
          providerOverride: undefined,
          appliedSort,
        };
      }

      const fieldValues =
        activeQueryOption?.source === 'provider-field' &&
        activeQueryOption.field &&
        activeQueryValue !== '' &&
        activeQueryValue !== false
          ? { [activeQueryOption.field.key]: activeQueryValue }
          : {};

      const query = buildSearchQuery({
        searchInput:
          activeQueryOption?.source === 'general' || activeQueryOption?.source === 'manual'
            ? searchInput
            : '',
        showAdvanced: true,
        advancedFilters: nextFilters,
        bookLanguages,
        defaultLanguage: defaultLanguageCodes,
        searchMode: effectiveSearchMode,
      });

      return {
        query,
        fieldValues,
        providerOverride: effectiveMetadataProvider ?? undefined,
        appliedSort,
      };
    },
    [
      activeQueryOption,
      activeQueryValue,
      advancedFilters,
      bookLanguages,
      defaultLanguageCodes,
      effectiveMetadataProvider,
      effectiveSearchMode,
      getAppliedUniversalSort,
      searchInput,
    ],
  );

  // Handle "View Series" - trigger search with series field and series order sort
  const handleSearchSeries = useCallback(
    (seriesName: string, seriesId?: string) => {
      const seriesTarget = seriesBrowseTarget;
      const seriesFieldKey = seriesTarget?.field?.key;
      const seriesSort = seriesBrowseCapability?.sort;
      if (!seriesTarget || !seriesFieldKey || !seriesSort) {
        return;
      }

      // Clear UI state
      setSearchInput('');
      setSelectedBook(null);
      setReleaseBook(null);
      clearTracking();

      const seriesFilters = { ...advancedFilters, sort: seriesSort };
      setActiveResultsSort(seriesSort);

      setActiveQueryTarget(seriesTarget.key);
      updateSearchFieldValue(seriesFieldKey, seriesId ? `id:${seriesId}` : seriesName, seriesName);

      const query = buildSearchQuery({
        searchInput: '',
        showAdvanced: true,
        advancedFilters: seriesFilters,
        bookLanguages,
        defaultLanguage: defaultLanguageCodes,
        searchMode: effectiveSearchMode,
      });

      runSearchWithPolicyRefresh({
        query,
        fieldValues: { [seriesFieldKey]: seriesId ? `id:${seriesId}` : seriesName },
        searchModeOverride: effectiveSearchMode,
        providerOverride: effectiveMetadataProvider ?? undefined,
      });
    },
    [
      advancedFilters,
      bookLanguages,
      clearTracking,
      defaultLanguageCodes,
      effectiveMetadataProvider,
      effectiveSearchMode,
      runSearchWithPolicyRefresh,
      setSearchInput,
      seriesBrowseCapability?.sort,
      seriesBrowseTarget,
      updateSearchFieldValue,
    ],
  );

  // A series or an author picked from General's suggestions opens as if picked in
  // Series or Author search; a book searches for its title as usual.
  const handleSuggestionPick = useCallback(
    (option: DynamicFieldOption): SuggestionPickResult => {
      const action = generalSuggestionAction(
        option,
        activeQueryOption,
        queryTargets,
        Boolean(seriesBrowseTarget),
      );
      if (action?.kind === 'series') {
        handleSearchSeries(action.name, action.seriesId);
        // Keep the series in the box (shown by its name), as a pick in Series search does.
        setSearchInput(option.value);
        return 'searched';
      }
      if (action?.kind === 'author') {
        setActiveQueryTarget(action.target.key);
        setSearchInput(option.value);
        updateSearchFieldValue(action.target.field.key, option.value, option.label);
        return 'selected';
      }
      return undefined;
    },
    [
      activeQueryOption,
      handleSearchSeries,
      queryTargets,
      seriesBrowseTarget,
      setSearchInput,
      updateSearchFieldValue,
    ],
  );

  const canSearchSeriesForBook = useCallback(
    (book: Book | null): boolean => {
      if (!book?.provider || !book.series_name) {
        return false;
      }

      if (
        !seriesBrowseCapability?.sort ||
        !seriesBrowseTarget?.field ||
        !activeMetadataConfig?.provider
      ) {
        return false;
      }

      return book.provider === activeMetadataConfig.provider;
    },
    // `activeMetadataConfig` whole: the body reads `.provider` off it unguarded on
    // the last line, so that object is the dependency the compiler infers.
    [activeMetadataConfig, seriesBrowseCapability?.sort, seriesBrowseTarget?.field],
  );

  const handleManualSearch = useCallback(() => {
    const trimmed = searchInput.trim();
    if (!trimmed) return;
    const manualId = `manual_${Date.now()}`;
    const syntheticBook: Book = {
      id: manualId,
      title: trimmed,
      author: '',
      provider: 'manual',
      provider_id: manualId,
      search_title: trimmed,
    };
    setReleaseBook(syntheticBook);
  }, [searchInput]);

  // Unified search dispatch: intercepts manual search mode, otherwise runs normal search
  const handleSearchDispatch = useCallback(() => {
    if (activeQueryOption?.source === 'manual') {
      handleManualSearch();
      return;
    }
    const request = buildCurrentSearchRequest();
    const shouldPersistAppliedSort = !(
      effectiveSearchMode === 'universal' &&
      activeQueryUsesSeriesBrowse &&
      request.appliedSort === seriesBrowseCapability?.sort
    );

    if (shouldPersistAppliedSort && request.appliedSort !== advancedFilters.sort) {
      updateAdvancedFilters({ sort: request.appliedSort });
    }
    setActiveResultsSort(request.appliedSort);
    runSearchWithPolicyRefresh({
      query: request.query,
      fieldValues: request.fieldValues,
      searchModeOverride: effectiveSearchMode,
      providerOverride: request.providerOverride,
      sort: advancedFilters.sort,
    });
  }, [
    activeQueryOption,
    advancedFilters.sort,
    activeQueryUsesSeriesBrowse,
    buildCurrentSearchRequest,
    effectiveSearchMode,
    handleManualSearch,
    runSearchWithPolicyRefresh,
    seriesBrowseCapability?.sort,
    updateAdvancedFilters,
  ]);

  const isBrowseFulfilMode = fulfillingRequest !== null;
  const activeReleaseBook = fulfillingRequest?.book ?? releaseBook;
  const activeReleaseContentType =
    fulfillingRequest?.contentType ?? effectiveCombinedState?.phase ?? effectiveContentType;
  const combinedSelectionPhases = effectiveCombinedState
    ? getCombinedSelectionPhases(effectiveCombinedState)
    : [];
  const combinedCurrentStep = effectiveCombinedState
    ? combinedSelectionPhases.indexOf(effectiveCombinedState.phase) + 1
    : 0;
  const combinedIsFinalStep = effectiveCombinedState
    ? combinedSelectionPhases[combinedSelectionPhases.length - 1] === effectiveCombinedState.phase
    : false;
  const combinedHasPreviousStep = effectiveCombinedState
    ? combinedSelectionPhases.indexOf(effectiveCombinedState.phase) > 0
    : false;

  const handleReleaseModalClose = useCallback(() => {
    if (isBrowseFulfilMode) {
      setFulfillingRequest(null);
      return;
    }
    setCombinedState(null);
    setReleaseBook(null);
  }, [isBrowseFulfilMode]);

  let pendingOnBehalfTitle = '';
  if (effectivePendingOnBehalfDownload) {
    if (
      effectivePendingOnBehalfDownload.type === 'book' ||
      effectivePendingOnBehalfDownload.type === 'combined'
    ) {
      pendingOnBehalfTitle = effectivePendingOnBehalfDownload.book.title || 'Untitled';
    } else {
      pendingOnBehalfTitle =
        effectivePendingOnBehalfDownload.release.title ||
        effectivePendingOnBehalfDownload.book.title ||
        'Untitled';
    }
  }
  const pendingOnBehalfUserName = effectivePendingOnBehalfDownload
    ? formatActingAsUserName(effectivePendingOnBehalfDownload.actingAsUser)
    : '';

  // Main navigation, Sonarr/Radarr style: each section, and the open one's pages.
  const libraryAvailable =
    (requestRoleIsAdmin || !authRequired) && Boolean(config?.library_browser_available);
  const settingsPageAvailable = authIsAdmin && Boolean(config?.settings_enabled);
  const visibleActivityTabs = ACTIVITY_TABS.filter((tab) => tab !== 'requests' || showRequestsTab);
  const activityTabFromPath = location.pathname.split('/')[2];
  const activityTab =
    section === 'activity'
      ? (visibleActivityTabs.find((tab) => tab === activityTabFromPath) ?? null)
      : null;
  const settingsRoute = parseSettingsRoute(location.pathname);
  const activeSettingsCategory = resolveSettingsCategory(settingsRoute.category);
  const activityBadge = getActivityBadgeState(statusCounts, requestRoleIsAdmin);
  const downloadCount = statusCounts.ongoing + statusCounts.completed + statusCounts.errored;
  let downloadBadgeClass = 'bg-green-500 text-white';
  if (statusCounts.errored > 0) {
    downloadBadgeClass = 'bg-red-500 text-white';
  } else if (statusCounts.ongoing > 0) {
    downloadBadgeClass = 'bg-blue-500 text-white';
  }
  const navItems: NavItem[] = [
    { key: 'search', label: 'Search', icon: 'search', to: '/', active: section === 'search' },
    ...(libraryAvailable
      ? [
          {
            key: 'library',
            label: 'Library',
            icon: 'library' as const,
            to: '/library',
            active: section === 'library',
          },
        ]
      : []),
    {
      key: 'activity',
      label: 'Activity',
      icon: 'activity',
      to: '/activity/downloads',
      active: section === 'activity',
      badge: activityBadge
        ? {
            count: activityBadge.total,
            className: `${activityBadge.colorClass} text-white`,
            title: activityBadge.title,
          }
        : null,
      children: visibleActivityTabs.map((tab) => {
        let badge = null;
        if (tab === 'queued') {
          badge = {
            count: savedCounts.queued,
            className: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
          };
        } else if (tab === 'downloads') {
          badge = { count: downloadCount, className: downloadBadgeClass };
        } else if (tab === 'requests') {
          badge = {
            count: pendingRequestCount,
            className: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
          };
        }
        return {
          key: tab,
          label: ACTIVITY_TAB_LABELS[tab],
          to: `/activity/${tab}`,
          active: activityTab === tab,
          badge,
        };
      }),
    },
    {
      key: 'wanted',
      label: 'Wanted',
      icon: 'wanted',
      to: '/wanted',
      active: section === 'wanted',
      badge: {
        count: savedCounts.later,
        className: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
        title: 'Saved for later',
      },
    },
    settingsPageAvailable
      ? {
          key: 'settings',
          label: 'Settings',
          icon: 'settings',
          to: '/settings',
          active: section === 'settings',
          children: SETTINGS_CATEGORIES.map((category) => ({
            key: category.key,
            label: category.label,
            to: settingsPath(category.key),
            active: activeSettingsCategory === category.key,
          })),
        }
      : {
          key: 'settings',
          label: 'Settings',
          icon: 'settings',
          onClick: handleSettingsClick,
          active: false,
        },
    { key: 'system', label: 'System', icon: 'system', to: '/system', active: section === 'system' },
  ];

  const goToSearch = () => {
    if (section !== 'search') void navigate('/');
  };

  let pageContent: ReactNode;
  if (section === 'library') {
    pageContent = (
      <LibraryPage
        actions={{
          contentType: effectiveContentType,
          allowedContentTypes,
          onContentTypeChange: setContentType,
          onShowDetails: (book) => showBookDetails(book, book.id),
          onGetReleases: handleGetReleases,
          getButtonState: getUniversalActionButtonState,
          onShowToast: showToast,
        }}
      />
    );
  } else if (section === 'activity') {
    pageContent = activityTab ? (
      <>
        {activityTab === 'history' && (
          <ActivityHistoryLoader onLoad={() => handleActivityTabChange('history')} />
        )}
        <ActivityPage
          key={activityTab}
          tab={activityTab}
          queuedPanel={savedPanelFor('queued')}
          status={activitySidebarStatus}
          isAdmin={requestRoleIsAdmin}
          onClearCompleted={handleClearCompleted}
          onOpenDetails={(item) => {
            void handleOpenActivityDetails(item);
          }}
          onOpenInLibrary={
            requestRoleIsAdmin
              ? (item) => {
                  void handleOpenInLibrary(item);
                }
              : undefined
          }
          onCancel={(id) => {
            void handleCancel(id);
          }}
          onRetry={(id) => {
            void handleRetry(id);
          }}
          onDownloadDismiss={handleDownloadDismiss}
          requestItems={requestItems}
          dismissedItemKeys={dismissedActivityKeys}
          historyItems={historyItems}
          historyLoaded={activityHistoryLoaded}
          historyHasMore={activityHistoryHasMore}
          historyLoading={activityHistoryLoading}
          onHistoryLoadMore={handleActivityHistoryLoadMore}
          showRequestsTab={showRequestsTab}
          isRequestsLoading={isActivitySnapshotLoading}
          onRequestCancel={showRequestsTab ? handleRequestCancel : undefined}
          onRequestApprove={requestRoleIsAdmin ? handleRequestApprove : undefined}
          onRequestReject={requestRoleIsAdmin ? handleRequestReject : undefined}
          onRequestDismiss={showRequestsTab ? handleRequestDismiss : undefined}
        />
      </>
    ) : (
      <Navigate to="/activity/downloads" replace />
    );
  } else if (section === 'wanted') {
    pageContent = (
      <section className="space-y-4" aria-labelledby="wanted-title">
        <div>
          <h1 id="wanted-title" className="text-2xl font-semibold">
            Wanted
          </h1>
          <p className="text-sm opacity-60">Books and releases you saved for later.</p>
        </div>
        {savedPanelFor('later')}
      </section>
    );
  } else if (section === 'settings') {
    pageContent = settingsPageAvailable ? (
      <SettingsPage
        category={settingsRoute.category}
        tab={settingsRoute.tab}
        onNavigate={(path) => void navigate(path)}
        authMode={authMode}
        onShowToast={showToast}
        onSettingsSaved={handleSettingsSaved}
        onRefreshAuth={refreshAuth}
      />
    ) : (
      <Navigate to="/" replace />
    );
  } else if (section === 'system') {
    pageContent = (
      <SystemPage
        buildVersion={config?.build_version}
        releaseVersion={config?.release_version}
        searchMode={config?.search_mode}
        debug={config?.debug}
        onShowToast={showToast}
        onRemoveToast={removeToast}
      />
    );
  } else {
    pageContent = (
      <>
        <AdvancedFilters
          visible={effectiveShowAdvanced}
          bookLanguages={bookLanguages}
          defaultLanguage={defaultLanguageCodes}
          filters={advancedFilters}
          onFiltersChange={updateAdvancedFilters}
          formClassName="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3"
          renderWrapper={(form) => (
            <div className="mb-4 rounded-xl border border-(--border-muted) bg-(--bg-soft) py-4 pr-4 pl-2">
              {form}
            </div>
          )}
          searchMode={effectiveSearchMode}
          onSearchModeChange={handleSearchModeChange}
          metadataProviders={metadataProviders}
          activeMetadataProvider={effectiveMetadataProvider}
          onMetadataProviderChange={handleMetadataProviderChange}
          contentType={effectiveContentType}
          combinedMode={effectiveCombinedMode}
          isAdmin={requestRoleIsAdmin}
          onClose={() => setShowAdvanced(false)}
        />

        {effectiveActiveQueryTarget === 'manual' && (
          <p className="mb-3 text-xs opacity-50">
            Manual search queries release sources directly. Some sources may return limited
            metadata, which can affect file naming templates.
          </p>
        )}

        {isInitialState ? (
          <div className="flex flex-col items-center px-4 pt-[12vh] text-center">
            <img src={logoUrl} alt="" className="mb-4 h-14 w-14 opacity-90" />
            <h1 className="text-2xl font-semibold">{config?.search_page_title || 'Shelfmark'}</h1>
            <p className="mt-2 max-w-md text-sm opacity-60">
              {isSearching
                ? 'Searching…'
                : 'Search for a book, author or series with the search bar above.'}
            </p>
          </div>
        ) : (
          <ResultsSection
            books={books}
            visible={hasResults}
            onDetails={handleShowDetails}
            onDownload={handleDownload}
            onGetReleases={handleGetReleases}
            getButtonState={getDirectActionButtonState}
            getUniversalButtonState={getUniversalActionButtonState}
            sortValue={visibleResultsSort}
            showSortControl={
              !activeQueryUsesSeriesBrowse && !activeQueryUsesListBrowse && !resultsSourceUrl
            }
            onSortChange={(value) => {
              const request = buildCurrentSearchRequest(value);
              const shouldPersistAppliedSort = !(
                effectiveSearchMode === 'universal' &&
                activeQueryUsesSeriesBrowse &&
                request.appliedSort === seriesBrowseCapability?.sort
              );
              if (shouldPersistAppliedSort) {
                updateAdvancedFilters({ sort: request.appliedSort });
              }
              setActiveResultsSort(request.appliedSort);

              // "Most downloads" is a client-side sort — just re-sort existing books
              if (request.appliedSort === 'downloads' && effectiveSearchMode === 'direct') {
                reSortByDownloads();
                return;
              }

              runSearchWithPolicyRefresh({
                query: request.query,
                fieldValues: request.fieldValues,
                searchModeOverride: effectiveSearchMode,
                providerOverride: request.providerOverride,
                sort: request.appliedSort,
              });
            }}
            metadataSortOptions={resolvedMetadataSortOptions}
            hasMore={hasMore}
            isLoadingMore={isLoadingMore}
            onLoadMore={() => {
              void loadMore(config, effectiveSearchMode);
            }}
            totalFound={totalFound}
            directTotalResults={directTotalResults}
            onShowToast={showToast}
            resultsSourceUrl={resultsSourceUrl}
          />
        )}
      </>
    );
  }

  const mainAppContent = (
    <SearchModeProvider searchMode={effectiveSearchMode}>
      <SavedItemsProvider value={savedStore}>
        <SavedItemsLoader onLoad={savedStore.refresh} />
        <BookActivityProvider value={bookActivity}>
          <BookActivityLoader onLoad={bookActivity.refresh} />
          <div ref={headerRef} className="fixed top-0 right-0 left-0 z-40">
            <Header
              calibreWebUrl={config?.calibre_web_url || ''}
              calibreWebName={config?.calibre_web_name || undefined}
              audiobookLibraryName={config?.audiobook_library_name || undefined}
              audiobookLibraryUrl={config?.audiobook_library_url || ''}
              logoUrl={logoUrl}
              title={config?.search_page_title || 'Shelfmark'}
              searchInput={activeQueryValue}
              searchInputLabel={activeQueryValueLabel}
              onSearchChange={handleActiveQueryValueChange}
              onSuggestionPick={handleSuggestionPick}
              onMenuClick={() => setMobileNavOpen(true)}
              mamStatsKey={mamStatsKey}
              onMamAccountClick={
                // Without login everyone is an admin, as the backend's admin check treats them.
                (requestRoleIsAdmin || !authRequired) && config?.mam_account_available
                  ? () => setMamAccountOpen(true)
                  : undefined
              }
              isAdmin={requestRoleIsAdmin}
              username={username}
              displayName={displayName}
              actingAsUser={effectiveActingAsUser}
              onActingAsUserChange={setActingAsUser}
              adminUsers={availableActingAsUsers}
              isAdminUsersLoading={isAdminUsersLoading}
              adminUsersError={adminUsersError}
              hasLoadedAdminUsers={hasLoadedAdminUsers}
              onLoadAdminUsers={loadAdminUsers}
              onLogoClick={() => {
                goToSearch();
                handleResetSearch(config);
                setActiveQueryTarget('general');
                setActiveResultsSort('');
              }}
              authRequired={authRequired}
              isAuthenticated={isAuthenticated}
              onLogout={() => {
                void handleLogoutWithCleanup();
              }}
              onSearch={() => {
                // Searching from another page shows the results on the search page.
                goToSearch();
                handleSearchDispatch();
              }}
              onAdvancedToggle={
                hasAdvancedContent
                  ? () => {
                      // The filters show above the results, on the search page.
                      if (section !== 'search') {
                        goToSearch();
                        setShowAdvanced(true);
                        return;
                      }
                      setShowAdvanced(!effectiveShowAdvanced);
                    }
                  : undefined
              }
              isAdvancedActive={effectiveShowAdvanced}
              isLoading={isSearching}
              contentType={effectiveContentType}
              onContentTypeChange={setContentType}
              allowedContentTypes={allowedContentTypes}
              combinedMode={effectiveCombinedMode}
              combinedModeLocked={combinedModeLocked}
              onCombinedModeChange={combinedModeAllowed ? setCombinedMode : undefined}
              queryTargets={queryTargets}
              activeQueryTarget={effectiveActiveQueryTarget}
              onQueryTargetChange={handleQueryTargetChange}
              activeQueryField={activeQueryField}
            />
          </div>

          <AppSidebar
            items={navItems}
            topOffset={headerHeight}
            mobileOpen={mobileNavOpen}
            onMobileClose={() => setMobileNavOpen(false)}
          />

          <div className="lg:pl-56" style={{ paddingTop: `${headerHeight}px` }}>
            {section === 'settings' ? (
              <main
                className="flex flex-col"
                style={{ height: `calc(100dvh - ${headerHeight}px)` }}
              >
                {pageContent}
              </main>
            ) : (
              <main
                className={`relative w-full px-4 py-4 sm:px-6 sm:py-6 lg:px-8 ${
                  // Search results stay centred; the table pages use the whole width, as in Sonarr.
                  section === 'search' ? 'mx-auto max-w-7xl' : ''
                }`}
              >
                {pageContent}
              </main>
            )}
          </div>

          {selectedBook && (
            <DetailsModal
              book={selectedBook}
              notice={detailsNotice?.bookId === selectedBook.id ? detailsNotice.notice : null}
              onClose={() => setSelectedBook(null)}
              onDownload={handleDownload}
              onShowToast={showToast}
              onFindDownloads={(book) => {
                setSelectedBook(null);
                void handleGetReleases(book);
              }}
              onSearchSeries={canSearchSeriesForBook(selectedBook) ? handleSearchSeries : undefined}
              buttonState={
                isMetadataBook(selectedBook)
                  ? getUniversalActionButtonState(selectedBook.id)
                  : getDirectActionButtonState(selectedBook.id)
              }
              showReleaseSourceLinks={config?.show_release_source_links !== false}
            />
          )}

          {activeReleaseBook && (
            <ReleaseModal
              book={activeReleaseBook}
              onClose={handleReleaseModalClose}
              onDownload={isBrowseFulfilMode ? handleBrowseFulfilDownload : handleReleaseDownload}
              onRequestRelease={isBrowseFulfilMode ? undefined : handleReleaseRequest}
              onRequestBook={
                isBrowseFulfilMode || !requestRoleIsAdmin ? undefined : handleReleaseBookRequest
              }
              getPolicyModeForSource={
                isBrowseFulfilMode ? () => 'download' : (source, ct) => getSourceMode(source, ct)
              }
              supportedFormats={supportedFormats}
              supportedAudiobookFormats={config?.supported_audiobook_formats || []}
              contentType={activeReleaseContentType}
              defaultLanguages={defaultLanguageCodes}
              bookLanguages={bookLanguages}
              currentStatus={statusForButtonState}
              defaultReleaseSource={config?.default_release_source}
              defaultAudiobookReleaseSource={config?.default_release_source_audiobook}
              onSearchSeries={
                isBrowseFulfilMode || !canSearchSeriesForBook(activeReleaseBook)
                  ? undefined
                  : handleSearchSeries
              }
              defaultShowManualQuery={
                isBrowseFulfilMode || activeReleaseBook?.provider === 'manual'
              }
              isRequestMode={isBrowseFulfilMode || activeReleaseBook?.provider === 'manual'}
              showReleaseSourceLinks={config?.show_release_source_links !== false}
              onShowToast={showToast}
              mamRatio={effectiveCombinedState ? mamRatio : null}
              combinedMode={
                effectiveCombinedState
                  ? {
                      phase: effectiveCombinedState.phase,
                      stepLabel: `Step ${combinedCurrentStep} of ${combinedSelectionPhases.length} — Select ${effectiveCombinedState.phase === 'ebook' ? 'book' : 'audiobooks'}`,
                      ebookMode: effectiveCombinedState.ebookMode,
                      audiobookMode: effectiveCombinedState.audiobookMode,
                      stagedEbookRelease: effectiveCombinedState.stagedEbook?.release ?? null,
                      stagedAudiobookReleases: effectiveCombinedState.stagedAudiobooks,
                      onNext: !combinedIsFinalStep ? handleCombinedNext : undefined,
                      onBack: combinedHasPreviousStep ? handleCombinedBack : undefined,
                      onClearSelection: handleCombinedClearSelection,
                      onDownload: combinedIsFinalStep
                        ? (releases) => {
                            void handleCombinedDownload(releases);
                          }
                        : undefined,
                    }
                  : null
              }
            />
          )}

          {pendingRequestPayload && (
            <RequestConfirmationModal
              payload={pendingRequestPayload}
              extraPayloads={pendingRequestExtraPayloads}
              allowNotes={allowRequestNotes}
              onConfirm={handleConfirmRequest}
              onClose={() => {
                setPendingRequestPayload(null);
                setPendingRequestExtraPayloads([]);
              }}
            />
          )}

          {effectivePendingOnBehalfDownload && (
            <OnBehalfConfirmationModal
              isOpen={Boolean(effectivePendingOnBehalfDownload)}
              actingAsName={pendingOnBehalfUserName}
              itemTitle={pendingOnBehalfTitle}
              onConfirm={handleConfirmOnBehalfDownload}
              onClose={() => setPendingOnBehalfDownload(null)}
            />
          )}

          <ToastContainer toasts={toasts} />

          {mamAccountOpen && (
            <MamAccountModal
              onClose={() => {
                setMamAccountOpen(false);
                setMamStatsKey((key) => key + 1);
              }}
            />
          )}
          {mamBufferPrompt && (
            <MamBufferModal
              check={mamBufferPrompt.check}
              releases={mamBufferPrompt.releases}
              onResolve={(proceed) => {
                mamBufferPrompt.resolve(proceed);
                setMamBufferPrompt(null);
              }}
              onSaveForLater={
                mamBufferPrompt.saveTarget
                  ? async () => {
                      const target = mamBufferPrompt.saveTarget;
                      if (!target) return false;
                      const saved = await savedStore.savePicks(
                        target.book,
                        target.contentType,
                        target.picks,
                      );
                      if (saved) target.onSaved?.();
                      return saved;
                    }
                  : undefined
              }
            />
          )}

          <SelfSettingsModal
            isOpen={selfSettingsOpen}
            onClose={() => setSelfSettingsOpen(false)}
            onShowToast={showToast}
            onSettingsSaved={handleSettingsSaved}
          />

          {/* Auto-show banner on startup for users without config */}
          {config && <ConfigSetupBanner settingsEnabled={config.settings_enabled} />}

          {/* Controlled banner shown when clicking settings without config */}
          <ConfigSetupBanner
            isOpen={configBannerOpen}
            onClose={() => setConfigBannerOpen(false)}
            onContinue={() => {
              setConfigBannerOpen(false);
              if (authIsAdmin) {
                void primeUsersCache();
                void primeSettingsCache();
                void navigate('/settings');
              } else {
                setSelfSettingsOpen(true);
              }
            }}
          />

          {/* Onboarding wizard shown on first run */}
          <OnboardingModal
            isOpen={onboardingOpen}
            onClose={() => setOnboardingOpen(false)}
            onComplete={() => {
              void loadConfig('settings-saved');
            }}
            onShowToast={showToast}
          />
        </BookActivityProvider>
      </SavedItemsProvider>
    </SearchModeProvider>
  );

  const visuallyHiddenStyle: CSSProperties = {
    position: 'absolute',
    width: '1px',
    height: '1px',
    padding: 0,
    margin: '-1px',
    overflow: 'hidden',
    clip: 'rect(0, 0, 0, 0)',
    whiteSpace: 'nowrap',
    border: 0,
  };
  const authenticatedBootstrapKey =
    authChecked && isAuthenticated ? `${username ?? 'authenticated'}:${String(authIsAdmin)}` : null;
  const authenticatedBootstrap = authenticatedBootstrapKey ? (
    <AuthenticatedAppBootstrap
      key={authenticatedBootstrapKey}
      refreshStatus={fetchStatus}
      refreshRequestPolicy={refreshRequestPolicy}
      refreshActivitySnapshot={refreshActivitySnapshot}
      loadConfig={loadConfig}
    />
  ) : null;
  const adminSettingsWarmupKey =
    authChecked && isAuthenticated && authIsAdmin && config?.settings_enabled
      ? `${username ?? 'authenticated'}:settings-warmup`
      : null;
  const adminSettingsWarmup = adminSettingsWarmupKey ? (
    <AdminSettingsWarmupMount key={adminSettingsWarmupKey} />
  ) : null;
  // A `search_by` deep link can name a metadata provider field that isn't in queryTargets
  // until the search-fields fetch resolves. Bootstrapping before then runs the search
  // against the wrong target *and* lets the sync effect rewrite the shared hash without
  // `search_by`, so hold the one-shot mount until the fields have settled (the session
  // resolves to null on failure, so this can't hang).
  const searchFieldsSettled =
    metadataConfigSessionKey === null ||
    activeMetadataConfigState?.sessionKey === metadataConfigSessionKey;
  const awaitingSearchByTarget = Boolean(
    parsedParams?.searchBy && !findQueryTarget(queryTargets, parsedParams.searchBy),
  );
  const urlSearchBootstrapMount =
    wasProcessed &&
    parsedParams &&
    config &&
    !hasExecutedUrlSearchBootstrap &&
    (searchFieldsSettled || !awaitingSearchByTarget) ? (
      <UrlSearchBootstrapMount
        key={urlSearchNonce}
        parsedParams={parsedParams}
        config={config}
        contentType={contentType}
        combinedMode={combinedMode}
        combinedModeAllowed={combinedModeAllowed}
        queryTargets={queryTargets}
        advancedFilters={advancedFilters}
        resolvedMetadataDefaultSort={resolvedMetadataDefaultSort}
        resolvedMetadataSortOptions={resolvedMetadataSortOptions}
        setContentType={setContentType}
        setCombinedMode={setCombinedMode}
        setSearchInput={setSearchInput}
        setAdvancedFilters={setAdvancedFilters}
        setShowAdvanced={setShowAdvanced}
        setActiveQueryTarget={setActiveQueryTarget}
        setSearchFieldValue={updateSearchFieldValue}
        runSearchWithPolicyRefresh={runSearchWithPolicyRefresh}
        onComplete={() => {
          urlSearchBootstrapAppliedRef.current = true;
          setHasExecutedUrlSearchBootstrap(true);
        }}
      />
    ) : null;
  const metadataConfigSession = metadataConfigSessionKey ? (
    <MetadataConfigSession
      key={metadataConfigSessionKey}
      contentType={effectiveContentType}
      metadataProvider={effectiveMetadataProvider}
      onResolved={(nextConfig) => {
        setActiveMetadataConfigState({
          sessionKey: metadataConfigSessionKey,
          config: nextConfig,
        });
      }}
    />
  ) : null;

  if (!authChecked) {
    return (
      <>
        {authenticatedBootstrap}
        {adminSettingsWarmup}
        {metadataConfigSession}
        {urlSearchBootstrapMount}
        <div aria-live="polite" style={visuallyHiddenStyle}>
          Checking authentication…
        </div>
      </>
    );
  }

  // Wait for config to load before rendering main UI to prevent flicker
  if (isAuthenticated && !config) {
    return (
      <>
        {authenticatedBootstrap}
        {adminSettingsWarmup}
        {metadataConfigSession}
        {urlSearchBootstrapMount}
        <div aria-live="polite" style={visuallyHiddenStyle}>
          Loading configuration…
        </div>
      </>
    );
  }

  const shouldRedirectFromLogin = !authRequired || isAuthenticated;
  const postLoginPath = getReturnToFromSearch(location.search);
  const loginRedirectPath = buildLoginRedirectPath(location);
  const appElement =
    authRequired && !isAuthenticated ? <Navigate to={loginRedirectPath} replace /> : mainAppContent;

  return (
    <>
      {authenticatedBootstrap}
      {adminSettingsWarmup}
      {metadataConfigSession}
      {urlSearchBootstrapMount}
      <Routes>
        <Route
          path="/login"
          element={
            shouldRedirectFromLogin ? (
              <Navigate to={postLoginPath} replace />
            ) : (
              <LoginPage
                onLogin={(credentials) => {
                  void handleLogin(credentials);
                }}
                error={loginError}
                isLoading={isLoggingIn}
                authMode={authMode}
                oidcButtonLabel={oidcButtonLabel}
                hideLocalAuth={hideLocalAuth}
                oidcAutoRedirect={oidcAutoRedirect}
              />
            )
          }
        />
        <Route path="/*" element={appElement} />
      </Routes>
    </>
  );
}

export { App };
