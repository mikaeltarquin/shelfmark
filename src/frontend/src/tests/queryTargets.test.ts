import { describe, it, expect } from 'vitest';

import type { MetadataSearchField } from '../types';
import {
  buildQueryTargets,
  findQueryTarget,
  getDefaultQueryTargetKey,
  searchBarQueryField,
} from '../utils/queryTargets';

describe('queryTargets', () => {
  it('builds direct-mode query targets', () => {
    const targets = buildQueryTargets({ searchMode: 'direct' });

    expect(targets.map((target) => target.key)).toEqual(['general', 'isbn', 'author', 'title']);
  });

  it('builds universal query targets from provider fields', () => {
    const targets = buildQueryTargets({
      searchMode: 'universal',
      metadataSearchFields: [
        {
          key: 'author',
          label: 'Author',
          type: 'TextSearchField',
          description: 'Search by author name',
        },
        {
          key: 'hardcover_list',
          label: 'List',
          type: 'DynamicSelectSearchField',
          options_endpoint: '/api/metadata/field-options?provider=hardcover&field=hardcover_list',
          description: 'Browse books from a list',
        },
      ],
      manualSearchAllowed: true,
    });

    expect(targets.map((target) => target.key)).toEqual([
      'general',
      'author',
      'hardcover_list',
      'manual',
    ]);
    expect(targets[1]?.source).toBe('provider-field');
    expect(targets[3]?.source).toBe('manual');
  });

  it('falls back to general when choosing a default target', () => {
    expect(getDefaultQueryTargetKey([])).toBe('general');
  });
});

describe('findQueryTarget', () => {
  const targets = buildQueryTargets({ searchMode: 'direct' });

  it('returns undefined for a missing or empty key', () => {
    expect(findQueryTarget(targets, undefined)).toBeUndefined();
    expect(findQueryTarget(targets, '')).toBeUndefined();
    expect(findQueryTarget(targets, 'series')).toBeUndefined();
  });

  it('matches an exact key', () => {
    expect(findQueryTarget(targets, 'author')?.key).toBe('author');
  });

  it('falls back to a case-insensitive match for custom provider field keys', () => {
    const providerTargets = buildQueryTargets({
      searchMode: 'universal',
      metadataSearchFields: [
        {
          key: 'hardcoverList',
          label: 'List',
          type: 'TextSearchField',
        },
      ],
    });

    expect(findQueryTarget(providerTargets, 'hardcoverlist')?.key).toBe('hardcoverList');
    expect(findQueryTarget(providerTargets, 'hardcoverList')?.key).toBe('hardcoverList');
  });
});

describe('searchBarQueryField', () => {
  const fields: MetadataSearchField[] = [
    {
      key: 'title',
      label: 'Title',
      type: 'TextSearchField',
      suggestions_endpoint: '/api/metadata/field-options?provider=hardcover&field=title',
    },
  ];
  const universal = buildQueryTargets({ searchMode: 'universal', metadataSearchFields: fields });
  const general = findQueryTarget(universal, 'general');

  it('gives General the title suggestions in universal mode', () => {
    expect(searchBarQueryField(general, 'universal', fields)).toEqual({
      key: 'general',
      label: 'General',
      type: 'TextSearchField',
      suggestions_endpoint: '/api/metadata/field-options?provider=hardcover&field=title',
      suggestions_min_query_length: undefined,
    });
  });

  it('keeps a field target as it is', () => {
    expect(searchBarQueryField(findQueryTarget(universal, 'title'), 'universal', fields)).toBe(
      fields[0],
    );
  });

  it('leaves General plain without title suggestions or in direct mode', () => {
    const plainTitle: MetadataSearchField[] = [
      { key: 'title', label: 'Title', type: 'TextSearchField' },
    ];
    expect(searchBarQueryField(general, 'universal', plainTitle)).toBeNull();
    expect(searchBarQueryField(general, 'direct', fields)).toBeNull();
  });
});
