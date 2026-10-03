import { useState, useCallback, useRef, useMemo, type ReactNode } from 'react';

import { useSearchMode } from '../../contexts/SearchModeContext';
import { useMountEffect } from '../../hooks/useMountEffect';
import { useSettings } from '../../hooks/useSettings';
import { getAdminSettingsOverridesSummary, getSettingsTab } from '../../services/api';
import {
  resolveSettingsCategory,
  settingsCategoryLabel,
  settingsCategoryOfTab,
  settingsEntriesInCategory,
  settingsPath,
} from './settingsCategories';
import { SettingsContent } from './SettingsContent';

interface SettingsPageProps {
  // From the route, /settings/<category>/<tab>; either may be missing.
  category: string | null;
  tab: string | null;
  onNavigate: (path: string) => void;
  authMode: string;
  onShowToast?: (message: string, type: 'success' | 'error' | 'info') => void;
  onSettingsSaved?: () => void;
  onRefreshAuth?: () => Promise<void>;
}

function getStringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function getStringArrayValue(value: unknown): string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string') ? value : [];
}

function getBooleanValue(value: unknown): boolean {
  return typeof value === 'boolean' ? value : false;
}

interface SettingsTabSyncProps {
  selectedTab: string;
  refreshOverrideSummaryForTab: (tabName: string) => Promise<void>;
  setSecurityAccessError: (message: string | null) => void;
}

const SettingsTabSync = ({
  selectedTab,
  refreshOverrideSummaryForTab,
  setSecurityAccessError,
}: SettingsTabSyncProps) => {
  useMountEffect(() => {
    let cancelled = false;

    void refreshOverrideSummaryForTab(selectedTab);

    if (selectedTab !== 'security') {
      setSecurityAccessError(null);
    } else {
      void getSettingsTab('security')
        .then(() => {
          if (!cancelled) {
            setSecurityAccessError(null);
          }
        })
        .catch((err) => {
          if (cancelled) {
            return;
          }

          const message = err instanceof Error ? err.message : 'Failed to load security settings';
          if (message.toLowerCase().includes('admin access required')) {
            setSecurityAccessError(message);
            return;
          }

          setSecurityAccessError(null);
        });
    }

    return () => {
      cancelled = true;
    };
  });

  return null;
};

