const { describe, test, expect } = require('@jest/globals');
const { FhirPathEvaluator } = require('../../utils/fhirPathEvaluator');

describe('FhirPathEvaluator', () => {
    const evaluator = new FhirPathEvaluator();
    const patient = {
        resourceType: 'Patient',
        id: 'p1',
        name: [{ use: 'official', family: 'Smith', given: ['Jane'] }],
        managingOrganization: { reference: 'Organization/o1' }
    };

    test('evaluates a simple path to a scalar array', () => {
        expect(evaluator.evaluate({ node: patient, expression: 'name.family' })).toEqual(['Smith']);
    });

    test('returns empty array when path yields nothing', () => {
        expect(evaluator.evaluate({ node: patient, expression: 'birthDate' })).toEqual([]);
    });

    test('binds constants as %variables', () => {
        expect(
            evaluator.evaluate({
                node: patient,
                expression: 'name.where(use = %u).family',
                variables: { u: 'official' }
            })
        ).toEqual(['Smith']);
    });

    test('getResourceKey returns the resource id', () => {
        expect(evaluator.evaluate({ node: patient, expression: 'getResourceKey()' })).toEqual([
            'p1'
        ]);
    });

    test('getReferenceKey extracts the id from a reference', () => {
        expect(
            evaluator.evaluate({
                node: patient,
                expression: 'managingOrganization.getReferenceKey()'
            })
        ).toEqual(['o1']);
    });

    test('getReferenceKey with matching type returns id, non-matching returns empty', () => {
        expect(
            evaluator.evaluate({
                node: patient,
                expression: "managingOrganization.getReferenceKey('Organization')"
            })
        ).toEqual(['o1']);
        expect(
            evaluator.evaluate({
                node: patient,
                expression: "managingOrganization.getReferenceKey('Patient')"
            })
        ).toEqual([]);
    });
});
