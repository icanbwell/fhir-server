'use strict';

const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../utils/assertType', () => ({
    assertIsValid: jestObj.fn()
}));

jestObj.mock('../../../operations/common/systemEventLogging', () => ({
    logTraceSystemEventAsync: jestObj.fn().mockResolvedValue(undefined)
}));

jestObj.mock('../../../fhir/fhirResourceCreator', () => ({
    FhirResourceCreator: {
        mapDocumentToResourceObject: jestObj.fn((doc, type) => ({ ...doc, resourceType: type, _mapped: true }))
    }
}));

jestObj.mock('../../../fhir/classes/4_0_0/backbone_elements/bundleEntry', () => class BundleEntry {});

const { DatabaseCursor } = require('../../../dataLayer/databaseCursor');

describe('DatabaseCursor', () => {
    let mockCursor;

    beforeEach(() => {
        mockCursor = {
            namespace: { collection: 'Patient_4_0_0', db: 'fhir' },
            hasNext: jestObj.fn().mockResolvedValue(true),
            next: jestObj.fn().mockResolvedValue({ id: '1', resourceType: 'Patient' }),
            toArray: jestObj.fn().mockResolvedValue([{ id: '1' }, { id: '2' }]),
            maxTimeMS: jestObj.fn().mockReturnThis(),
            project: jestObj.fn().mockReturnThis(),
            map: jestObj.fn().mockReturnThis(),
            sort: jestObj.fn().mockReturnThis(),
            batchSize: jestObj.fn().mockReturnThis(),
            hint: jestObj.fn().mockReturnThis(),
            limit: jestObj.fn().mockReturnThis(),
            explain: jestObj.fn().mockResolvedValue({ queryPlanner: {} })
        };
    });

    test('constructor stores properties', () => {
        const dc = new DatabaseCursor({
            base_version: '4_0_0', resourceType: 'Patient', cursor: mockCursor, query: { id: '1' }
        });
        expect(dc.base_version).toBe('4_0_0');
        expect(dc.resourceType).toBe('Patient');
        expect(dc.cursor).toBe(mockCursor);
        expect(dc.query).toEqual({ id: '1' });
    });

    test('hasNext delegates to cursor', async () => {
        const dc = new DatabaseCursor({
            base_version: '4_0_0', resourceType: 'Patient', cursor: mockCursor, query: {}
        });
        const result = await dc.hasNext();
        expect(result).toBe(true);
        expect(mockCursor.hasNext).toHaveBeenCalled();
    });

    test('hasNext returns false when empty', async () => {
        const dc = new DatabaseCursor({
            base_version: '4_0_0', resourceType: 'Patient', cursor: mockCursor, query: {}
        });
        dc.setEmpty();
        const result = await dc.hasNext();
        expect(result).toBe(false);
        expect(mockCursor.hasNext).not.toHaveBeenCalled();
    });

    test('next returns document from cursor', async () => {
        const dc = new DatabaseCursor({
            base_version: '4_0_0', resourceType: 'Patient', cursor: mockCursor, query: {}
        });
        const doc = await dc.next();
        expect(doc).toEqual({ id: '1', resourceType: 'Patient' });
    });

    test('next adds resourceType when missing from result', async () => {
        mockCursor.next.mockResolvedValue({ id: '2' });
        const dc = new DatabaseCursor({
            base_version: '4_0_0', resourceType: 'Observation', cursor: mockCursor, query: {}
        });
        const doc = await dc.next();
        expect(doc.resourceType).toBe('Observation');
    });

    test('next does not override existing resourceType', async () => {
        mockCursor.next.mockResolvedValue({ id: '1', resourceType: 'Patient' });
        const dc = new DatabaseCursor({
            base_version: '4_0_0', resourceType: 'Observation', cursor: mockCursor, query: {}
        });
        const doc = await dc.next();
        expect(doc.resourceType).toBe('Patient');
    });

    test('next wraps errors in RethrownError', async () => {
        mockCursor.next.mockRejectedValue(new Error('connection lost'));
        const dc = new DatabaseCursor({
            base_version: '4_0_0', resourceType: 'Patient', cursor: mockCursor, query: {}
        });
        await expect(dc.next()).rejects.toThrow();
    });

    test('maxTimeMS sets timeout on cursor', () => {
        const dc = new DatabaseCursor({
            base_version: '4_0_0', resourceType: 'Patient', cursor: mockCursor, query: {}
        });
        const result = dc.maxTimeMS({ milliSecs: 5000 });
        expect(mockCursor.maxTimeMS).toHaveBeenCalledWith(5000);
        expect(result).toBe(dc);
    });

    test('project sets field projection', () => {
        const dc = new DatabaseCursor({
            base_version: '4_0_0', resourceType: 'Patient', cursor: mockCursor, query: {}
        });
        dc.project({ projection: { id: 1, name: 1 } });
        expect(mockCursor.project).toHaveBeenCalledWith({ id: 1, name: 1 });
    });

    test('sort sets sort order', () => {
        const dc = new DatabaseCursor({
            base_version: '4_0_0', resourceType: 'Patient', cursor: mockCursor, query: {}
        });
        dc.sort({ sortOption: 'meta.lastUpdated' });
        expect(mockCursor.sort).toHaveBeenCalledWith('meta.lastUpdated', 1);
    });

    test('limit stores limit and calls cursor', () => {
        const dc = new DatabaseCursor({
            base_version: '4_0_0', resourceType: 'Patient', cursor: mockCursor, query: {}
        });
        dc.limit(50);
        expect(dc.getLimit()).toBe(50);
        expect(mockCursor.limit).toHaveBeenCalledWith(50);
    });

    test('getLimit returns null by default', () => {
        const dc = new DatabaseCursor({
            base_version: '4_0_0', resourceType: 'Patient', cursor: mockCursor, query: {}
        });
        expect(dc.getLimit()).toBeNull();
    });

    test('getCollection returns cursor collection name', () => {
        const dc = new DatabaseCursor({
            base_version: '4_0_0', resourceType: 'Patient', cursor: mockCursor, query: {}
        });
        expect(dc.getCollection()).toBe('Patient_4_0_0');
    });

    test('getDatabase returns cursor database name', () => {
        const dc = new DatabaseCursor({
            base_version: '4_0_0', resourceType: 'Patient', cursor: mockCursor, query: {}
        });
        expect(dc.getDatabase()).toBe('fhir');
    });

    test('toArrayAsync returns array from cursor', async () => {
        const dc = new DatabaseCursor({
            base_version: '4_0_0', resourceType: 'Patient', cursor: mockCursor, query: {}
        });
        const result = await dc.toArrayAsync();
        expect(result).toEqual([{ id: '1' }, { id: '2' }]);
    });

    test('explainAsync uses queryPlanner for AuditEvent', async () => {
        const dc = new DatabaseCursor({
            base_version: '4_0_0', resourceType: 'AuditEvent', cursor: mockCursor, query: {}
        });
        await dc.explainAsync();
        expect(mockCursor.explain).toHaveBeenCalledWith('queryPlanner');
    });

    test('explainAsync uses default for non-AuditEvent', async () => {
        const dc = new DatabaseCursor({
            base_version: '4_0_0', resourceType: 'Patient', cursor: mockCursor, query: {}
        });
        await dc.explainAsync();
        expect(mockCursor.explain).toHaveBeenCalledWith();
    });

    test('getQuery returns the query', () => {
        const query = { 'meta.security.code': 'bwell' };
        const dc = new DatabaseCursor({
            base_version: '4_0_0', resourceType: 'Patient', cursor: mockCursor, query
        });
        expect(dc.getQuery()).toBe(query);
    });

    test('batchSize sets batch size on cursor', () => {
        const dc = new DatabaseCursor({
            base_version: '4_0_0', resourceType: 'Patient', cursor: mockCursor, query: {}
        });
        dc.batchSize({ size: 500 });
        expect(mockCursor.batchSize).toHaveBeenCalledWith(500);
    });
});