/** Settings as a page: a section from the main navigation, with its tabs along the top. */
export const SettingsPage = ({
  category,
  tab,
  onNavigate,
  authMode,
  onShowToast,
  onSettingsSaved,
  onRefreshAuth,
}: SettingsPageProps) => {
  const {
    tabs,
    isLoading,
    error,
    values,
    updateValue,
    hasChanges,
    saveTab,
    executeAction,
    isSaving,
  } = useSettings();

  const { isUniversalMode } = useSearchMode();

  const [securityAccessError, setSecurityAccessError] = useState<string | null>(null);
  const [tabOverrideSummaries, setTabOverrideSummaries] = useState<
    Record<
      string,
      Record<
        string,
        { count: number; users: Array<{ userId: number; username: string; value: unknown }> }
      >
    >
  >({});
  const overrideSummaryRequestIdRef = useRef(0);

  const categoryKey = resolveSettingsCategory(category);
  const categoryTabs = useMemo(
    () => settingsEntriesInCategory(tabs, categoryKey),
    [tabs, categoryKey],
  );
  const selectedEntry = categoryTabs.find((entry) => entry.id === tab) ?? categoryTabs[0] ?? null;
  // The backend tab it loads and saves as.
  const selectedTab = selectedEntry?.tabName ?? null;

  const refreshOverrideSummaryForTab = useCallback(async (tabName: string) => {
    const requestId = ++overrideSummaryRequestIdRef.current;
    try {
      const data = await getAdminSettingsOverridesSummary(tabName);
      if (overrideSummaryRequestIdRef.current !== requestId) {
        return;
      }
      setTabOverrideSummaries((prev) => ({
        ...prev,
        [tabName]: data.keys || {},
      }));
    } catch {
      if (overrideSummaryRequestIdRef.current !== requestId) {
        return;
      }
      setTabOverrideSummaries((prev) => ({
        ...prev,
        [tabName]: {},
      }));
    }
  }, []);

  // A tab of this section by its id, or any backend tab by its name.
  const selectTab = useCallback(
    (id: string) => {
      if (categoryTabs.some((entry) => entry.id === id)) {
        onNavigate(settingsPath(categoryKey, id));
        return;
      }
      const target = tabs.find((entry) => entry.name === id);
      if (!target) return;
      onNavigate(settingsPath(settingsCategoryOfTab(target), id));
    },
    [categoryKey, categoryTabs, onNavigate, tabs],
  );

  const handleRefreshCurrentTabOverrideSummary = useCallback(() => {
    if (!selectedTab) {
      return;
    }
    void refreshOverrideSummaryForTab(selectedTab);
  }, [selectedTab, refreshOverrideSummaryForTab]);

  const handleSave = useCallback(async () => {
    if (!selectedTab) return;
    const result = await saveTab(selectedTab);
    if (result.success) {
      void refreshOverrideSummaryForTab(selectedTab);
      onShowToast?.(result.message, 'success');
      onSettingsSaved?.();
      if (result.requiresRestart) {
        setTimeout(() => {
          onShowToast?.('Some settings require a container restart to take effect', 'info');
        }, 500);
      }
    } else {
      onShowToast?.(result.message, 'error');
    }
  }, [selectedTab, saveTab, onShowToast, onSettingsSaved, refreshOverrideSummaryForTab]);

  const handleAction = useCallback(
    async (actionKey: string) => {
      if (!selectedTab) {
        return { success: false, message: 'No tab selected' };
      }

      if (selectedTab === 'security' && actionKey === 'open_users_tab') {
        selectTab('users');
        return { success: true, message: 'Opening Users tab...' };
      }
      const result = await executeAction(selectedTab, actionKey);
      if (result.success) {
        void refreshOverrideSummaryForTab(selectedTab);
      }
      return result;
    },
    [refreshOverrideSummaryForTab, executeAction, selectedTab, selectTab],
  );

  const handleFieldChange = useCallback(
    (key: string, value: unknown) => {
      if (!selectedTab) return;
      updateValue(selectedTab, key, value);

      if (selectedTab === 'security') {
        const tabValues = values[selectedTab] || {};
        const currentScopes = getStringArrayValue(tabValues['OIDC_SCOPES']);

        if (key === 'OIDC_USE_ADMIN_GROUP') {
          const groupClaim = getStringValue(tabValues['OIDC_GROUP_CLAIM'], 'groups');
          if (value === true && !currentScopes.includes(groupClaim)) {
            updateValue(selectedTab, 'OIDC_SCOPES', [...currentScopes, groupClaim]);
          } else if (value === false && currentScopes.includes(groupClaim)) {
            updateValue(
              selectedTab,
              'OIDC_SCOPES',
              currentScopes.filter((s) => s !== groupClaim),
            );
          }
        }

        if (key === 'OIDC_GROUP_CLAIM' && typeof value === 'string') {
          const useAdminGroup = getBooleanValue(tabValues['OIDC_USE_ADMIN_GROUP']);
          if (useAdminGroup) {
            const oldClaim = getStringValue(tabValues['OIDC_GROUP_CLAIM'], 'groups');
            const newScopes = currentScopes.filter((s) => s !== oldClaim);
            if (value && !newScopes.includes(value)) {
              newScopes.push(value);
            }
            updateValue(selectedTab, 'OIDC_SCOPES', newScopes);
          }
        }
      }
    },
    [selectedTab, updateValue, values],
  );

  const currentTabHasChanges = useMemo(
    () => (selectedTab ? hasChanges(selectedTab) : false),
    [selectedTab, hasChanges],
  );

  const currentTab = selectedEntry?.tab;
  const tabSync = selectedTab ? (
    <SettingsTabSync
      key={selectedTab}
      selectedTab={selectedTab}
      refreshOverrideSummaryForTab={refreshOverrideSummaryForTab}
      setSecurityAccessError={setSecurityAccessError}
    />
  ) : null;
  const selectedAuthMethod = values.security?.AUTH_METHOD;
  const usersAuthMode = typeof selectedAuthMethod === 'string' ? selectedAuthMethod : authMode;

  let body: ReactNode;
  if (isLoading) {
    body = (
      <div className="flex flex-1 items-center justify-center gap-3 p-8 text-sm opacity-70">
        <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" aria-hidden="true">
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
            fill="none"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
        <span>Loading settings...</span>
      </div>
    );
  } else if (error) {
    body = (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      </div>
    );
  } else if (!currentTab) {
    body = (
      <div className="flex flex-1 items-center justify-center p-8 text-sm opacity-60">
        Nothing to configure here
      </div>
    );
  } else if (selectedTab === 'security' && securityAccessError) {
    body = (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8">
        <p className="text-sm opacity-60">{securityAccessError}</p>
      </div>
    );
  } else {
    body = (
      <SettingsContent
        key={selectedEntry?.id ?? currentTab.name}
        tab={currentTab}
        values={values[currentTab.name] || {}}
        onChange={handleFieldChange}
        onSave={handleSave}
        onAction={handleAction}
        isSaving={isSaving}
        hasChanges={currentTabHasChanges}
        isUniversalMode={isUniversalMode}
        overrideSummary={tabOverrideSummaries[currentTab.name]}
        customFieldContext={{
          authMode: usersAuthMode,
          onShowToast,
          onRefreshOverrideSummary: handleRefreshCurrentTabOverrideSummary,
          onRefreshAuth,
          onSettingsSaved,
        }}
      />
    );
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-labelledby="settings-title">
      {tabSync}
      <div className="shrink-0 px-4 pt-4 sm:px-6">
        <p className="text-xs font-medium tracking-wide uppercase opacity-60">Settings</p>
        <h1 id="settings-title" className="text-2xl font-semibold">
          {settingsCategoryLabel(categoryKey)}
        </h1>
        {categoryTabs.length > 1 ? (
          <nav
            className="mt-3 flex [scrollbar-width:none] gap-1 overflow-x-auto border-b border-(--border-muted)"
            aria-label={`${settingsCategoryLabel(categoryKey)} settings`}
          >
            {categoryTabs.map((entry) => {
              const selected = entry.id === selectedEntry?.id;
              return (
                <button
                  key={entry.id}
                  type="button"
                  aria-current={selected ? 'page' : undefined}
                  onClick={() => selectTab(entry.id)}
                  className={`-mb-px shrink-0 border-b-2 px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors ${
                    selected
                      ? 'border-sky-500 text-sky-600 dark:text-sky-400'
                      : 'border-transparent text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200'
                  }`}
                >
                  {entry.label}
                </button>
              );
            })}
          </nav>
        ) : (
          <div className="mt-3 border-b border-(--border-muted)" />
        )}
      </div>
      {body}
    </section>
  );
};
