const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

// Mock dependencies before requiring the module under test
jestObj.mock('../../../../utils/assertType', () => ({
    assertTypeEquals: jestObj.fn(),
    assertIsValid: jestObj.fn()
}));

jestObj.mock('../../../../utils/referenceParser', () => ({
    ReferenceParser: {
        parseReference: jestObj.fn()
    }
}));

jestObj.mock('../../../../utils/nullRemover', () => ({
    removeNull: jestObj.fn((obj) => {
        // Simple implementation that removes null/undefined values
        if (!obj || typeof obj !== 'object') return obj;
        const result = {};
        for (const [key, value] of Object.entries(obj)) {
            if (value !== null && value !== undefined) {
                result[key] = value;
            }
        }
        return result;
    })
}));

const { ParsedArgsItem } = require('../../../../operations/query/parsedArgsItem');
const { QueryParameterValue } = require('../../../../operations/query/queryParameterValue');
const { SearchParameterDefinition } = require('../../../../searchParameters/searchParameterTypes');
const { ReferenceParser } = require('../../../../utils/referenceParser');
const { ParsedReferenceItem } = require('../../../../operations/query/parsedReferenceItem');

describe('ParsedArgsItem', () => {
    beforeEach(() => {
        jestObj.clearAllMocks();
        // Default: parseReference returns no resourceType (bare id)
        ReferenceParser.parseReference.mockImplementation((val) => {
            if (val.includes('/')) {
                const parts = val.split('/');
                const idParts = parts[1].split('|');
                return {
                    resourceType: parts[0],
                    id: idParts[0],
                    sourceAssigningAuthority: idParts.length > 1 ? idParts[1] : undefined
                };
            }
            const idParts = val.split('|');
            return {
                resourceType: undefined,
                id: idParts[0],
                sourceAssigningAuthority: idParts.length > 1 ? idParts[1] : undefined
            };
        });
    });

    /**
     * Helper to create a ParsedArgsItem with sensible defaults
     */
    function createParsedArgsItem({
        queryParameter = 'subject',
        value = '123',
        operator = '$and',
        target = ['Patient'],
        modifiers = [],
        references = undefined,
        patientToPersonMap = undefined
    } = {}) {
        const queryParameterValue = new QueryParameterValue({ value, operator });
        const propertyObj = new SearchParameterDefinition({
            type: 'reference',
            field: 'subject',
            target
        });
        return new ParsedArgsItem({
            queryParameter,
            queryParameterValue,
            propertyObj,
            modifiers,
            references,
            patientToPersonMap
        });
    }

    describe('constructor', () => {
        test('stores all provided properties correctly', () => {
            const item = createParsedArgsItem({
                queryParameter: 'patient',
                value: 'Patient/123',
                target: ['Patient', 'Practitioner'],
                modifiers: []
            });

            expect(item.queryParameter).toBe('patient');
            expect(item.queryParameterValue).toBeInstanceOf(QueryParameterValue);
            expect(item.propertyObj).toBeInstanceOf(SearchParameterDefinition);
            expect(item.modifiers).toEqual([]);
        });

        test('calls applyModifierToQueryParameterValue when modifiers have entries', () => {
            const item = createParsedArgsItem({
                value: '123',
                target: ['Patient', 'Practitioner'],
                modifiers: ['Patient']
            });

            // After applying modifier, the value should be "Patient/123"
            expect(item.queryParameterValue.value).toBe('Patient/123');
        });

        test('calls updateReferences when references parameter is not provided', () => {
            const item = createParsedArgsItem({ value: 'Patient/456' });

            // references should be populated via parseQueryParameterValueIntoReferences
            expect(item.references).toBeDefined();
            expect(Array.isArray(item.references)).toBe(true);
        });

        test('uses provided references instead of calculating them', () => {
            const providedReferences = [
                new ParsedReferenceItem({ resourceType: 'Patient', id: '999' })
            ];
            const item = createParsedArgsItem({
                value: 'Patient/123',
                references: providedReferences
            });

            expect(item.references).toBe(providedReferences);
            expect(item.references[0].id).toBe('999');
        });

        test('stores patientToPersonMap when provided', () => {
            const map = { 'patient-1': 'person-1' };
            const item = createParsedArgsItem({ patientToPersonMap: map });

            expect(item.patientToPersonMap).toEqual(map);
        });
    });

    describe('applyModifierToQueryParameterValue', () => {
        test('prepends resourceType to bare IDs when modifier matches a target', () => {
            const item = createParsedArgsItem({
                value: '123,456',
                target: ['Patient', 'Practitioner'],
                modifiers: ['Patient']
            });

            // '123' and '456' should both get 'Patient/' prepended
            expect(item.queryParameterValue.value).toContain('Patient/123');
            expect(item.queryParameterValue.value).toContain('Patient/456');
        });

        test('does NOT prepend resourceType to values already containing a slash', () => {
            const item = createParsedArgsItem({
                value: 'Practitioner/789,123',
                target: ['Patient', 'Practitioner'],
                modifiers: ['Patient']
            });

            // 'Practitioner/789' should remain unchanged, '123' gets 'Patient/' prepended
            const resultValue = item.queryParameterValue.value;
            expect(resultValue).toContain('Practitioner/789');
            expect(resultValue).toContain('Patient/123');
            // Should NOT double-prefix
            expect(resultValue).not.toContain('Patient/Practitioner/789');
        });

        test('does nothing when modifier does not match any target', () => {
            const qpv = new QueryParameterValue({ value: '123' });
            const propertyObj = new SearchParameterDefinition({
                type: 'reference',
                field: 'subject',
                target: ['Patient']
            });

            const item = new ParsedArgsItem({
                queryParameter: 'subject',
                queryParameterValue: qpv,
                propertyObj,
                modifiers: ['Organization'], // Not in target
                references: undefined,
                patientToPersonMap: undefined
            });

            // Value should remain unchanged since Organization is not in target
            expect(item.queryParameterValue.value).toBe('123');
        });

        test('does nothing when propertyObj is undefined', () => {
            const qpv = new QueryParameterValue({ value: '123' });

            const item = new ParsedArgsItem({
                queryParameter: 'subject',
                queryParameterValue: qpv,
                propertyObj: undefined,
                modifiers: ['Patient'],
                references: undefined,
                patientToPersonMap: undefined
            });

            expect(item.queryParameterValue.value).toBe('123');
        });

        test('does nothing when propertyObj has no target', () => {
            const qpv = new QueryParameterValue({ value: '123' });
            const propertyObj = new SearchParameterDefinition({
                type: 'reference',
                field: 'subject',
                target: undefined
            });

            const item = new ParsedArgsItem({
                queryParameter: 'subject',
                queryParameterValue: qpv,
                propertyObj,
                modifiers: ['Patient'],
                references: undefined,
                patientToPersonMap: undefined
            });

            expect(item.queryParameterValue.value).toBe('123');
        });

        test('handles multiple modifiers matching multiple targets', () => {
            const item = createParsedArgsItem({
                value: '100,200',
                target: ['Patient', 'Practitioner'],
                modifiers: ['Patient', 'Practitioner']
            });

            // Both modifiers match targets, so each value gets expanded for each modifier
            const resultValue = item.queryParameterValue.value;
            expect(resultValue).toContain('Patient/100');
            expect(resultValue).toContain('Patient/200');
            expect(resultValue).toContain('Practitioner/100');
            expect(resultValue).toContain('Practitioner/200');
        });
    });

    describe('queryParameterValue setter', () => {
        test('setting queryParameterValue recalculates references', () => {
            const item = createParsedArgsItem({
                value: 'Patient/123',
                target: ['Patient']
            });

            const initialReferences = item.references;

            // Set a new value
            const newQPV = new QueryParameterValue({ value: 'Patient/456' });
            item.queryParameterValue = newQPV;

            // References should be recalculated
            expect(item.references).not.toBe(initialReferences);
            expect(item.references.length).toBeGreaterThan(0);
            expect(item.references[0].id).toBe('456');
            expect(item.references[0].resourceType).toBe('Patient');
        });
    });

    describe('parseQueryParameterValueIntoReferences', () => {
        test('returns empty array when propertyObj is undefined', () => {
            const item = createParsedArgsItem({ value: 'Patient/123' });
            const qpv = new QueryParameterValue({ value: 'Patient/123' });

            const result = item.parseQueryParameterValueIntoReferences({
                queryParameterValue: qpv,
                propertyObj: undefined
            });

            expect(result).toEqual([]);
        });

        test('returns empty array when propertyObj has no target', () => {
            const item = createParsedArgsItem({ value: 'Patient/123' });
            const qpv = new QueryParameterValue({ value: 'Patient/123' });
            const propertyObj = new SearchParameterDefinition({
                type: 'reference',
                field: 'subject',
                target: undefined
            });

            const result = item.parseQueryParameterValueIntoReferences({
                queryParameterValue: qpv,
                propertyObj
            });

            expect(result).toEqual([]);
        });

        test('parses "Patient/123" into {resourceType: Patient, id: 123}', () => {
            const item = createParsedArgsItem({ value: 'Patient/123', target: ['Patient'] });

            // References are already parsed during construction
            expect(item.references.length).toBe(1);
            expect(item.references[0].resourceType).toBe('Patient');
            expect(item.references[0].id).toBe('123');
        });

        test('when value has no resourceType, expands to all targets', () => {
            // ReferenceParser.parseReference for '123' returns no resourceType
            const item = createParsedArgsItem({
                value: '123',
                target: ['Patient', 'Practitioner', 'Organization']
            });

            // Should expand bare id '123' across all 3 targets
            expect(item.references.length).toBe(3);
            expect(item.references[0].resourceType).toBe('Patient');
            expect(item.references[0].id).toBe('123');
            expect(item.references[1].resourceType).toBe('Practitioner');
            expect(item.references[1].id).toBe('123');
            expect(item.references[2].resourceType).toBe('Organization');
            expect(item.references[2].id).toBe('123');
        });

        test('handles multiple comma-separated values with mixed formats', () => {
            const item = createParsedArgsItem({
                value: 'Patient/100,200',
                target: ['Patient', 'Practitioner']
            });

            // 'Patient/100' -> { resourceType: Patient, id: 100 }
            // '200' -> expanded to all targets: Patient/200, Practitioner/200
            expect(item.references.length).toBe(3);
            expect(item.references[0].resourceType).toBe('Patient');
            expect(item.references[0].id).toBe('100');
            expect(item.references[1].resourceType).toBe('Patient');
            expect(item.references[1].id).toBe('200');
            expect(item.references[2].resourceType).toBe('Practitioner');
            expect(item.references[2].id).toBe('200');
        });

        test('handles sourceAssigningAuthority in reference values', () => {
            const item = createParsedArgsItem({
                value: 'Patient/123|client-1',
                target: ['Patient']
            });

            expect(item.references.length).toBe(1);
            expect(item.references[0].resourceType).toBe('Patient');
            expect(item.references[0].id).toBe('123');
            expect(item.references[0].sourceAssigningAuthority).toBe('client-1');
        });

        test('handles sourceAssigningAuthority in bare id values', () => {
            const item = createParsedArgsItem({
                value: '123|client-1',
                target: ['Patient']
            });

            expect(item.references.length).toBe(1);
            expect(item.references[0].resourceType).toBe('Patient');
            expect(item.references[0].id).toBe('123');
            expect(item.references[0].sourceAssigningAuthority).toBe('client-1');
        });
    });

    describe('clone', () => {
        test('creates a deep copy with independent queryParameterValue', () => {
            const item = createParsedArgsItem({
                value: 'Patient/123',
                target: ['Patient']
            });

            const cloned = item.clone();

            // Should be a different instance
            expect(cloned).not.toBe(item);
            expect(cloned.queryParameterValue).not.toBe(item.queryParameterValue);
        });

        test('mutations to clone do not propagate to original', () => {
            const item = createParsedArgsItem({
                value: 'Patient/123',
                target: ['Patient'],
                patientToPersonMap: { p1: 'person-1' }
            });

            const cloned = item.clone();
            cloned.queryParameter = 'modified';
            cloned.patientToPersonMap['p2'] = 'person-2';

            expect(item.queryParameter).toBe('subject');
            expect(item.patientToPersonMap).not.toHaveProperty('p2');
        });

        test('clone preserves all fields correctly', () => {
            const item = createParsedArgsItem({
                queryParameter: 'actor',
                value: 'Practitioner/doc-1',
                target: ['Practitioner'],
                modifiers: []
            });

            const cloned = item.clone();

            expect(cloned.queryParameter).toBe('actor');
            expect(cloned.propertyObj).not.toBe(item.propertyObj);
            expect(cloned.propertyObj.target).toEqual(['Practitioner']);
        });

        test('clone handles undefined propertyObj', () => {
            const qpv = new QueryParameterValue({ value: '123' });

            const item = new ParsedArgsItem({
                queryParameter: 'test',
                queryParameterValue: qpv,
                propertyObj: undefined,
                modifiers: [],
                references: [],
                patientToPersonMap: undefined
            });

            const cloned = item.clone();
            expect(cloned.propertyObj).toBeUndefined();
        });
    });

    describe('toJSON', () => {
        test('returns object with all populated fields', () => {
            const item = createParsedArgsItem({
                queryParameter: 'subject',
                value: 'Patient/123',
                target: ['Patient'],
                modifiers: []
            });

            const json = item.toJSON();

            expect(json).toHaveProperty('queryParameter', 'subject');
            expect(json).toHaveProperty('queryParameterValue');
            expect(json).toHaveProperty('modifiers');
        });

        test('removes null values from output', () => {
            const qpv = new QueryParameterValue({ value: '123' });

            const item = new ParsedArgsItem({
                queryParameter: 'test',
                queryParameterValue: qpv,
                propertyObj: undefined,
                modifiers: [],
                references: undefined,
                patientToPersonMap: undefined
            });

            const json = item.toJSON();

            // removeNull should strip undefined/null values
            expect(json).not.toHaveProperty('propertyObj');
            expect(json).not.toHaveProperty('patientToPersonMap');
        });
    });

    describe('empty modifiers array', () => {
        test('does not invoke applyModifierToQueryParameterValue logic', () => {
            const item = createParsedArgsItem({
                value: '123',
                target: ['Patient'],
                modifiers: []
            });

            // Value stays as-is, no resourceType prefix added
            expect(item.queryParameterValue.value).toBe('123');
        });
    });
});
