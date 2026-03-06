const { describe, test, expect } = require('@jest/globals');
const { DatabaseBulkInserter } = require('./databaseBulkInserter');
const { BulkInsertUpdateEntry } = require('./bulkInsertUpdateEntry');

describe('DatabaseBulkInserter - Array Field Stripping', () => {
    test('strips member array from Group resources when ClickHouse enabled', () => {
        const mockConfigManager = {
            enableClickHouse: true,
            mongoWithClickHouseResources: ['Group']
        };

        const bulkInserter = {
            configManager: mockConfigManager,
            _handleArrayFieldStripping: DatabaseBulkInserter.prototype._handleArrayFieldStripping
        };

        const resource = {
            id: 'group-1',
            resourceType: 'Group',
            member: [
                { entity: { reference: 'Patient/1' } },
                { entity: { reference: 'Patient/2' } }
            ],
            name: 'Test Group'
        };

        const result = bulkInserter._handleArrayFieldStripping({
            resource,
            requestId: 'test-123',
            contextData: null
        });

        expect(result.member).toEqual([]);
        expect(result.name).toBe('Test Group');
        expect(result).toBe(resource);
    });

    test('does not strip arrays from non-Group resources', () => {
        const mockConfigManager = {
            enableClickHouse: true,
            mongoWithClickHouseResources: ['Group']
        };

        const bulkInserter = {
            configManager: mockConfigManager,
            _handleArrayFieldStripping: DatabaseBulkInserter.prototype._handleArrayFieldStripping
        };

        const resource = {
            id: 'patient-1',
            resourceType: 'Patient',
            name: [{ family: 'Smith' }]
        };

        const result = bulkInserter._handleArrayFieldStripping({
            resource,
            requestId: 'test-123',
            contextData: null
        });

        expect(result.name).toEqual([{ family: 'Smith' }]);
    });

    test('does not strip arrays when ClickHouse disabled', () => {
        const mockConfigManager = {
            enableClickHouse: false,
            mongoWithClickHouseResources: []
        };

        const bulkInserter = {
            configManager: mockConfigManager,
            _handleArrayFieldStripping: DatabaseBulkInserter.prototype._handleArrayFieldStripping
        };

        const resource = {
            id: 'group-2',
            resourceType: 'Group',
            member: [
                { entity: { reference: 'Patient/1' } }
            ]
        };

        const result = bulkInserter._handleArrayFieldStripping({
            resource,
            requestId: 'test-123',
            contextData: null
        });

        expect(result.member).toEqual([
            { entity: { reference: 'Patient/1' } }
        ]);
    });

    test('uses contextData when provided', () => {
        const mockConfigManager = {
            enableClickHouse: true,
            mongoWithClickHouseResources: ['Group']
        };

        const bulkInserter = {
            configManager: mockConfigManager,
            _handleArrayFieldStripping: DatabaseBulkInserter.prototype._handleArrayFieldStripping
        };

        const resource = {
            id: 'group-3',
            resourceType: 'Group',
            member: [
                { entity: { reference: 'Patient/old' } }
            ]
        };

        const contextData = {
            groupMembers: [
                { entity: { reference: 'Patient/new' } }
            ]
        };

        const result = bulkInserter._handleArrayFieldStripping({
            resource,
            requestId: 'test-123',
            contextData
        });

        expect(result.member).toEqual([]);
    });

    test('BulkInsertUpdateEntry stores contextData field', () => {
        const contextData = {
            groupMembers: [
                { entity: { reference: 'Patient/1' } },
                { entity: { reference: 'Patient/2' } }
            ],
            resourceType: 'Group',
            resourceId: 'test-1'
        };

        const entry = new BulkInsertUpdateEntry({
            id: 'test-1',
            uuid: 'uuid-1',
            sourceAssigningAuthority: 'test',
            resourceType: 'Group',
            resource: { resourceType: 'Group', id: 'test-1' },
            operation: { insertOne: { document: {} } },
            operationType: 'insert',
            patches: null,
            isCreateOperation: true,
            isUpdateOperation: false,
            contextData
        });

        expect(entry.contextData).toEqual(contextData);
        expect(entry.contextData.groupMembers).toHaveLength(2);
        expect(entry.contextData.groupMembers[0].entity.reference).toBe('Patient/1');
    });

    test('BulkInsertUpdateEntry works without contextData (backward compatibility)', () => {
        const entry = new BulkInsertUpdateEntry({
            id: 'test-1',
            uuid: 'uuid-1',
            sourceAssigningAuthority: 'test',
            resourceType: 'Patient',
            resource: { resourceType: 'Patient', id: 'test-1' },
            operation: { insertOne: { document: {} } },
            operationType: 'insert',
            patches: null,
            isCreateOperation: true,
            isUpdateOperation: false
            // contextData omitted - should work
        });

        expect(entry.contextData).toBeNull();
        expect(entry.resourceType).toBe('Patient');
        expect(entry.id).toBe('test-1');
    });
});
