import { describe, it, expect } from 'vitest';

import type { MetadataSearchField } from '../types';
import {
  buildQueryTargets,
  findQueryTarget,
  generalSuggestionAction,
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

describe('General suggestions', () => {
  const fields: MetadataSearchField[] = [
    {
      key: 'author',
      label: 'Author',
      type: 'TextSearchField',
      suggestions_endpoint: '/api/metadata/field-options?provider=hardcover&field=author',
    },
    {
      key: 'title',
      label: 'Title',
      type: 'TextSearchField',
      suggestions_endpoint: '/api/metadata/field-options?provider=hardcover&field=title',
    },
  ];
  const targets = buildQueryTargets({ searchMode: 'universal', metadataSearchFields: fields });
  const general = findQueryTarget(targets, 'general');
  const generalEndpoint = '/api/metadata/field-options?provider=hardcover&field=general';

  it("use the provider's General suggestions over its title suggestions", () => {
    const field = searchBarQueryField(general, 'universal', fields, generalEndpoint);
    expect(field).toMatchObject({ key: 'general', suggestions_endpoint: generalEndpoint });
  });

  it('open a picked series in reading order', () => {
    expect(
      generalSuggestionAction(
        { value: 'id:997', label: 'The Stormlight Archive', kind: 'series' },
        general,
        targets,
        true,
      ),
    ).toEqual({ kind: 'series', name: 'The Stormlight Archive', seriesId: '997' });
  });

  it('turn a picked author into an Author search', () => {
    const action = generalSuggestionAction(
      { value: 'id:204214', label: 'Brandon Sanderson', kind: 'author' },
      general,
      targets,
      true,
    );
    expect(action?.kind).toBe('author');
    expect(action?.kind === 'author' && action.target.key).toBe('author');
  });

  it('search a picked book, and leave picks outside General alone', () => {
    const book = { value: 'Elantris', label: 'Elantris', kind: 'book' as const };
    expect(generalSuggestionAction(book, general, targets, true)).toBeNull();
    const series = { value: 'id:1', label: 'Mistborn', kind: 'series' as const };
    expect(
      generalSuggestionAction(series, findQueryTarget(targets, 'title'), targets, true),
    ).toBeNull();
    expect(generalSuggestionAction(series, general, targets, false)).toBeNull();
  });
});
