const { describe, test, expect } = require('@jest/globals');
const {
    filterCompositionSections,
    filterCompositionSensitiveSections
} = require('../../../fhir/serializers/4_0_0/custom_utils/compositionSectionFilter');
const { SENSITIVE_CATEGORY, AUTH_USER_TYPES } = require('../../../constants');

const SENSITIVE_SYSTEM = SENSITIVE_CATEGORY.SYSTEM;

/**
 * Helper: build a section with a single coding.
 */
function makeSection(title, system, code, nestedSections) {
    const section = { title };
    if (system || code) {
        section.code = { coding: [{ system, code }] };
    }
    if (nestedSections) {
        section.section = nestedSections;
    }
    return section;
}

describe('filterCompositionSections', () => {
    test('removes sections with sensitive system in code.coding', () => {
        const sections = [
            makeSection('Normal', 'http://loinc.org', '12345-6'),
            makeSection('Sensitive', SENSITIVE_SYSTEM, 'substance-abuse')
        ];

        const result = filterCompositionSections(sections);

        expect(result).toHaveLength(1);
        expect(result[0].title).toBe('Normal');
    });

    test('recursively filters nested sections (parent stays, sensitive child removed)', () => {
        const sections = [
            makeSection('Parent', 'http://loinc.org', '12345-6', [
                makeSection('SafeChild', 'http://loinc.org', '11111-1'),
                makeSection('SensitiveChild', SENSITIVE_SYSTEM, 'mental-health')
            ])
        ];

        const result = filterCompositionSections(sections);

        expect(result).toHaveLength(1);
        expect(result[0].title).toBe('Parent');
        expect(result[0].section).toHaveLength(1);
        expect(result[0].section[0].title).toBe('SafeChild');
    });

    test('returns sections unchanged when none are sensitive', () => {
        const sections = [
            makeSection('A', 'http://loinc.org', '1'),
            makeSection('B', 'http://loinc.org', '2')
        ];

        const result = filterCompositionSections(sections);

        expect(result).toHaveLength(2);
        expect(result[0].title).toBe('A');
        expect(result[1].title).toBe('B');
    });

    test('handles sections without code property (keeps them)', () => {
        const sections = [
            { title: 'NoCode', text: { div: '<div>text</div>' } },
            makeSection('Sensitive', SENSITIVE_SYSTEM, 'substance-abuse')
        ];

        const result = filterCompositionSections(sections);

        expect(result).toHaveLength(1);
        expect(result[0].title).toBe('NoCode');
    });

    test('handles null/undefined/empty array input', () => {
        expect(filterCompositionSections(null)).toBeNull();
        expect(filterCompositionSections(undefined)).toBeUndefined();
        expect(filterCompositionSections([])).toEqual([]);
    });

    test('handles section with code but no coding array', () => {
        const sections = [
            { title: 'NoCoding', code: { text: 'Some text code' } },
            makeSection('Sensitive', SENSITIVE_SYSTEM, 'mental-health')
        ];

        const result = filterCompositionSections(sections);

        expect(result).toHaveLength(1);
        expect(result[0].title).toBe('NoCoding');
    });

    test('removes section when sensitive system is one of multiple codings', () => {
        const sections = [
            {
                title: 'MultiCoded',
                code: {
                    coding: [
                        { system: 'http://loinc.org', code: '12345-6' },
                        { system: SENSITIVE_SYSTEM, code: 'substance-abuse' }
                    ]
                }
            }
        ];

        const result = filterCompositionSections(sections);

        expect(result).toHaveLength(0);
    });

    test('handles deeply nested sections (3 levels deep)', () => {
        const sections = [
            makeSection('L1', 'http://loinc.org', '1', [
                makeSection('L2', 'http://loinc.org', '2', [
                    makeSection('L3-Safe', 'http://loinc.org', '3'),
                    makeSection('L3-Sensitive', SENSITIVE_SYSTEM, 'mental-health')
                ])
            ])
        ];

        const result = filterCompositionSections(sections);

        expect(result).toHaveLength(1);
        expect(result[0].section).toHaveLength(1);
        expect(result[0].section[0].section).toHaveLength(1);
        expect(result[0].section[0].section[0].title).toBe('L3-Safe');
    });

    test('keeps section when coding has empty system string', () => {
        const sections = [
            {
                title: 'EmptySystem',
                code: { coding: [{ system: '', code: 'some-code' }] }
            }
        ];

        const result = filterCompositionSections(sections);

        expect(result).toHaveLength(1);
        expect(result[0].title).toBe('EmptySystem');
    });

    test('keeps section when coding entries have no system property', () => {
        const sections = [
            {
                title: 'NoSystemProp',
                code: { coding: [{ code: 'some-code' }] }
            }
        ];

        const result = filterCompositionSections(sections);

        expect(result).toHaveLength(1);
        expect(result[0].title).toBe('NoSystemProp');
    });

    test('removes all sections when all are sensitive (returns empty array)', () => {
        const sections = [
            makeSection('S1', SENSITIVE_SYSTEM, 'substance-abuse'),
            makeSection('S2', SENSITIVE_SYSTEM, 'mental-health')
        ];

        const result = filterCompositionSections(sections);

        expect(result).toEqual([]);
    });
});

