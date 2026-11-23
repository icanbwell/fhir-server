'use strict';

const { describe, test, expect } = require('@jest/globals');
const {
    DataViewControlCompositionEnrichmentProvider
} = require('../../../../enrich/providers/dataViewControlCompositionEnrichmentProvider');

const EXCLUDE_MAP = Object.freeze({ CarePlan: Object.freeze(['care-plan-1']) });
const blockedSection = () => ({ id: 'blocked', entry: [{ reference: 'CarePlan/care-plan-1' }] });
const keptSection = () => ({ id: 'kept', entry: [{ reference: 'CarePlan/care-plan-2' }] });
const composition = () => ({ resourceType: 'Composition', id: 'c1', section: [blockedSection(), keptSection()] });
const sectionIds = (resource) => (resource.section || []).map((s) => s.id);

describe('DataViewControlCompositionEnrichmentProvider', () => {
    const provider = new DataViewControlCompositionEnrichmentProvider();

    test('removes the sections of a Composition that reference a hidden resource', async () => {
        const [resource] = await provider.enrichAsync({
            resources: [composition()], enrichmentContext: { viewControlExcludeMap: EXCLUDE_MAP }
        });
        expect(sectionIds(resource)).toEqual(['kept']);
    });

    test.each([
        ['no enrichment context', undefined],
        ['a context without an exclude map (view control not applied)', { userType: 'user' }],
        ['an empty exclude map', { viewControlExcludeMap: {} }]
    ])('leaves Compositions untouched for %s', async (_name, enrichmentContext) => {
        const [resource] = await provider.enrichAsync({ resources: [composition()], enrichmentContext });
        expect(sectionIds(resource)).toEqual(['blocked', 'kept']);
    });

    test('filters a Composition among another resource\'s contained resources', async () => {
        const list = { resourceType: 'List', id: 'l1', contained: [composition()] };
        const [resource] = await provider.enrichAsync({
            resources: [list], enrichmentContext: { viewControlExcludeMap: EXCLUDE_MAP }
        });
        expect(sectionIds(resource.contained[0])).toEqual(['kept']);
    });

    test('leaves other resource types alone, even with a section-shaped field', async () => {
        const other = { resourceType: 'Questionnaire', id: 'q1', section: [blockedSection()] };
        const [resource] = await provider.enrichAsync({
            resources: [other], enrichmentContext: { viewControlExcludeMap: EXCLUDE_MAP }
        });
        expect(sectionIds(resource)).toEqual(['blocked']);
    });

    test('filters bundle entries in place and skips entries without a resource', async () => {
        const entries = [{ resource: composition() }, { fullUrl: 'no-resource' }];
        const result = await provider.enrichBundleEntriesAsync({
            entries, enrichmentContext: { viewControlExcludeMap: EXCLUDE_MAP }
        });
        expect(result).toBe(entries);
        expect(sectionIds(result[0].resource)).toEqual(['kept']);
        expect(result[1]).toEqual({ fullUrl: 'no-resource' });
    });
});
