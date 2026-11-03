const { describe, test, expect } = require('@jest/globals');
const { buildBundleEntry } = require('../../../utils/bundleEntryBuilder');
const BundleEntry = require('../../../fhir/classes/4_0_0/backbone_elements/bundleEntry');
const BundleRequest = require('../../../fhir/classes/4_0_0/backbone_elements/bundleRequest');

describe('buildBundleEntry', () => {
    test('serializes a delete entry the same as the legacy BundleEntry class', () => {
        const entry = {
            id: 'p1',
            resource: { resourceType: 'Person', id: 'p1' },
            request: { id: 'req-1', method: 'DELETE', url: '/4_0_0/Person/p1' }
        };

        const result = buildBundleEntry(structuredClone(entry));

        expect(JSON.stringify(result)).toStrictEqual(
            JSON.stringify(
                new BundleEntry({
                    id: 'p1',
                    resource: { resourceType: 'Person', id: 'p1' },
                    request: new BundleRequest({ id: 'req-1', method: 'DELETE', url: '/4_0_0/Person/p1' })
                })
            )
        );
    });

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
