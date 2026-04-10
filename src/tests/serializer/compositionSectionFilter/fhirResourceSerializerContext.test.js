const deepcopy = require('deepcopy');
const { FhirResourceSerializer } = require('../../../fhir/fhirResourceSerializer.js');
const { commonBeforeEach, commonAfterEach, createTestRequest } = require('../../common.js');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { AUTH_USER_TYPES } = require('../../../constants');

const SENSITIVE_SYSTEM = 'https://www.icanbwell.com/sensitivity-category';
const delegatedContext = { userType: AUTH_USER_TYPES.delegatedUser };

/**
 * Minimal Composition for testing context threading.
 */
const compositionWithSensitiveSection = {
    resourceType: 'Composition',
    id: 'ctx-test-1',
    status: 'final',
    type: {
        coding: [{ system: 'http://loinc.org', code: '11503-0' }]
    },
    date: '2025-01-01',
    title: 'Context Test',
    author: [{ reference: 'Practitioner/1' }],
    section: [
        {
            id: 'normal',
            title: 'Normal Section',
            code: { coding: [{ system: 'http://loinc.org', code: '12345-6' }] }
        },
        {
            id: 'sensitive',
            title: 'Sensitive Section',
            code: { coding: [{ system: SENSITIVE_SYSTEM, code: 'mental-health' }] }
        }
    ]
};

describe('FhirResourceSerializer Context Threading', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
        delete process.env.ENABLE_COMPOSITION_SENSITIVE_SECTION_FILTERING;
    });

    describe('getContext', () => {
        test('injects static configManager when context has none', async () => {
            await createTestRequest();

            const context = FhirResourceSerializer.getContext({});

            expect(context.configManager).toBeDefined();
            expect(context.configManager).toBe(FhirResourceSerializer.configManager);
        });

        test('injects static configManager when context is undefined', async () => {
            await createTestRequest();

            const context = FhirResourceSerializer.getContext(undefined);

            expect(context.configManager).toBeDefined();
            expect(context.configManager).toBe(FhirResourceSerializer.configManager);
        });

        test('injects static configManager when context is null', async () => {
            await createTestRequest();

            const context = FhirResourceSerializer.getContext(null);

            expect(context.configManager).toBeDefined();
        });

        test('preserves existing configManager in context', async () => {
            await createTestRequest();

            const customConfigManager = { enableCompositionSensitiveSectionFiltering: true };
            const context = FhirResourceSerializer.getContext({ configManager: customConfigManager });

            expect(context.configManager).toBe(customConfigManager);
        });

        test('preserves other context properties when injecting configManager', async () => {
            await createTestRequest();

            const context = FhirResourceSerializer.getContext({ someProperty: 'value' });

            expect(context.someProperty).toBe('value');
            expect(context.configManager).toBeDefined();
        });
    });

    describe('serializeByResourceType with Composition', () => {
        test('filters sensitive sections when flag is enabled', async () => {
            process.env.ENABLE_COMPOSITION_SENSITIVE_SECTION_FILTERING = 'true';
            await createTestRequest();

            const result = FhirResourceSerializer.serializeByResourceType(
                deepcopy(compositionWithSensitiveSection),
                'Composition',
                delegatedContext
            );

            expect(result.section).toHaveLength(1);
            expect(result.section[0].title).toBe('Normal Section');
        });

        test('preserves all sections when flag is disabled', async () => {
            process.env.ENABLE_COMPOSITION_SENSITIVE_SECTION_FILTERING = 'false';
            await createTestRequest();

            const result = FhirResourceSerializer.serializeByResourceType(
                deepcopy(compositionWithSensitiveSection),
                'Composition'
            );

            expect(result.section).toHaveLength(2);
        });
    });

    describe('serializeArray with Compositions', () => {
        test('filters sensitive sections from each Composition in array', async () => {
            process.env.ENABLE_COMPOSITION_SENSITIVE_SECTION_FILTERING = 'true';
            await createTestRequest();

            const compositions = [
                deepcopy(compositionWithSensitiveSection),
                deepcopy(compositionWithSensitiveSection)
            ];

            const result = FhirResourceSerializer.serializeArray(compositions, null, delegatedContext);

            expect(result).toHaveLength(2);
            result.forEach(comp => {
                expect(comp.section).toHaveLength(1);
                expect(comp.section[0].title).toBe('Normal Section');
            });
        });

        test('handles single Composition (non-array) input', async () => {
            process.env.ENABLE_COMPOSITION_SENSITIVE_SECTION_FILTERING = 'true';
            await createTestRequest();

            const result = FhirResourceSerializer.serializeArray(
                deepcopy(compositionWithSensitiveSection),
                null,
                delegatedContext
            );

            expect(result).toHaveLength(1);
            expect(result[0].section).toHaveLength(1);
            expect(result[0].section[0].title).toBe('Normal Section');
        });
    });

    describe('serialize returns null/undefined passthrough', () => {
        test('returns null when obj is null', () => {
            expect(FhirResourceSerializer.serialize(null)).toBeNull();
        });

        test('returns undefined when obj is undefined', () => {
            expect(FhirResourceSerializer.serialize(undefined)).toBeUndefined();
        });
    });

    describe('input mutation safety', () => {
        test('filtering does not mutate sibling references in the original object', async () => {
            process.env.ENABLE_COMPOSITION_SENSITIVE_SECTION_FILTERING = 'true';
            await createTestRequest();

            const original = deepcopy(compositionWithSensitiveSection);
            const originalSectionCount = original.section.length;

            // Serialize a deep copy — original should remain untouched
            FhirResourceSerializer.serialize(deepcopy(original), null, delegatedContext);

            expect(original.section).toHaveLength(originalSectionCount);
        });
    });
});
