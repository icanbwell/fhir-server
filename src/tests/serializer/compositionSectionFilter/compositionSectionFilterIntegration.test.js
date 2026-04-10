const deepcopy = require('deepcopy');
const { FhirResourceSerializer } = require('../../../fhir/fhirResourceSerializer.js');
const { commonBeforeEach, commonAfterEach, createTestRequest } = require('../../common.js');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { AUTH_USER_TYPES } = require('../../../constants');

const SENSITIVE_SYSTEM = 'https://www.icanbwell.com/sensitivity-category';
const delegatedContext = { userType: AUTH_USER_TYPES.delegatedUser };

/**
 * Minimal Composition with a mix of normal and sensitive sections,
 * including nested sensitive children.
 */
const compositionWithSensitiveSections = {
    resourceType: 'Composition',
    id: 'test-composition-1',
    status: 'final',
    type: {
        coding: [{ system: 'http://loinc.org', code: '11503-0' }]
    },
    date: '2025-01-01',
    title: 'Test Composition',
    author: [{ reference: 'Practitioner/1' }],
    section: [
        {
            id: 'normal-1',
            title: 'Normal Section',
            code: {
                coding: [{ system: 'http://loinc.org', code: '12345-6' }]
            },
            section: [
                {
                    id: 'nested-normal',
                    title: 'Nested Normal',
                    code: {
                        coding: [{ system: 'http://loinc.org', code: '11111-1' }]
                    }
                },
                {
                    id: 'nested-sensitive',
                    title: 'Nested Sensitive',
                    code: {
                        coding: [{ system: SENSITIVE_SYSTEM, code: 'mental-health' }]
                    }
                }
            ]
        },
        {
            id: 'sensitive-1',
            title: 'Sensitive Top Level',
            code: {
                coding: [{ system: SENSITIVE_SYSTEM, code: 'substance-abuse' }]
            }
        },
        {
            id: 'normal-2',
            title: 'Another Normal Section',
            code: {
                coding: [{ system: 'http://loinc.org', code: '67890-1' }]
            }
        }
    ]
};

describe('Composition Section Filter Integration Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
        delete process.env.ENABLE_COMPOSITION_SENSITIVE_SECTION_FILTERING;
    });

    test('FhirResourceSerializer filters sensitive sections when flag is enabled', async () => {
        process.env.ENABLE_COMPOSITION_SENSITIVE_SECTION_FILTERING = 'true';
        await createTestRequest();

        const result = FhirResourceSerializer.serialize(deepcopy(compositionWithSensitiveSections), null, delegatedContext);

        // Top-level: 'sensitive-1' removed, 2 remain
        expect(result.section).toHaveLength(2);
        expect(result.section[0].title).toBe('Normal Section');
        expect(result.section[1].title).toBe('Another Normal Section');

        // Nested: 'nested-sensitive' removed from first section's children
        expect(result.section[0].section).toHaveLength(1);
        expect(result.section[0].section[0].title).toBe('Nested Normal');
    });

    test('FhirResourceSerializer preserves all sections when flag is disabled', async () => {
        process.env.ENABLE_COMPOSITION_SENSITIVE_SECTION_FILTERING = 'false';
        await createTestRequest();

        const result = FhirResourceSerializer.serialize(deepcopy(compositionWithSensitiveSections));

        // All 3 top-level sections preserved
        expect(result.section).toHaveLength(3);
        // All 2 nested sections preserved
        expect(result.section[0].section).toHaveLength(2);
    });

    test('FhirResourceSerializer preserves all sections when flag is not set', async () => {
        await createTestRequest();

        const result = FhirResourceSerializer.serialize(deepcopy(compositionWithSensitiveSections));

        expect(result.section).toHaveLength(3);
        expect(result.section[0].section).toHaveLength(2);
    });

    test('non-Composition resources are unaffected by section filtering', async () => {
        process.env.ENABLE_COMPOSITION_SENSITIVE_SECTION_FILTERING = 'true';
        await createTestRequest();

        const patient = {
            resourceType: 'Patient',
            id: 'test-patient-1',
            active: true,
            name: [{ family: 'Test', given: ['John'] }]
        };

        const result = FhirResourceSerializer.serialize(deepcopy(patient));

        expect(result.resourceType).toBe('Patient');
        expect(result.id).toBe('test-patient-1');
        expect(result.active).toBe(true);
    });

    test('Composition with no sections serializes normally when flag is enabled', async () => {
        process.env.ENABLE_COMPOSITION_SENSITIVE_SECTION_FILTERING = 'true';
        await createTestRequest();

        const composition = {
            resourceType: 'Composition',
            id: 'no-sections',
            status: 'final',
            type: {
                coding: [{ system: 'http://loinc.org', code: '11503-0' }]
            },
            date: '2025-01-01',
            title: 'Empty Composition',
            author: [{ reference: 'Practitioner/1' }]
        };

        const result = FhirResourceSerializer.serialize(deepcopy(composition));

        expect(result.resourceType).toBe('Composition');
        expect(result.id).toBe('no-sections');
        expect(result.section).toBeUndefined();
    });

    test('Composition with all sensitive sections has empty section array when flag is enabled', async () => {
        process.env.ENABLE_COMPOSITION_SENSITIVE_SECTION_FILTERING = 'true';
        await createTestRequest();

        const composition = {
            resourceType: 'Composition',
            id: 'all-sensitive',
            status: 'final',
            type: {
                coding: [{ system: 'http://loinc.org', code: '11503-0' }]
            },
            date: '2025-01-01',
            title: 'All Sensitive',
            author: [{ reference: 'Practitioner/1' }],
            section: [
                {
                    id: 's1',
                    title: 'Sensitive A',
                    code: { coding: [{ system: SENSITIVE_SYSTEM, code: 'a' }] }
                },
                {
                    id: 's2',
                    title: 'Sensitive B',
                    code: { coding: [{ system: SENSITIVE_SYSTEM, code: 'b' }] }
                }
            ]
        };

        const result = FhirResourceSerializer.serialize(deepcopy(composition), null, delegatedContext);

        // All sections removed — empty array remains (serializer keeps empty arrays)
        expect(result.section).toEqual([]);
    });

    test('existing composition serialization still works (backward compatibility)', async () => {
        await createTestRequest();

        const existingComposition = require('../bundle/fixtures/resources/composition.json');
        const expectedComposition = require('../bundle/fixtures/expected/expectedComposition.json');

        const result = FhirResourceSerializer.serialize(deepcopy(existingComposition));
        expect(result).toStrictEqual(expectedComposition);
    });
});
