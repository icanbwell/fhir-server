const { describe, test, expect } = require('@jest/globals');
const {
    filterCompositionSensitiveSections
} = require('../../../utils/compositionSectionFilter');
const { SENSITIVE_CATEGORY } = require('../../../constants');

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

describe('filterCompositionSensitiveSections', () => {
    const ALL_DENIED = new Set(['SUBSTANCE_ABUSE', 'MENTAL_HEALTH', 'reproductive-health']);

    test('removes sections with denied sensitivity code', () => {
        const resource = makeComposition([
            makeSection('Normal', 'http://loinc.org', '12345-6'),
            makeSection('Sensitive', SENSITIVE_SYSTEM, 'SUBSTANCE_ABUSE')
        ]);

        filterCompositionSensitiveSections(resource, ALL_DENIED);

        expect(resource.section).toHaveLength(1);
        expect(resource.section[0].title).toBe('Normal');
    });

    test('keeps sections with sensitivity codes NOT in denied set', () => {
        const denied = new Set(['SUBSTANCE_ABUSE']);
        const resource = makeComposition([
            makeSection('Normal', 'http://loinc.org', '12345-6'),
            makeSection('Kept', SENSITIVE_SYSTEM, 'MENTAL_HEALTH'),
            makeSection('Removed', SENSITIVE_SYSTEM, 'SUBSTANCE_ABUSE')
        ]);

        filterCompositionSensitiveSections(resource, denied);

        expect(resource.section).toHaveLength(2);
        expect(resource.section[0].title).toBe('Normal');
        expect(resource.section[1].title).toBe('Kept');
    });

    test('multi-coded section removed if ANY code is in denied set', () => {
        const denied = new Set(['SUBSTANCE_ABUSE']);
        const resource = makeComposition([
            {
                title: 'MultiCoded',
                code: {
                    coding: [
                        { system: 'http://loinc.org', code: '12345-6' },
                        { system: SENSITIVE_SYSTEM, code: 'reproductive-health' },
                        { system: SENSITIVE_SYSTEM, code: 'SUBSTANCE_ABUSE' }
                    ]
                }
            }
        ]);

        filterCompositionSensitiveSections(resource, denied);

        expect(resource.section).toBeUndefined();
    });

    test('multi-coded section kept when none of its codes are denied', () => {
        const denied = new Set(['SUBSTANCE_ABUSE']);
        const resource = makeComposition([
            {
                title: 'MultiCoded',
                code: {
                    coding: [
                        { system: 'http://loinc.org', code: '12345-6' },
                        { system: SENSITIVE_SYSTEM, code: 'reproductive-health' },
                        { system: SENSITIVE_SYSTEM, code: 'MENTAL_HEALTH' }
                    ]
                }
            }
        ]);

        filterCompositionSensitiveSections(resource, denied);

        expect(resource.section).toHaveLength(1);
        expect(resource.section[0].title).toBe('MultiCoded');
    });

    test('empty denied set keeps ALL sections including sensitive ones', () => {
        const denied = new Set();
        const resource = makeComposition([
            makeSection('Normal', 'http://loinc.org', '12345-6'),
            makeSection('Sensitive', SENSITIVE_SYSTEM, 'SUBSTANCE_ABUSE'),
            makeSection('AlsoSensitive', SENSITIVE_SYSTEM, 'MENTAL_HEALTH')
        ]);

        filterCompositionSensitiveSections(resource, denied);

        expect(resource.section).toHaveLength(3);
    });

    test('recursively filters nested sections matching denied codes', () => {
        const denied = new Set(['MENTAL_HEALTH']);
        const resource = makeComposition([
            makeSection('Parent', 'http://loinc.org', '12345-6', [
                makeSection('SafeChild', 'http://loinc.org', '11111-1'),
                makeSection('SensitiveChild', SENSITIVE_SYSTEM, 'MENTAL_HEALTH'),
                makeSection('NonDeniedSensitive', SENSITIVE_SYSTEM, 'SUBSTANCE_ABUSE')
            ])
        ]);

        filterCompositionSensitiveSections(resource, denied);

        expect(resource.section).toHaveLength(1);
        expect(resource.section[0].title).toBe('Parent');
        expect(resource.section[0].section).toHaveLength(2);
        expect(resource.section[0].section[0].title).toBe('SafeChild');
        expect(resource.section[0].section[1].title).toBe('NonDeniedSensitive');
    });

    test('returns sections unchanged when none match denied set', () => {
        const denied = new Set(['SUBSTANCE_ABUSE']);
        const resource = makeComposition([
            makeSection('A', 'http://loinc.org', '1'),
            makeSection('B', 'http://loinc.org', '2')
        ]);

        filterCompositionSensitiveSections(resource, denied);

        expect(resource.section).toHaveLength(2);
        expect(resource.section[0].title).toBe('A');
        expect(resource.section[1].title).toBe('B');
    });

    test('handles sections without code property (keeps them)', () => {
        const resource = makeComposition([
            { title: 'NoCode', text: { div: '<div>text</div>' } },
            makeSection('Sensitive', SENSITIVE_SYSTEM, 'SUBSTANCE_ABUSE')
        ]);

        filterCompositionSensitiveSections(resource, ALL_DENIED);

        expect(resource.section).toHaveLength(1);
        expect(resource.section[0].title).toBe('NoCode');
    });

    test('handles section with code but no coding array', () => {
        const resource = makeComposition([
            { title: 'NoCoding', code: { text: 'Some text code' } },
            makeSection('Sensitive', SENSITIVE_SYSTEM, 'MENTAL_HEALTH')
        ]);

        filterCompositionSensitiveSections(resource, ALL_DENIED);

        expect(resource.section).toHaveLength(1);
        expect(resource.section[0].title).toBe('NoCoding');
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

        filterCompositionSensitiveSections(resource, ALL_DENIED);

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

        filterCompositionSensitiveSections(resource, ALL_DENIED);

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

        filterCompositionSensitiveSections(resource, ALL_DENIED);

        expect(resource.section).toHaveLength(1);
        expect(resource.section[0].title).toBe('NoSystemProp');
    });

    test('removes all sections when all match denied set (deletes section property)', () => {
        const resource = makeComposition([
            makeSection('S1', SENSITIVE_SYSTEM, 'SUBSTANCE_ABUSE'),
            makeSection('S2', SENSITIVE_SYSTEM, 'MENTAL_HEALTH')
        ]);

        filterCompositionSensitiveSections(resource, ALL_DENIED);

        expect(resource.section).toBeUndefined();
    });

    test('no-ops when resource has no section', () => {
        const resource = { resourceType: 'Composition' };

        filterCompositionSensitiveSections(resource, ALL_DENIED);

        expect(resource.section).toBeUndefined();
    });

    test('deletes nested section array when all children match denied set', () => {
        const denied = new Set(['SUBSTANCE_ABUSE', 'MENTAL_HEALTH']);
        const resource = makeComposition([
            makeSection('Parent', 'http://loinc.org', '1', [
                makeSection('Child1', SENSITIVE_SYSTEM, 'SUBSTANCE_ABUSE'),
                makeSection('Child2', SENSITIVE_SYSTEM, 'MENTAL_HEALTH')
            ])
        ]);

        filterCompositionSensitiveSections(resource, denied);

        expect(resource.section).toHaveLength(1);
        expect(resource.section[0].title).toBe('Parent');
        expect(resource.section[0].section).toBeUndefined();
    });
});
