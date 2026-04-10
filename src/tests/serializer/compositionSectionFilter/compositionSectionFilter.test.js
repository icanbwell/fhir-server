const { describe, test, expect } = require('@jest/globals');
const {
    filterCompositionSensitiveSections,
    filterCompositionSensitiveSectionsFromResources
} = require('../../../utils/compositionSectionFilter');
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

/**
 * Helper: build a Composition resource with the given sections.
 */
function makeComposition(sections) {
    return { resourceType: 'Composition', section: sections };
}

const enabledContext = {
    configManager: { enableCompositionSensitiveSectionFiltering: true },
    userType: AUTH_USER_TYPES.delegatedUser
};

describe('filterCompositionSensitiveSections', () => {
    test('removes sections with sensitive system in code.coding', () => {
        const resource = makeComposition([
            makeSection('Normal', 'http://loinc.org', '12345-6'),
            makeSection('Sensitive', SENSITIVE_SYSTEM, 'substance-abuse')
        ]);

        filterCompositionSensitiveSections(resource, enabledContext);

        expect(resource.section).toHaveLength(1);
        expect(resource.section[0].title).toBe('Normal');
    });

    test('recursively filters nested sections (parent stays, sensitive child removed)', () => {
        const resource = makeComposition([
            makeSection('Parent', 'http://loinc.org', '12345-6', [
                makeSection('SafeChild', 'http://loinc.org', '11111-1'),
                makeSection('SensitiveChild', SENSITIVE_SYSTEM, 'mental-health')
            ])
        ]);

        filterCompositionSensitiveSections(resource, enabledContext);

        expect(resource.section).toHaveLength(1);
        expect(resource.section[0].title).toBe('Parent');
        expect(resource.section[0].section).toHaveLength(1);
        expect(resource.section[0].section[0].title).toBe('SafeChild');
    });

    test('returns sections unchanged when none are sensitive', () => {
        const resource = makeComposition([
            makeSection('A', 'http://loinc.org', '1'),
            makeSection('B', 'http://loinc.org', '2')
        ]);

        filterCompositionSensitiveSections(resource, enabledContext);

        expect(resource.section).toHaveLength(2);
        expect(resource.section[0].title).toBe('A');
        expect(resource.section[1].title).toBe('B');
    });

    test('handles sections without code property (keeps them)', () => {
        const resource = makeComposition([
            { title: 'NoCode', text: { div: '<div>text</div>' } },
            makeSection('Sensitive', SENSITIVE_SYSTEM, 'substance-abuse')
        ]);

        filterCompositionSensitiveSections(resource, enabledContext);

        expect(resource.section).toHaveLength(1);
        expect(resource.section[0].title).toBe('NoCode');
    });

    test('handles section with code but no coding array', () => {
        const resource = makeComposition([
            { title: 'NoCoding', code: { text: 'Some text code' } },
            makeSection('Sensitive', SENSITIVE_SYSTEM, 'mental-health')
        ]);

        filterCompositionSensitiveSections(resource, enabledContext);

        expect(resource.section).toHaveLength(1);
        expect(resource.section[0].title).toBe('NoCoding');
    });

    test('removes section when sensitive system is one of multiple codings', () => {
        const resource = makeComposition([
            {
                title: 'MultiCoded',
                code: {
                    coding: [
                        { system: 'http://loinc.org', code: '12345-6' },
                        { system: SENSITIVE_SYSTEM, code: 'substance-abuse' }
                    ]
                }
            }
        ]);

        filterCompositionSensitiveSections(resource, enabledContext);

        expect(resource.section).toHaveLength(0);
    });

    test('handles deeply nested sections (3 levels deep)', () => {
        const resource = makeComposition([
            makeSection('L1', 'http://loinc.org', '1', [
                makeSection('L2', 'http://loinc.org', '2', [
                    makeSection('L3-Safe', 'http://loinc.org', '3'),
                    makeSection('L3-Sensitive', SENSITIVE_SYSTEM, 'mental-health')
                ])
            ])
        ]);

        filterCompositionSensitiveSections(resource, enabledContext);

        expect(resource.section).toHaveLength(1);
        expect(resource.section[0].section).toHaveLength(1);
        expect(resource.section[0].section[0].section).toHaveLength(1);
        expect(resource.section[0].section[0].section[0].title).toBe('L3-Safe');
    });

    test('keeps section when coding has empty system string', () => {
        const resource = makeComposition([
            {
                title: 'EmptySystem',
                code: { coding: [{ system: '', code: 'some-code' }] }
            }
        ]);

        filterCompositionSensitiveSections(resource, enabledContext);

        expect(resource.section).toHaveLength(1);
        expect(resource.section[0].title).toBe('EmptySystem');
    });

    test('keeps section when coding entries have no system property', () => {
        const resource = makeComposition([
            {
                title: 'NoSystemProp',
                code: { coding: [{ code: 'some-code' }] }
            }
        ]);

        filterCompositionSensitiveSections(resource, enabledContext);

        expect(resource.section).toHaveLength(1);
        expect(resource.section[0].title).toBe('NoSystemProp');
    });

    test('removes all sections when all are sensitive (returns empty array)', () => {
        const resource = makeComposition([
            makeSection('S1', SENSITIVE_SYSTEM, 'substance-abuse'),
            makeSection('S2', SENSITIVE_SYSTEM, 'mental-health')
        ]);

        filterCompositionSensitiveSections(resource, enabledContext);

        expect(resource.section).toEqual([]);
    });

    test('filters sensitive sections when config flag is enabled', () => {
        const resource = makeComposition([
            makeSection('Normal', 'http://loinc.org', '12345-6'),
            makeSection('Sensitive', SENSITIVE_SYSTEM, 'substance-abuse')
        ]);

        filterCompositionSensitiveSections(resource, enabledContext);

        expect(resource.section).toHaveLength(1);
        expect(resource.section[0].title).toBe('Normal');
    });

    test('does not filter when config flag is disabled', () => {
        const resource = makeComposition([
            makeSection('Normal', 'http://loinc.org', '12345-6'),
            makeSection('Sensitive', SENSITIVE_SYSTEM, 'substance-abuse')
        ]);

        filterCompositionSensitiveSections(resource, {
            configManager: { enableCompositionSensitiveSectionFiltering: false },
            userType: AUTH_USER_TYPES.delegatedUser
        });

        expect(resource.section).toHaveLength(2);
    });

    test('does not filter when context has no configManager', () => {
        const resource = makeComposition([
            makeSection('Normal', 'http://loinc.org', '12345-6'),
            makeSection('Sensitive', SENSITIVE_SYSTEM, 'substance-abuse')
        ]);

        filterCompositionSensitiveSections(resource, {});

        expect(resource.section).toHaveLength(2);
    });

    test('no-ops when resource has no section', () => {
        const resource = { resourceType: 'Composition' };

        filterCompositionSensitiveSections(resource, enabledContext);

        expect(resource.section).toBeUndefined();
    });

    test('does not filter when configManager flag is undefined', () => {
        const resource = makeComposition([
            makeSection('Sensitive', SENSITIVE_SYSTEM, 'substance-abuse')
        ]);

        filterCompositionSensitiveSections(resource, {
            configManager: {},
            userType: AUTH_USER_TYPES.delegatedUser
        });

        expect(resource.section).toHaveLength(1);
    });

    test('does not filter when userType is not delegatedUser', () => {
        const resource = makeComposition([
            makeSection('Normal', 'http://loinc.org', '12345-6'),
            makeSection('Sensitive', SENSITIVE_SYSTEM, 'substance-abuse')
        ]);

        filterCompositionSensitiveSections(resource, {
            configManager: { enableCompositionSensitiveSectionFiltering: true },
            userType: undefined
        });

        expect(resource.section).toHaveLength(2);
    });

    test('does not filter when userType is cmsPartnerUser', () => {
        const resource = makeComposition([
            makeSection('Sensitive', SENSITIVE_SYSTEM, 'substance-abuse')
        ]);

        filterCompositionSensitiveSections(resource, {
            configManager: { enableCompositionSensitiveSectionFiltering: true },
            userType: AUTH_USER_TYPES.cmsPartnerUser
        });

        expect(resource.section).toHaveLength(1);
    });
});

