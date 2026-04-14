'use strict';

const { describe, test, beforeEach, expect } = require('@jest/globals');
const { ClickHouseDatabaseCursor } = require('./clickHouseDatabaseCursor');
const { RESOURCE_COLUMN_TYPES } = require('../../constants/clickHouseConstants');

describe('ClickHouseDatabaseCursor', () => {
    const fhirDoc1 = { resourceType: 'Observation', id: 'obs-1', status: 'final' };
    const fhirDoc2 = { resourceType: 'Observation', id: 'obs-2', status: 'amended' };

    function createCursor (rows, columnType = RESOURCE_COLUMN_TYPES.STRING) {
        return new ClickHouseDatabaseCursor({
            rows,
            resourceType: 'Observation',
            base_version: '4_0_0',
            fhirResourceColumn: '_fhir_resource',
            fhirResourceColumnType: columnType
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
            expect(row1._fhir_resource).toBe(JSON.stringify(fhirDoc1));

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

            await cursor.next(); // consume first
            const remaining = await cursor.toArrayAsync();
            expect(remaining).toHaveLength(1);
            expect(remaining[0].id).toBe('obs-2');
        });

        test('returns empty array for empty cursor', async () => {
            const cursor = createCursor([]);
            const docs = await cursor.toArrayAsync();
            expect(docs).toEqual([]);
        });
    });

    describe('toObjectArrayAsync', () => {
        test('returns FHIR Resource objects', async () => {
            const cursor = createCursor([
                { _fhir_resource: JSON.stringify(fhirDoc1) }
            ]);

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
            expect(row._fhir_resource).toBeDefined();
            expect(row.extra).toBeUndefined();
        });
    });

    describe('map', () => {
        test('transforms rows with mapping function', async () => {
            const cursor = createCursor([
                { _fhir_resource: JSON.stringify(fhirDoc1) }
            ]);

            cursor.map({ mapping: (row) => ({ transformed: true, original: row }) });
            const row = await cursor.next();
            expect(row.transformed).toBe(true);
            expect(row.original._fhir_resource).toBeDefined();
        });
    });

    describe('no-op methods', () => {
        test('maxTimeMS returns this', () => {
            const cursor = createCursor([]);
            expect(cursor.maxTimeMS(5000)).toBe(cursor);
        });

        test('sort returns this', () => {
            const cursor = createCursor([]);
            expect(cursor.sort({ sortOption: 'id' })).toBe(cursor);
        });

        test('batchSize returns this', () => {
            const cursor = createCursor([]);
            expect(cursor.batchSize({ size: 100 })).toBe(cursor);
        });

        test('hint returns this', () => {
            const cursor = createCursor([]);
            expect(cursor.hint({ indexHint: 'idx_test' })).toBe(cursor);
        });
    });

    describe('_hasMore flag', () => {
        test('hasMore is accessible', () => {
            const cursor = new ClickHouseDatabaseCursor({
                rows: [],
                resourceType: 'Observation',
                base_version: '4_0_0',
                fhirResourceColumn: '_fhir_resource',
                fhirResourceColumnType: RESOURCE_COLUMN_TYPES.STRING,
                hasMore: true
            });
            expect(cursor._hasMore).toBe(true);
        });

        test('hasMore defaults to false', () => {
            const cursor = createCursor([]);
            expect(cursor._hasMore).toBe(false);
        });
    });
});
