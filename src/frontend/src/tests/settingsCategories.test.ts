import { describe, expect, it } from 'vitest';

import { settingsEntriesInCategory } from '../components/settings/settingsCategories';
import type { SettingsField, SettingsTab } from '../types/settings';

const heading = (key: string): SettingsField => ({ key, type: 'HeadingField', title: key });

const prowlarr: SettingsTab = {
  name: 'prowlarr_config',
  displayName: 'Prowlarr',
  order: 41,
  fields: [
    heading('prowlarr_heading'),
    heading('prowlarr_mam_tab_notice'),
    heading('prowlarr_mam_heading'),
  ],
};

describe('settingsEntriesInCategory', () => {
  it('splits MyAnonamouse off the Prowlarr tab, saving as the one backend tab', () => {
    const entries = settingsEntriesInCategory([prowlarr], 'indexers');
    expect(entries.map((entry) => [entry.id, entry.label, entry.tabName])).toEqual([
      ['prowlarr_config', 'Prowlarr', 'prowlarr_config'],
      ['myanonamouse', 'MyAnonamouse', 'prowlarr_config'],
    ]);
    expect(entries[0].tab.fields.map((field) => field.key)).toEqual(['prowlarr_heading']);
    expect(entries[1].tab.fields.map((field) => field.key)).toEqual([
      'prowlarr_mam_tab_notice',
      'prowlarr_mam_heading',
    ]);
  });

  it('shows the tab whole when the MyAnonamouse heading is missing', () => {
    const tab = { ...prowlarr, fields: [heading('prowlarr_heading')] };
    expect(settingsEntriesInCategory([tab], 'indexers').map((entry) => entry.id)).toEqual([
      'prowlarr_config',
    ]);
  });
});
