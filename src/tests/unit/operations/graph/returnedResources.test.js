const { describe, test, expect, beforeEach } = require('@jest/globals');

const { ReturnedResources } = require('../../../../operations/graph/returnedResources');

describe('ReturnedResources', () => {
    let returnedResources;

    beforeEach(() => {
        returnedResources = new ReturnedResources();
    });

    test('records a returned resource with its type and internal id', () => {
        returnedResources.add({ resourceType: 'Patient', _uuid: 'p1' });

        expect(returnedResources.resources).toEqual([{ resourceType: 'Patient', _uuid: 'p1' }]);
    });

    test('records the related resources the graph attached, and only those', () => {
        returnedResources.add(
            {
                resourceType: 'Claim',
                _uuid: 'c1',
                contained: [{ resourceType: 'Practitioner', _uuid: 'planted-uuid' }]
            },
            [{ resourceType: 'Practitioner', _uuid: 'pr1' }]
        );

        expect(returnedResources.resources).toEqual([
            { resourceType: 'Claim', _uuid: 'c1' },
            { resourceType: 'Practitioner', _uuid: 'pr1' }
        ]);
    });

    test('skips a resource that has no internal id', () => {
        returnedResources.add({ resourceType: 'Medication', id: 'med1' });

        expect(returnedResources.resources).toEqual([]);
    });

    test('uses the id noted earlier when writing has stripped it from the resource', () => {
        const shared = { resourceType: 'Practitioner', _uuid: 'pr1' };
        returnedResources.remember(shared);
        delete shared._uuid;

        returnedResources.add({ resourceType: 'Patient', _uuid: 'p1' }, [shared]);

        expect(returnedResources.resources).toEqual([
            { resourceType: 'Patient', _uuid: 'p1' },
            { resourceType: 'Practitioner', _uuid: 'pr1' }
        ]);
    });

    test('records a very large attached list without throwing', () => {
        const attached = Array.from({ length: 300000 }, (_, i) => ({
            resourceType: 'Observation',
            _uuid: `o${i}`
        }));

        returnedResources.add({ resourceType: 'Patient', _uuid: 'p1' }, attached);

        expect(returnedResources.resources).toHaveLength(300001);
    });
});
