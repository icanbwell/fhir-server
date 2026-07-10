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

    test('getReferenceKey with matching type identifier returns id, non-matching returns empty', () => {
        // SQL-on-FHIR passes the type specifier as a FHIRPath identifier, not a string.
        expect(
            evaluator.evaluate({
                node: patient,
                expression: 'managingOrganization.getReferenceKey(Organization)'
            })
        ).toEqual(['o1']);
        expect(
            evaluator.evaluate({
                node: patient,
                expression: 'managingOrganization.getReferenceKey(Patient)'
            })
        ).toEqual([]);
    });

    test('resolves a top-level $this to the focus (primitive and derived paths)', () => {
        expect(evaluator.evaluate({ node: 'Jane', expression: '$this' })).toEqual(['Jane']);
        expect(evaluator.evaluate({ node: 42, expression: '$this' })).toEqual([42]);
        expect(
            evaluator.evaluate({ node: { family: 'Smith' }, expression: '$this.family' })
        ).toEqual(['Smith']);
    });

    test('does not rewrite $this inside a string literal', () => {
        expect(evaluator.evaluate({ node: patient, expression: "'$this'" })).toEqual(['$this']);
    });

    test('getReferenceKey also tolerates a quoted string type specifier', () => {
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
