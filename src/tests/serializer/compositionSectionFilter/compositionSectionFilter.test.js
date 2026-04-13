const { describe, test, expect } = require('@jest/globals');
const {
    filterCompositionSensitiveSections
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
    configManager: { enableDelegatedAccessDetection: true, enableCompositionSensitiveSectionFiltering: true },
    userType: AUTH_USER_TYPES.delegatedUser
};

describe('filterCompositionSensitiveSections', () => {
    test('removes sections with sensitive system in code.coding', () => {
        const resource = makeComposition([
            makeSection('Normal', 'http://loinc.org', '12345-6'),
            makeSection('Sensitive', SENSITIVE_SYSTEM, 'SUBSTANCE_ABUSE')
        ]);

        filterCompositionSensitiveSections(resource, enabledContext);

        expect(resource.section).toHaveLength(1);
        expect(resource.section[0].title).toBe('Normal');
    });

    test('recursively filters nested sections (parent stays, sensitive child removed)', () => {
        const resource = makeComposition([
            makeSection('Parent', 'http://loinc.org', '12345-6', [
                makeSection('SafeChild', 'http://loinc.org', '11111-1'),
                makeSection('SensitiveChild', SENSITIVE_SYSTEM, 'MENTAL_HEALTH')
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
            makeSection('Sensitive', SENSITIVE_SYSTEM, 'SUBSTANCE_ABUSE')
        ]);

        filterCompositionSensitiveSections(resource, enabledContext);

        expect(resource.section).toHaveLength(1);
        expect(resource.section[0].title).toBe('NoCode');
    });

    test('handles section with code but no coding array', () => {
        const resource = makeComposition([
            { title: 'NoCoding', code: { text: 'Some text code' } },
            makeSection('Sensitive', SENSITIVE_SYSTEM, 'MENTAL_HEALTH')
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
                        { system: SENSITIVE_SYSTEM, code: 'SUBSTANCE_ABUSE' }
                    ]
                }
            }
        ]);

        filterCompositionSensitiveSections(resource, enabledContext);

        expect(resource.section).toBeUndefined();
    });

    test('handles deeply nested sections (3 levels deep)', () => {
        const resource = makeComposition([
            makeSection('L1', 'http://loinc.org', '1', [
                makeSection('L2', 'http://loinc.org', '2', [
                    makeSection('L3-Safe', 'http://loinc.org', '3'),
                    makeSection('L3-Sensitive', SENSITIVE_SYSTEM, 'MENTAL_HEALTH')
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

    test('removes all sections when all are sensitive (deletes section property)', () => {
        const resource = makeComposition([
            makeSection('S1', SENSITIVE_SYSTEM, 'SUBSTANCE_ABUSE'),
            makeSection('S2', SENSITIVE_SYSTEM, 'MENTAL_HEALTH')
        ]);

        filterCompositionSensitiveSections(resource, enabledContext);

        expect(resource.section).toBeUndefined();
    });

    test('filters sensitive sections when config flag is enabled', () => {
        const resource = makeComposition([
            makeSection('Normal', 'http://loinc.org', '12345-6'),
            makeSection('Sensitive', SENSITIVE_SYSTEM, 'SUBSTANCE_ABUSE')
        ]);

        filterCompositionSensitiveSections(resource, enabledContext);

        expect(resource.section).toHaveLength(1);
        expect(resource.section[0].title).toBe('Normal');
    });

    test('does not filter when config flag is disabled', () => {
        const resource = makeComposition([
            makeSection('Normal', 'http://loinc.org', '12345-6'),
            makeSection('Sensitive', SENSITIVE_SYSTEM, 'SUBSTANCE_ABUSE')
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
            makeSection('Sensitive', SENSITIVE_SYSTEM, 'SUBSTANCE_ABUSE')
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
            makeSection('Sensitive', SENSITIVE_SYSTEM, 'SUBSTANCE_ABUSE')
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
            makeSection('Sensitive', SENSITIVE_SYSTEM, 'SUBSTANCE_ABUSE')
        ]);

        filterCompositionSensitiveSections(resource, {
            configManager: { enableDelegatedAccessDetection: true, enableCompositionSensitiveSectionFiltering: true },
            userType: undefined
        });

        expect(resource.section).toHaveLength(2);
    });

    test('does not filter when userType is cmsPartnerUser', () => {
        const resource = makeComposition([
            makeSection('Sensitive', SENSITIVE_SYSTEM, 'SUBSTANCE_ABUSE')
        ]);

        filterCompositionSensitiveSections(resource, {
            configManager: { enableDelegatedAccessDetection: true, enableCompositionSensitiveSectionFiltering: true },
            userType: AUTH_USER_TYPES.cmsPartnerUser
        });

        expect(resource.section).toHaveLength(1);
    });
});


