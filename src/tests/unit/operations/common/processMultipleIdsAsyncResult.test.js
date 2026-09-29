'use strict';

const { describe, test, expect } = require('@jest/globals');
const { ProcessMultipleIdsAsyncResult } = require('../../../../operations/common/processMultipleIdsAsyncResult');

describe('ProcessMultipleIdsAsyncResult', () => {
    test('stores all constructor properties', () => {
        const result = new ProcessMultipleIdsAsyncResult({
            entries: [{ resource: { id: '1' } }],
            queryItems: [{ query: {} }],
            options: [{ projection: { id: 1 } }],
            explanations: [{ stage: 'IXSCAN' }],
            bundleEntryIdsProcessed: [{ id: '1', resourceType: 'Patient' }],
            streamedResources: [{ id: '2', resourceType: 'Obs' }]
        });
        expect(result.entries).toHaveLength(1);
        expect(result.queryItems).toHaveLength(1);
        expect(result.options).toHaveLength(1);
        expect(result.explanations).toHaveLength(1);
        expect(result.bundleEntryIdsProcessed).toHaveLength(1);
        expect(result.streamedResources).toHaveLength(1);
    });

    test('streamedResources defaults to empty array when undefined', () => {
        const result = new ProcessMultipleIdsAsyncResult({
            entries: [],
            queryItems: [],
            options: [],
            explanations: [],
            bundleEntryIdsProcessed: [],
            streamedResources: undefined
        });
        expect(result.streamedResources).toEqual([]);
    });

    test('streamedResources defaults to empty array when not provided', () => {
        const result = new ProcessMultipleIdsAsyncResult({
            entries: [],
            queryItems: [],
            options: [],
            explanations: [],
            bundleEntryIdsProcessed: []
        });
        expect(result.streamedResources).toEqual([]);
    });

    test('preserves reference identity of arrays', () => {
        const entries = [{ resource: { id: 'a' } }];
        const result = new ProcessMultipleIdsAsyncResult({
            entries,
            queryItems: [],
            options: [],
            explanations: [],
            bundleEntryIdsProcessed: []
        });
        expect(result.entries).toBe(entries);
    });
});
