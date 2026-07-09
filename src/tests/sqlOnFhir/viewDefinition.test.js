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
});
