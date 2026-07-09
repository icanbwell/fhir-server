const { describe, test, expect } = require('@jest/globals');
const { FhirResourceCreator } = require('../../fhir/fhirResourceCreator');

describe('ViewDefinition custom resource', () => {
    const raw = {
        resourceType: 'ViewDefinition',
        id: 'v1',
        status: 'active',
        resource: 'Patient',
        select: [{ column: [{ name: 'id', path: 'getResourceKey()' }] }]
    };

    test('is created as a ViewDefinition instance', () => {
        const view = FhirResourceCreator.create(raw);
        expect(view.resourceType).toBe('ViewDefinition');
        expect(view.resource).toBe('Patient');
    });

    test('toJSON round-trips core fields', () => {
        const view = FhirResourceCreator.create(raw);
        const json = view.toJSON();
        expect(json.resourceType).toBe('ViewDefinition');
        expect(json.select[0].column[0].name).toBe('id');
    });

    test('toJSON does not mutate the instance pass-through select/where payloads', () => {
        const rawWithNulls = {
            resourceType: 'ViewDefinition',
            id: 'v2',
            status: 'active',
            resource: 'Patient',
            select: [
                {
                    column: [{ name: 'id', path: 'getResourceKey()', description: null }]
                }
            ],
            where: [{ path: 'active', tag: null }]
        };
        const view = FhirResourceCreator.create(rawWithNulls);

        const selectSnapshot = JSON.stringify(view.select);
        const whereSnapshot = JSON.stringify(view.where);

        view.toJSON();

        expect(JSON.stringify(view.select)).toBe(selectSnapshot);
        expect(JSON.stringify(view.where)).toBe(whereSnapshot);
        expect(view.select[0].column[0]).toHaveProperty('description', null);
        expect(view.where[0]).toHaveProperty('tag', null);
    });
});
