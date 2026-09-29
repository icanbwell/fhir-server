const { describe, test, expect } = require('@jest/globals');
const { BulkInsertUpdateEntry } = require('../../../dataLayer/bulkInsertUpdateEntry');

describe('BulkInsertUpdateEntry', () => {
    const defaultParams = {
        operationType: 'insert',
        isCreateOperation: true,
        isUpdateOperation: false,
        resourceType: 'Patient',
        id: 'patient-123',
        uuid: 'uuid-abc-123',
        resource: { id: 'patient-123', resourceType: 'Patient' },
        operation: { insertOne: { document: {} } },
        patches: null,
        skipped: false,
        sourceAssigningAuthority: 'https://example.org'
    };

    test('should construct with all required properties', () => {
        const entry = new BulkInsertUpdateEntry(defaultParams);

        expect(entry.operationType).toBe('insert');
        expect(entry.isCreateOperation).toBe(true);
        expect(entry.isUpdateOperation).toBe(false);
        expect(entry.resourceType).toBe('Patient');
        expect(entry.id).toBe('patient-123');
        expect(entry.uuid).toBe('uuid-abc-123');
        expect(entry.resource).toEqual({ id: 'patient-123', resourceType: 'Patient' });
        expect(entry.operation).toEqual({ insertOne: { document: {} } });
        expect(entry.patches).toBeNull();
        expect(entry.skipped).toBe(false);
        expect(entry.sourceAssigningAuthority).toBe('https://example.org');
    });

    test('should default contextData to null when not provided', () => {
        const entry = new BulkInsertUpdateEntry(defaultParams);
        expect(entry.contextData).toBeNull();
    });

    test('should set contextData when provided', () => {
        const contextData = { groupMembers: ['member-1', 'member-2'] };
        const entry = new BulkInsertUpdateEntry({
            ...defaultParams,
            contextData
        });
        expect(entry.contextData).toEqual(contextData);
    });

    test('should handle operationType "insertUniqueId"', () => {
        const entry = new BulkInsertUpdateEntry({
            ...defaultParams,
            operationType: 'insertUniqueId'
        });
        expect(entry.operationType).toBe('insertUniqueId');
    });

    test('should handle operationType "replace"', () => {
        const entry = new BulkInsertUpdateEntry({
            ...defaultParams,
            operationType: 'replace'
        });
        expect(entry.operationType).toBe('replace');
    });

    test('should handle operationType "merge"', () => {
        const entry = new BulkInsertUpdateEntry({
            ...defaultParams,
            operationType: 'merge'
        });
        expect(entry.operationType).toBe('merge');
    });

    test('should store patches array when provided', () => {
        const patches = [
            { op: 'replace', path: '/name/0/given/0', value: 'Jane' },
            { op: 'add', path: '/telecom/-', value: { system: 'phone', value: '555-1234' } }
        ];
        const entry = new BulkInsertUpdateEntry({
            ...defaultParams,
            patches
        });
        expect(entry.patches).toEqual(patches);
        expect(entry.patches).toHaveLength(2);
    });

    test('should allow undefined patches', () => {
        const entry = new BulkInsertUpdateEntry({
            ...defaultParams,
            patches: undefined
        });
        expect(entry.patches).toBeUndefined();
    });

    test('should allow undefined skipped', () => {
        const entry = new BulkInsertUpdateEntry({
            ...defaultParams,
            skipped: undefined
        });
        expect(entry.skipped).toBeUndefined();
    });

    test('should handle update operation flags', () => {
        const entry = new BulkInsertUpdateEntry({
            ...defaultParams,
            isCreateOperation: false,
            isUpdateOperation: true
        });
        expect(entry.isCreateOperation).toBe(false);
        expect(entry.isUpdateOperation).toBe(true);
    });

    test('should store complex resource objects', () => {
        const resource = {
            id: 'obs-456',
            resourceType: 'Observation',
            status: 'final',
            code: { coding: [{ system: 'http://loinc.org', code: '12345-6' }] },
            subject: { reference: 'Patient/patient-123' }
        };
        const entry = new BulkInsertUpdateEntry({
            ...defaultParams,
            resourceType: 'Observation',
            id: 'obs-456',
            resource
        });
        expect(entry.resource).toEqual(resource);
        expect(entry.resource.code.coding[0].code).toBe('12345-6');
    });

    test('should store complex MongoDB bulk write operations', () => {
        const operation = {
            updateOne: {
                filter: { _id: 'patient-123' },
                update: { $set: { name: [{ given: ['John'] }] } },
                upsert: true
            }
        };
        const entry = new BulkInsertUpdateEntry({
            ...defaultParams,
            operation
        });
        expect(entry.operation).toEqual(operation);
    });

    test('should handle skipped as true', () => {
        const entry = new BulkInsertUpdateEntry({
            ...defaultParams,
            skipped: true
        });
        expect(entry.skipped).toBe(true);
    });
});
