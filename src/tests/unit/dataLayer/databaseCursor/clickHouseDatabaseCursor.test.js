'use strict';

const { describe, test, expect } = require('@jest/globals');
const { ClickHouseDatabaseCursor } = require('../../../../dataLayer/databaseCursor/clickHouseDatabaseCursor');
const { RESOURCE_COLUMN_TYPES } = require('../../../../constants/clickHouseConstants');

describe('ClickHouseDatabaseCursor', () => {
    const fhirDoc1 = { resourceType: 'Observation', id: 'obs-1', status: 'final' };
    const fhirDoc2 = { resourceType: 'Observation', id: 'obs-2', status: 'amended' };

    function createCursor (rows, columnType = RESOURCE_COLUMN_TYPES.STRING, opts = {}) {
        return new ClickHouseDatabaseCursor({
            rows,
            resourceType: 'Observation',
            base_version: '4_0_0',
            fhirResourceColumn: '_fhir_resource',
            fhirResourceColumnType: columnType,
            ...opts
        });
    }

    describe('hasNext and next', () => {
        test('iterates through all rows', async () => {
            const cursor = createCursor([
                { _fhir_resource: JSON.stringify(fhirDoc1) },
                { _fhir_resource: JSON.stringify(fhirDoc2) }
            ]);

            expect(await cursor.hasNext()).toBe(true);
            const row1 = await cursor.next();
            expect(row1.id).toBe('obs-1');

            expect(await cursor.hasNext()).toBe(true);
            await cursor.next();

            expect(await cursor.hasNext()).toBe(false);
        });

        test('next returns null after exhaustion', async () => {
            const cursor = createCursor([{ _fhir_resource: JSON.stringify(fhirDoc1) }]);
            await cursor.next();
            expect(await cursor.next()).toBeNull();
        });

        test('empty cursor has no next', async () => {
            const cursor = createCursor([]);
            expect(await cursor.hasNext()).toBe(false);
            expect(await cursor.next()).toBeNull();
        });

        test('setEmpty makes hasNext return false', async () => {
            const cursor = createCursor([{ _fhir_resource: JSON.stringify(fhirDoc1) }]);
            cursor.setEmpty();
            expect(await cursor.hasNext()).toBe(false);
        });
    });

    describe('nextObject', () => {
        test('returns FHIR Resource object', async () => {
            const cursor = createCursor([{ _fhir_resource: JSON.stringify(fhirDoc1) }]);
            const resource = await cursor.nextObject();
            expect(resource.id).toBe('obs-1');
            expect(resource.resourceType).toBe('Observation');
        });

        test('returns null when exhausted', async () => {
            const cursor = createCursor([]);
            expect(await cursor.nextObject()).toBeNull();
        });
    });

    describe('toArrayAsync', () => {
        test('returns parsed FHIR documents from string column', async () => {
            const cursor = createCursor([
                { _fhir_resource: JSON.stringify(fhirDoc1) },
                { _fhir_resource: JSON.stringify(fhirDoc2) }
            ]);

            const docs = await cursor.toArrayAsync();
            expect(docs).toHaveLength(2);
            expect(docs[0].id).toBe('obs-1');
            expect(docs[1].id).toBe('obs-2');
        });

        test('handles native JSON column type (already parsed)', async () => {
            const cursor = createCursor([
                { _fhir_resource: fhirDoc1 },
                { _fhir_resource: fhirDoc2 }
            ], RESOURCE_COLUMN_TYPES.JSON);

            const docs = await cursor.toArrayAsync();
            expect(docs).toHaveLength(2);
            expect(docs[0].id).toBe('obs-1');
        });

        test('returns remaining after partial iteration', async () => {
            const cursor = createCursor([
                { _fhir_resource: JSON.stringify(fhirDoc1) },
                { _fhir_resource: JSON.stringify(fhirDoc2) }
            ]);

            await cursor.next();
            const remaining = await cursor.toArrayAsync();
            expect(remaining).toHaveLength(1);
            expect(remaining[0].id).toBe('obs-2');
        });

        test('returns empty array for empty cursor', async () => {
            const cursor = createCursor([]);
            expect(await cursor.toArrayAsync()).toEqual([]);
        });
    });

    describe('toObjectArrayAsync', () => {
        test('returns FHIR Resource objects', async () => {
            const cursor = createCursor([{ _fhir_resource: JSON.stringify(fhirDoc1) }]);
            const resources = await cursor.toObjectArrayAsync();
            expect(resources).toHaveLength(1);
            expect(resources[0].id).toBe('obs-1');
            expect(resources[0].resourceType).toBe('Observation');
        });
    });

    describe('project', () => {
        test('filters row fields by projection', async () => {
            const cursor = createCursor([
                { _fhir_resource: JSON.stringify(fhirDoc1), extra: 'data' }
            ]);
            cursor.project({ projection: { _fhir_resource: 1 } });
            const row = await cursor.next();
            // Projection keeps _fhir_resource, then next() extracts the FHIR doc
            expect(row.id).toBe('obs-1');
            expect(row.resourceType).toBe('Observation');
            expect(row.extra).toBeUndefined();
        });
    });

    describe('map', () => {
        test('transforms rows with mapping function', async () => {
            const cursor = createCursor([{ _fhir_resource: JSON.stringify(fhirDoc1) }]);
            cursor.map({ mapping: (row) => ({ transformed: true, original: row }) });
            const row = await cursor.next();
            expect(row.transformed).toBe(true);
        });
    });

    describe('explainAsync', () => {
        test('returns ClickHouse explain info', async () => {
            const cursor = createCursor(
                [{ _fhir_resource: JSON.stringify(fhirDoc1) }],
                RESOURCE_COLUMN_TYPES.STRING,
                { tableName: 'fhir.fhir_test', query: { status: 'final' } }
            );
            const explain = await cursor.explainAsync();
            expect(explain).toHaveLength(1);
            expect(explain[0].source).toBe('clickhouse');
            expect(explain[0].table).toBe('fhir.fhir_test');
            expect(explain[0].rowCount).toBe(1);
        });
    });

    describe('limit', () => {
        test('trims rows to count', async () => {
            const cursor = createCursor([
                { _fhir_resource: JSON.stringify(fhirDoc1) },
                { _fhir_resource: JSON.stringify(fhirDoc2) }
            ]);
            cursor.limit(1);
            expect(cursor.getLimit()).toBe(1);
            const docs = await cursor.toArrayAsync();
            expect(docs).toHaveLength(1);
        });

        test('getLimit returns null before limit is set', () => {
            const cursor = createCursor([]);
            expect(cursor.getLimit()).toBeNull();
        });
    });

    describe('getQuery', () => {
        test('returns the original query', () => {
            const query = { status: 'final' };
            const cursor = createCursor([], RESOURCE_COLUMN_TYPES.STRING, { query });
            expect(cursor.getQuery()).toBe(query);
        });

        test('returns null when no query provided', () => {
            const cursor = createCursor([]);
            expect(cursor.getQuery()).toBeNull();
        });
    });

    describe('getCollection and getDatabase', () => {
        test('getCollection returns table name', () => {
            const cursor = createCursor([], RESOURCE_COLUMN_TYPES.STRING, { tableName: 'fhir.fhir_test' });
            expect(cursor.getCollection()).toBe('fhir.fhir_test');
        });

        test('getDatabase returns fhir', () => {
            const cursor = createCursor([]);
            expect(cursor.getDatabase()).toBe('fhir');
        });
    });

    describe('no-op methods return this', () => {
        test.each([
            ['maxTimeMS', { milliSecs: 5000 }],
            ['sort', { sortOption: 'id' }],
            ['batchSize', { size: 100 }],
            ['hint', { indexHint: 'idx_test' }]
        ])('%s returns this', (method, arg) => {
            const cursor = createCursor([]);
            expect(cursor[method](arg)).toBe(cursor);
        });
    });

    describe('_hasMore flag', () => {
        test('hasMore is set from constructor', () => {
            const cursor = createCursor([], RESOURCE_COLUMN_TYPES.STRING, { hasMore: true });
            expect(cursor._hasMore).toBe(true);
        });

        test('hasMore defaults to false', () => {
            const cursor = createCursor([]);
            expect(cursor._hasMore).toBe(false);
        });
    });
});
