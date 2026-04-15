const { describe, test, expect, beforeEach } = require('@jest/globals');
const { ClickHouseDatabaseCursor } = require('../../dataLayer/clickHouseDatabaseCursor');

describe('ClickHouseDatabaseCursor', () => {
    const sampleResults = [
        { resource: { id: '1', resourceType: 'AuditEvent', action: 'R' }, _uuid: 'uuid-1' },
        { resource: { id: '2', resourceType: 'AuditEvent', action: 'U' }, _uuid: 'uuid-2' },
        { resource: { id: '3', resourceType: 'AuditEvent', action: 'C' }, _uuid: 'uuid-3' }
    ];

    let cursor;

    beforeEach(() => {
        cursor = new ClickHouseDatabaseCursor({
            base_version: '4_0_0',
            resourceType: 'AuditEvent',
            results: sampleResults,
            query: { action: 'R' }
        });
    });

    describe('hasNext', () => {
        test('returns true when results remain', async () => {
            expect(await cursor.hasNext()).toBe(true);
        });

        test('returns false for empty results', async () => {
            const emptyCursor = new ClickHouseDatabaseCursor({
                base_version: '4_0_0',
                resourceType: 'AuditEvent',
                results: [],
                query: {}
            });

            expect(await emptyCursor.hasNext()).toBe(false);
        });

        test('returns false after setEmpty', async () => {
            cursor.setEmpty();
            expect(await cursor.hasNext()).toBe(false);
        });
    });

    describe('next', () => {
        test('extracts resource field from row', async () => {
            const doc = await cursor.next();
            expect(doc).toEqual({ id: '1', resourceType: 'AuditEvent', action: 'R' });
        });

        test('sets resourceType on doc if missing', async () => {
            const cursorNoType = new ClickHouseDatabaseCursor({
                base_version: '4_0_0',
                resourceType: 'AuditEvent',
                results: [{ resource: { id: '1', action: 'R' } }],
                query: {}
            });

            const doc = await cursorNoType.next();
            expect(doc.resourceType).toBe('AuditEvent');
        });

        test('returns null when past last result', async () => {
            await cursor.next();
            await cursor.next();
            await cursor.next();
            const doc = await cursor.next();
            expect(doc).toBeNull();
        });

        test('falls back to row itself when no resource field', async () => {
            const cursorNoResource = new ClickHouseDatabaseCursor({
                base_version: '4_0_0',
                resourceType: 'AuditEvent',
                results: [{ id: 'direct', action: 'R' }],
                query: {}
            });

            const doc = await cursorNoResource.next();
            expect(doc.id).toBe('direct');
        });
    });

    describe('iteration sequence', () => {
        test('next advances index and hasNext reflects position', async () => {
            expect(await cursor.hasNext()).toBe(true);
            await cursor.next(); // index 0 -> 1

            expect(await cursor.hasNext()).toBe(true);
            await cursor.next(); // index 1 -> 2

            expect(await cursor.hasNext()).toBe(true);
            await cursor.next(); // index 2 -> 3

            expect(await cursor.hasNext()).toBe(false);
        });
    });

    describe('toArrayAsync', () => {
        test('returns all resource docs', async () => {
            const docs = await cursor.toArrayAsync();
            expect(docs).toHaveLength(3);
            expect(docs[0].id).toBe('1');
            expect(docs[1].id).toBe('2');
            expect(docs[2].id).toBe('3');
        });

        test('returns remaining docs after partial iteration', async () => {
            await cursor.next(); // consume first
            const docs = await cursor.toArrayAsync();
            expect(docs).toHaveLength(2);
            expect(docs[0].id).toBe('2');
        });

        test('returns empty array for empty cursor', async () => {
            const emptyCursor = new ClickHouseDatabaseCursor({
                base_version: '4_0_0',
                resourceType: 'AuditEvent',
                results: [],
                query: {}
            });

            const docs = await emptyCursor.toArrayAsync();
            expect(docs).toHaveLength(0);
        });
    });

    describe('no-op methods return this', () => {
        test('sort returns this', () => {
            expect(cursor.sort({ sortOption: { recorded: -1 } })).toBe(cursor);
        });

        test('hint returns this', () => {
            expect(cursor.hint({ indexHint: 'some_index' })).toBe(cursor);
        });

        test('batchSize returns this', () => {
            expect(cursor.batchSize({ size: 100 })).toBe(cursor);
        });

        test('project returns this', () => {
            expect(cursor.project({ projection: { id: 1 } })).toBe(cursor);
        });

        test('map returns this', () => {
            expect(cursor.map({ mapping: (x) => x })).toBe(cursor);
        });

        test('maxTimeMS returns this', () => {
            expect(cursor.maxTimeMS({ milliSecs: 5000 })).toBe(cursor);
        });
    });

    describe('limit', () => {
        test('stores value and getLimit returns it', () => {
            cursor.limit(10);
            expect(cursor.getLimit()).toBe(10);
        });

        test('getLimit returns null by default', () => {
            expect(cursor.getLimit()).toBeNull();
        });

        test('limit returns this for chaining', () => {
            expect(cursor.limit(5)).toBe(cursor);
        });
    });

    describe('metadata methods', () => {
        test('getCollection returns AuditEvent_4_0_0', () => {
            expect(cursor.getCollection()).toBe('AuditEvent_4_0_0');
        });

        test('getDatabase returns fhir', () => {
            expect(cursor.getDatabase()).toBe('fhir');
        });

        test('getQuery returns original query', () => {
            expect(cursor.getQuery()).toEqual({ action: 'R' });
        });
    });

    describe('explainAsync', () => {
        test('returns ClickHouse info', async () => {
            const explanation = await cursor.explainAsync();
            expect(explanation).toHaveLength(1);
            expect(explanation[0]).toEqual({
                source: 'ClickHouse',
                table: 'fhir.AuditEvent_4_0_0',
                query: { action: 'R' },
                resultCount: 3
            });
        });
    });

    describe('constructor defaults', () => {
        test('results defaults to empty array when not provided', () => {
            const c = new ClickHouseDatabaseCursor({
                base_version: '4_0_0',
                resourceType: 'AuditEvent',
                query: {}
            });

            expect(c._results).toEqual([]);
        });
    });
});