describe('filterCompositionSensitiveSections', () => {
    const enabledContext = {
        configManager: { enableCompositionSensitiveSectionFiltering: true },
        userType: AUTH_USER_TYPES.delegatedUser
    };
    const disabledContext = {
        configManager: { enableCompositionSensitiveSectionFiltering: false },
        userType: AUTH_USER_TYPES.delegatedUser
    };

    test('filters sensitive sections when config flag is enabled', () => {
        const rawJson = {
            resourceType: 'Composition',
            section: [
                makeSection('Normal', 'http://loinc.org', '12345-6'),
                makeSection('Sensitive', SENSITIVE_SYSTEM, 'substance-abuse')
            ]
        };

        filterCompositionSensitiveSections(rawJson, enabledContext);

        expect(rawJson.section).toHaveLength(1);
        expect(rawJson.section[0].title).toBe('Normal');
    });

    test('does not filter when config flag is disabled', () => {
        const rawJson = {
            resourceType: 'Composition',
            section: [
                makeSection('Normal', 'http://loinc.org', '12345-6'),
                makeSection('Sensitive', SENSITIVE_SYSTEM, 'substance-abuse')
            ]
        };

        filterCompositionSensitiveSections(rawJson, disabledContext);

        expect(rawJson.section).toHaveLength(2);
    });

    test('does not filter when context has no configManager', () => {
        const rawJson = {
            resourceType: 'Composition',
            section: [
                makeSection('Normal', 'http://loinc.org', '12345-6'),
                makeSection('Sensitive', SENSITIVE_SYSTEM, 'substance-abuse')
            ]
        };

        filterCompositionSensitiveSections(rawJson, {});

        expect(rawJson.section).toHaveLength(2);
    });

    test('no-ops when rawJson has no section', () => {
        const rawJson = { resourceType: 'Composition' };

        filterCompositionSensitiveSections(rawJson, enabledContext);

        expect(rawJson.section).toBeUndefined();
    });

    test('does not filter when context is empty object (no configManager)', () => {
        const rawJson = {
            resourceType: 'Composition',
            section: [
                makeSection('Normal', 'http://loinc.org', '12345-6'),
                makeSection('Sensitive', SENSITIVE_SYSTEM, 'substance-abuse')
            ]
        };

        filterCompositionSensitiveSections(rawJson, {});

        expect(rawJson.section).toHaveLength(2);
    });

    test('does not filter when configManager flag is undefined', () => {
        const rawJson = {
            resourceType: 'Composition',
            section: [
                makeSection('Sensitive', SENSITIVE_SYSTEM, 'substance-abuse')
            ]
        };

        filterCompositionSensitiveSections(rawJson, { configManager: {}, userType: AUTH_USER_TYPES.delegatedUser });

        expect(rawJson.section).toHaveLength(1);
    });

    test('does not filter when userType is not delegatedUser', () => {
        const rawJson = {
            resourceType: 'Composition',
            section: [
                makeSection('Normal', 'http://loinc.org', '12345-6'),
                makeSection('Sensitive', SENSITIVE_SYSTEM, 'substance-abuse')
            ]
        };

        filterCompositionSensitiveSections(rawJson, {
            configManager: { enableCompositionSensitiveSectionFiltering: true },
            userType: undefined
        });

        expect(rawJson.section).toHaveLength(2);
    });

    test('does not filter when userType is cmsPartnerUser', () => {
        const rawJson = {
            resourceType: 'Composition',
            section: [
                makeSection('Sensitive', SENSITIVE_SYSTEM, 'substance-abuse')
            ]
        };

        filterCompositionSensitiveSections(rawJson, {
            configManager: { enableCompositionSensitiveSectionFiltering: true },
            userType: AUTH_USER_TYPES.cmsPartnerUser
        });

        expect(rawJson.section).toHaveLength(1);
    });
});
