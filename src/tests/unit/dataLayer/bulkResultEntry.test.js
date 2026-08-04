const { describe, test, expect } = require('@jest/globals');
const { BulkResultEntry } = require('../../../dataLayer/bulkResultEntry');

describe('BulkResultEntry', () => {
    test('should construct with all properties set', () => {
        const mergeResult = {
            insertedCount: 2,
            matchedCount: 1,
            modifiedCount: 1,
            deletedCount: 0,
            upsertedCount: 0
        };
        const mergeResultEntries = [
            { id: 'patient-1', created: true },
            { id: 'patient-2', created: true },
            { id: 'patient-3', created: false }
        ];

        const entry = new BulkResultEntry({
            resourceType: 'Patient',
            mergeResult,
            mergeResultEntries,
            error: null
        });

        expect(entry.resourceType).toBe('Patient');
        expect(entry.mergeResult).toEqual(mergeResult);
        expect(entry.mergeResultEntries).toEqual(mergeResultEntries);
        expect(entry.error).toBeNull();
    });

    test('should store an error when bulk write fails', () => {
        const error = new Error('BulkWriteError: duplicate key');

        const entry = new BulkResultEntry({
            resourceType: 'Observation',
            mergeResult: null,
            mergeResultEntries: null,
            error
        });

        expect(entry.resourceType).toBe('Observation');
        expect(entry.mergeResult).toBeNull();
        expect(entry.mergeResultEntries).toBeNull();
        expect(entry.error).toBeInstanceOf(Error);
        expect(entry.error.message).toBe('BulkWriteError: duplicate key');
    });

    test('should handle empty mergeResultEntries array', () => {
        const entry = new BulkResultEntry({
            resourceType: 'Condition',
            mergeResult: {
                insertedCount: 0,
                matchedCount: 0,
                modifiedCount: 0,
                deletedCount: 0,
                upsertedCount: 0
            },
            mergeResultEntries: [],
            error: null
        });

        expect(entry.mergeResultEntries).toEqual([]);
        expect(entry.mergeResultEntries).toHaveLength(0);
    });

    test('should handle different resource types', () => {
        const resourceTypes = ['Patient', 'Observation', 'Condition', 'MedicationRequest', 'AuditEvent'];

        resourceTypes.forEach(resourceType => {
            const entry = new BulkResultEntry({
                resourceType,
                mergeResult: null,
                mergeResultEntries: null,
                error: null
            });
            expect(entry.resourceType).toBe(resourceType);
        });
    });

    test('should store mergeResult with upsert information', () => {
        const mergeResult = {
            insertedCount: 0,
            matchedCount: 0,
            modifiedCount: 0,
            deletedCount: 0,
            upsertedCount: 3,
            upsertedIds: { 0: 'id-1', 1: 'id-2', 2: 'id-3' }
        };

        const entry = new BulkResultEntry({
            resourceType: 'Encounter',
            mergeResult,
            mergeResultEntries: [],
            error: null
        });

        expect(entry.mergeResult.upsertedCount).toBe(3);
        expect(entry.mergeResult.upsertedIds).toEqual({ 0: 'id-1', 1: 'id-2', 2: 'id-3' });
    });

    test('should preserve error stack trace', () => {
        const error = new Error('Connection timeout');

        const entry = new BulkResultEntry({
            resourceType: 'Patient',
            mergeResult: null,
            mergeResultEntries: null,
            error
        });

        expect(entry.error.stack).toBeDefined();
        expect(entry.error.stack).toContain('Connection timeout');
    });
});
