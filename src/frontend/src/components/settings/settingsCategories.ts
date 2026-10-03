import type { SettingsTab } from '../../types/settings';

/**
 * The Settings sections in the main navigation, Sonarr-style. Each gathers the backend's
 * settings tabs, by name or by group; a tab no section names goes under General, so a new
 * tab is never unreachable.
 */
interface SettingsCategoryDef {
  key: string;
  label: string;
  tabs?: string[];
  groups?: string[];
}

export const SETTINGS_CATEGORIES: SettingsCategoryDef[] = [
  { key: 'general', label: 'General', tabs: ['general', 'search_mode', 'network', 'advanced'] },
  { key: 'downloads', label: 'Downloads', tabs: ['downloads'] },
  { key: 'download-clients', label: 'Download Clients', tabs: ['prowlarr_clients'] },
  {
    key: 'sources',
    label: 'Release Sources',
    groups: ['direct_download'],
    tabs: ['prowlarr_config', 'newznab_config', 'irc', 'audiobookbay_config', 'libgen_config'],
  },
  { key: 'metadata', label: 'Metadata', groups: ['metadata_providers'] },
  { key: 'libraries', label: 'Libraries', groups: ['libraries'] },
  { key: 'notifications', label: 'Notifications', tabs: ['notifications'] },
  { key: 'users', label: 'Users & Security', tabs: ['users', 'security'] },
];

const FALLBACK_CATEGORY = 'general';

export const settingsCategoryOfTab = (tab: SettingsTab): string => {
  const match = SETTINGS_CATEGORIES.find(
    (category) =>
      category.tabs?.includes(tab.name) || (tab.group && category.groups?.includes(tab.group)),
  );
  return match?.key ?? FALLBACK_CATEGORY;
};

export const settingsCategoryLabel = (key: string): string =>
  SETTINGS_CATEGORIES.find((category) => category.key === key)?.label ?? 'Settings';

/** A section's tabs, in the backend's order. */
export const tabsInSettingsCategory = (tabs: SettingsTab[], key: string): SettingsTab[] =>
  tabs
    .filter((tab) => settingsCategoryOfTab(tab) === key)
    .toSorted((left, right) => left.order - right.order);

export const settingsPath = (category: string, tab?: string | null): string =>
  tab ? `/settings/${category}/${encodeURIComponent(tab)}` : `/settings/${category}`;

/** `/settings/<section>/<tab>` into its parts; either may be missing. */
export const parseSettingsRoute = (
  pathname: string,
): { category: string | null; tab: string | null } => {
  const [, , category, tab] = pathname.replace(/\/+$/, '').split('/');
  return {
    category: category || null,
    tab: tab ? decodeURIComponent(tab) : null,
  };
};