describe('filterCompositionSensitiveSectionsFromResources', () => {
    test('filters sensitive sections from Composition resources in array', () => {
        const resources = [
            makeComposition([
                makeSection('Normal', 'http://loinc.org', '12345-6'),
                makeSection('Sensitive', SENSITIVE_SYSTEM, 'substance-abuse')
            ]),
            {
                resourceType: 'Patient',
                id: 'patient-1'
            },
            makeComposition([
                makeSection('Keep', 'http://loinc.org', '11111-1'),
                makeSection('Remove', SENSITIVE_SYSTEM, 'mental-health')
            ])
        ];

        filterCompositionSensitiveSectionsFromResources(resources, enabledContext);

        expect(resources[0].section).toHaveLength(1);
        expect(resources[0].section[0].title).toBe('Normal');
        expect(resources[1].resourceType).toBe('Patient');
        expect(resources[2].section).toHaveLength(1);
        expect(resources[2].section[0].title).toBe('Keep');
    });

    test('handles empty array', () => {
        const resources = [];
        filterCompositionSensitiveSectionsFromResources(resources, enabledContext);
        expect(resources).toHaveLength(0);
    });

    test('no-ops when no Composition resources in array', () => {
        const resources = [
            { resourceType: 'Patient', id: 'p1' },
            { resourceType: 'Observation', id: 'o1' }
        ];

        filterCompositionSensitiveSectionsFromResources(resources, enabledContext);

        expect(resources).toHaveLength(2);
        expect(resources[0].resourceType).toBe('Patient');
    });
});
