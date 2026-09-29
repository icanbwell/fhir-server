'use strict';

const { describe, test, expect } = require('@jest/globals');
const { GetCursorResult } = require('../../../../operations/search/getCursorResult');

describe('GetCursorResult', () => {
    test('stores all constructor params', () => {
        const params = {
            cursorBatchSize: 100,
            cursor: { hasNext: true },
            indexHint: 'name_1',
            columns: new Set(['id', 'name']),
            total_count: 500,
            query: { resourceType: 'Patient' },
            options: { sort: { _lastUpdated: -1 } },
            resources: [{ id: '1' }],
            originalQuery: { name: 'Smith' },
            originalOptions: { limit: 10 }
        };

        const result = new GetCursorResult(params);

        expect(result.cursorBatchSize).toBe(100);
        expect(result.cursor).toBe(params.cursor);
        expect(result.indexHint).toBe('name_1');
        expect(result.columns).toBe(params.columns);
        expect(result.total_count).toBe(500);
        expect(result.query).toBe(params.query);
        expect(result.options).toBe(params.options);
        expect(result.resources).toBe(params.resources);
        expect(result.originalQuery).toBe(params.originalQuery);
        expect(result.originalOptions).toBe(params.originalOptions);
    });

    test('handles null values', () => {
        const result = new GetCursorResult({
            cursorBatchSize: null,
            cursor: null,
            indexHint: null,
            columns: new Set(),
            total_count: null,
            query: {},
            options: {},
            resources: [],
            originalQuery: null,
            originalOptions: null
        });

        expect(result.cursorBatchSize).toBeNull();
        expect(result.cursor).toBeNull();
        expect(result.indexHint).toBeNull();
        expect(result.total_count).toBeNull();
    });

    test('columns is a Set', () => {
        const result = new GetCursorResult({
            cursorBatchSize: null,
            cursor: null,
            indexHint: null,
            columns: new Set(['a', 'b', 'c']),
            total_count: 0,
            query: {},
            options: {},
            resources: [],
            originalQuery: null,
            originalOptions: null
        });

        expect(result.columns).toBeInstanceOf(Set);
        expect(result.columns.size).toBe(3);
    });
});
