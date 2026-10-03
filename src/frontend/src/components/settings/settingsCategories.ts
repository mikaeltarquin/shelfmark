import type { SettingsField, SettingsTab } from '../../types/settings';

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
  {
    key: 'indexers',
    label: 'Indexers',
    groups: ['direct_download'],
    tabs: ['prowlarr_config', 'newznab_config', 'irc', 'audiobookbay_config', 'libgen_config'],
  },
  { key: 'download-clients', label: 'Download Clients', tabs: ['prowlarr_clients'] },
  { key: 'metadata', label: 'Metadata', groups: ['metadata_providers'] },
  { key: 'libraries', label: 'Libraries', groups: ['libraries'] },
  { key: 'notifications', label: 'Notifications', tabs: ['notifications'] },
  { key: 'users', label: 'Users & Security', tabs: ['users', 'security'] },
];

const FALLBACK_CATEGORY = 'general';

// Section keys from before a rename, so old links still land in the right place.
const CATEGORY_ALIASES: Record<string, string> = { sources: 'indexers' };

export const resolveSettingsCategory = (key: string | null): string => {
  const resolved = (key && CATEGORY_ALIASES[key]) || key;
  return SETTINGS_CATEGORIES.some((category) => category.key === resolved)
    ? (resolved ?? FALLBACK_CATEGORY)
    : FALLBACK_CATEGORY;
};

/**
 * Backend tabs shown as several tabs, each from the heading that starts it to the next
 * one's. All of them still load and save as the one backend tab.
 */
const SPLIT_TABS: Record<string, Array<{ id: string; label: string; startsAt?: string }>> = {
  prowlarr_clients: [
    { id: 'torrent', label: 'Torrent' },
    { id: 'usenet', label: 'Usenet', startsAt: 'usenet_heading' },
  ],
};

/** A tab as the Settings page shows it: a backend tab, or one part of a split one. */
export interface SettingsTabEntry {
  id: string; // In the URL; the backend tab's name unless it is split
  label: string;
  tab: SettingsTab; // The backend tab, with only this part's fields
  tabName: string; // The backend tab it loads and saves as
}

const entriesForTab = (tab: SettingsTab): SettingsTabEntry[] => {
  const whole = [{ id: tab.name, label: tab.displayName, tab, tabName: tab.name }];
  const parts = SPLIT_TABS[tab.name];
  if (!parts) return whole;
  const starts = parts.map((part) =>
    part.startsAt ? tab.fields.findIndex((field) => field.key === part.startsAt) : 0,
  );
  // A heading that moved or went away: show the tab whole rather than lose fields.
  if (starts.some((start, index) => start < 0 || (index > 0 && start <= starts[index - 1]))) {
    return whole;
  }
  return parts.map((part, index) => {
    const fields: SettingsField[] = tab.fields.slice(starts[index], starts[index + 1]);
    return { id: part.id, label: part.label, tab: { ...tab, fields }, tabName: tab.name };
  });
};

export const settingsCategoryOfTab = (tab: SettingsTab): string => {
  const match = SETTINGS_CATEGORIES.find(
    (category) =>
      category.tabs?.includes(tab.name) || (tab.group && category.groups?.includes(tab.group)),
  );
  return match?.key ?? FALLBACK_CATEGORY;
};

export const settingsCategoryLabel = (key: string): string =>
  SETTINGS_CATEGORIES.find((category) => category.key === key)?.label ?? 'Settings';

/** A section's tabs, in the backend's order, with split tabs in their parts. */
export const settingsEntriesInCategory = (tabs: SettingsTab[], key: string): SettingsTabEntry[] =>
  tabs
    .filter((tab) => settingsCategoryOfTab(tab) === key)
    .toSorted((left, right) => left.order - right.order)
    .flatMap(entriesForTab);

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
