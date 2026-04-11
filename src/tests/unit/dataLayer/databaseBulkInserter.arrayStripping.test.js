const { describe, test, expect } = require('@jest/globals');
const { BulkInsertUpdateEntry } = require('../../../dataLayer/bulkInsertUpdateEntry');

describe('DatabaseBulkInserter - BulkInsertUpdateEntry', () => {
    test('stores contextData field', () => {
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

    test('works without contextData (backward compatibility)', () => {
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
        });

        expect(entry.contextData).toBeNull();
        expect(entry.resourceType).toBe('Patient');
        expect(entry.id).toBe('test-1');
    });
});
