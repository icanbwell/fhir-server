'use strict';

const { describe, test, expect } = require('@jest/globals');
const { FhirResourceSerializer } = require('../../../../fhir/fhirResourceSerializer');

/**
 * `recorded` is an internal field on history documents (used for ClickHouse dedup/ordering).
 * HistoryOperation ends with FhirResourceSerializer.serializeByResourceType(bundle, 'Bundle'),
 * which must not expose it in the _history response.
 */
function buildHistoryBundle(entryOverrides) {
    return {
        resourceType: 'Bundle',
        type: 'history',
        entry: [
            {
                id: 'uuid-1',
                resource: {
                    resourceType: 'Patient',
                    id: 'p1',
                    _uuid: 'uuid-1',
                    meta: { versionId: '1', lastUpdated: '2026-10-28T08:30:15.123Z' }
                },
                request: { method: 'POST', url: '/4_0_0/Patient/p1' },
                ...entryOverrides
            }
        ]
    };
}

describe('_history response and recorded field', () => {
    test.each([
        ['a new row with recorded', { recorded: new Date('2026-10-28T08:30:15.123Z') }],
        ['an old row without recorded', {}]
    ])('does not expose recorded for %s and keeps the entry intact', (_name, overrides) => {
        const bundle = buildHistoryBundle(overrides);

        FhirResourceSerializer.serializeByResourceType(bundle, 'Bundle');

        const entry = bundle.entry[0];
        expect(entry).not.toHaveProperty('recorded');
        expect(entry.id).toBe('uuid-1');
        expect(entry.resource.id).toBe('p1');
        expect(entry.request.method).toBe('POST');
    });
});
