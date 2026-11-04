const { describe, test, expect } = require('@jest/globals');
const { buildBundleEntry } = require('../../../utils/bundleEntryBuilder');

describe('buildBundleEntry', () => {
    test('drops fields that are not part of a bundle entry or its request', () => {
        const result = buildBundleEntry({
            id: 'p1',
            notAFhirField: 'x',
            resource: { resourceType: 'Person', id: 'p1', notAFhirField: 'x' },
            request: { id: 'req-1', method: 'DELETE', url: '/4_0_0/Person/p1', notAFhirField: 'x' }
        });

        expect(result).toStrictEqual({
            id: 'p1',
            resource: { resourceType: 'Person', id: 'p1' },
            request: { id: 'req-1', method: 'DELETE', url: '/4_0_0/Person/p1' }
        });
    });

    test('serializes an OperationOutcome resource inside an entry', () => {
        const result = buildBundleEntry({
            resource: {
                resourceType: 'OperationOutcome',
                issue: [{ severity: 'error', code: 'exception', notAFhirField: 'x' }]
            }
        });

        expect(result).toStrictEqual({
            resource: { resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'exception' }] }
        });
    });
});
