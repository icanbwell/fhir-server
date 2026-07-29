'use strict';

const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

// Mock heavy dependencies
jest.mock('../../../../config', () => ({}));
jest.mock('../../../../operations/common/systemEventLogging', () => ({
    logTraceSystemEventAsync: jest.fn().mockResolvedValue(undefined),
    logSystemEventAsync: jest.fn().mockResolvedValue(undefined)
}));
jest.mock('../../../../fhir/fhirResourceCreator', () => ({
    FhirResourceCreator: {
        mapDocumentToResourceObject: jest.fn((doc) => ({ ...doc, _mapped: true }))
    }
}));

const { DatabaseCursor } = require('../../../../dataLayer/databaseCursor');
const { FhirResourceCreator } = require('../../../../fhir/fhirResourceCreator');

/**
 * Creates a mock MongoDB FindCursor-like object.
 */
function createMockCursor(docs = []) {
    let index = 0;
    const cursor = {
        namespace: { collection: 'TestResource_4_0_0', db: 'fhir' },
        hasNext: jest.fn(async () => index < docs.length),
        next: jest.fn(async () => {
            if (index < docs.length) {
                return docs[index++];
            }
            return null;
        }),
        toArray: jest.fn(async () => docs),
        maxTimeMS: jest.fn().mockReturnThis(),
        project: jest.fn().mockReturnThis(),
        map: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        batchSize: jest.fn().mockReturnThis(),
        hint: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        explain: jest.fn(async () => ({ queryPlanner: {} }))
    };
    return cursor;
}

describe('DatabaseCursor', () => {
    let mockCursor;
    let dbCursor;

    beforeEach(() => {
        jest.clearAllMocks();
        mockCursor = createMockCursor([
            { id: '1', resourceType: 'Patient' },
            { id: '2', resourceType: 'Patient' }
        ]);
        dbCursor = new DatabaseCursor({
            base_version: '4_0_0',
            resourceType: 'Patient',
            cursor: mockCursor,
            query: { id: '1' }
        });
    });

    describe('constructor validation', () => {
        test('throws when cursor is null', () => {
            expect(() => new DatabaseCursor({
                base_version: '4_0_0',
                resourceType: 'Patient',
                cursor: null,
                query: {}
            })).toThrow();
        });

        test('throws when base_version is undefined', () => {
            expect(() => new DatabaseCursor({
                base_version: undefined,
                resourceType: 'Patient',
                cursor: mockCursor,
                query: {}
            })).toThrow();
        });

        test('throws when resourceType is undefined', () => {
            expect(() => new DatabaseCursor({
                base_version: '4_0_0',
                resourceType: undefined,
                cursor: mockCursor,
                query: {}
            })).toThrow();
        });
    });

    describe('hasNext', () => {
        test('returns true when cursor has documents', async () => {
            const result = await dbCursor.hasNext();
            expect(result).toBe(true);
        });

        test('returns false when cursor is set to empty', async () => {
            dbCursor.setEmpty();
            const result = await dbCursor.hasNext();
            expect(result).toBe(false);
            // Should not call underlying cursor.hasNext
            expect(mockCursor.hasNext).not.toHaveBeenCalled();
        });
    });

    describe('next', () => {
        test('returns document with resourceType added if missing', async () => {
            const cursorWithoutType = createMockCursor([
                { id: '1' } // no resourceType, no resource field
            ]);
            const cursor = new DatabaseCursor({
                base_version: '4_0_0',
                resourceType: 'Observation',
                cursor: cursorWithoutType,
                query: {}
            });

            const result = await cursor.next();
            expect(result.resourceType).toBe('Observation');
        });

        test('does not overwrite existing resourceType', async () => {
            const cursorWithType = createMockCursor([
                { id: '1', resourceType: 'Condition' }
            ]);
            const cursor = new DatabaseCursor({
                base_version: '4_0_0',
                resourceType: 'Observation',
                cursor: cursorWithType,
                query: {}
            });

            const result = await cursor.next();
            expect(result.resourceType).toBe('Condition');
        });

        test('does not add resourceType when result has resource field (history)', async () => {
            const cursorWithResource = createMockCursor([
                { id: '1', resource: { resourceType: 'Patient', id: '1' } }
            ]);
            const cursor = new DatabaseCursor({
                base_version: '4_0_0',
                resourceType: 'Patient',
                cursor: cursorWithResource,
                query: {}
            });

            const result = await cursor.next();
            expect(result.resourceType).toBeUndefined();
        });

        test('returns null when cursor is exhausted', async () => {
            const emptyCursor = createMockCursor([]);
            const cursor = new DatabaseCursor({
                base_version: '4_0_0',
                resourceType: 'Patient',
                cursor: emptyCursor,
                query: {}
            });

            const result = await cursor.next();
            expect(result).toBeNull();
        });

        test('wraps cursor errors in RethrownError', async () => {
            const failingCursor = createMockCursor([]);
            failingCursor.next.mockRejectedValue(new Error('cursor expired'));
            const cursor = new DatabaseCursor({
                base_version: '4_0_0',
                resourceType: 'Patient',
                cursor: failingCursor,
                query: {}
            });

            await expect(cursor.next()).rejects.toThrow('cursor expired');
        });
    });

    describe('nextObject', () => {
        test('returns null when no document available', async () => {
            const emptyCursor = createMockCursor([]);
            const cursor = new DatabaseCursor({
                base_version: '4_0_0',
                resourceType: 'Patient',
                cursor: emptyCursor,
                query: {}
            });

            const result = await cursor.nextObject();
            expect(result).toBeNull();
        });

        test('maps document through FhirResourceCreator', async () => {
            const result = await dbCursor.nextObject();
            expect(FhirResourceCreator.mapDocumentToResourceObject).toHaveBeenCalledWith(
                expect.objectContaining({ id: '1' }),
                'Patient'
            );
            expect(result._mapped).toBe(true);
        });
    });

    describe('cursor operations - chaining', () => {
        test('maxTimeMS sets timeout on cursor', () => {
            const result = dbCursor.maxTimeMS({ milliSecs: 5000 });
            expect(result).toBe(dbCursor);
            expect(mockCursor.maxTimeMS).toHaveBeenCalledWith(5000);
        });

        test('project sets projection', () => {
            const result = dbCursor.project({ projection: { id: 1 } });
            expect(result).toBe(dbCursor);
            expect(mockCursor.project).toHaveBeenCalledWith({ id: 1 });
        });

        test('sort sets sort option', () => {
            const result = dbCursor.sort({ sortOption: 'id' });
            expect(result).toBe(dbCursor);
            expect(mockCursor.sort).toHaveBeenCalledWith('id', 1);
        });

        test('batchSize sets batch size', () => {
            const result = dbCursor.batchSize({ size: 100 });
            expect(result).toBe(dbCursor);
            expect(mockCursor.batchSize).toHaveBeenCalledWith(100);
        });

        test('hint sets index hint', () => {
            const result = dbCursor.hint({ indexHint: 'id_1' });
            expect(result).toBe(dbCursor);
            expect(mockCursor.hint).toHaveBeenCalledWith('id_1');
        });

        test('limit sets limit and tracks it', () => {
            expect(dbCursor.getLimit()).toBeNull();
            const result = dbCursor.limit(50);
            expect(result).toBe(dbCursor);
            expect(dbCursor.getLimit()).toBe(50);
            expect(mockCursor.limit).toHaveBeenCalledWith(50);
        });
    });

    describe('toArrayAsync', () => {
        test('returns all documents', async () => {
            const result = await dbCursor.toArrayAsync();
            expect(result).toEqual([
                { id: '1', resourceType: 'Patient' },
                { id: '2', resourceType: 'Patient' }
            ]);
        });

        test('wraps errors in RethrownError', async () => {
            mockCursor.toArray.mockRejectedValue(new Error('timeout'));
            await expect(dbCursor.toArrayAsync()).rejects.toThrow('timeout');
        });
    });

    describe('toObjectArrayAsync', () => {
        test('maps all documents through FhirResourceCreator', async () => {
            const result = await dbCursor.toObjectArrayAsync();
            expect(result).toHaveLength(2);
            expect(FhirResourceCreator.mapDocumentToResourceObject).toHaveBeenCalledTimes(2);
        });
    });

    describe('explainAsync', () => {
        test('uses queryPlanner for AuditEvent resource type', async () => {
            const auditCursor = new DatabaseCursor({
                base_version: '4_0_0',
                resourceType: 'AuditEvent',
                cursor: mockCursor,
                query: {}
            });

            await auditCursor.explainAsync();
            expect(mockCursor.explain).toHaveBeenCalledWith('queryPlanner');
        });

        test('uses default explain for non-AuditEvent', async () => {
            await dbCursor.explainAsync();
            expect(mockCursor.explain).toHaveBeenCalledWith();
        });
    });

    describe('getCollection and getDatabase', () => {
        test('returns collection name', () => {
            expect(dbCursor.getCollection()).toBe('TestResource_4_0_0');
        });

        test('returns database name', () => {
            expect(dbCursor.getDatabase()).toBe('fhir');
        });
    });

    describe('resource leak - no close method', () => {
        test('DatabaseCursor does not expose a close method for cursor cleanup', () => {
            // BUG: There is no close() method on DatabaseCursor.
            // If iteration is abandoned (e.g., after finding a result mid-way through),
            // the underlying MongoDB cursor is never closed, causing server-side resource leak.
            expect(dbCursor.close).toBeUndefined();
            // The underlying MongoDB FindCursor has a close method but it's inaccessible
            // through the DatabaseCursor wrapper without directly accessing .cursor
        });
    });
});
