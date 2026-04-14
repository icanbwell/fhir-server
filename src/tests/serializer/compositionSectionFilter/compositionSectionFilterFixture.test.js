const deepcopy = require('deepcopy');
const { filterCompositionSensitiveSections } = require('../../../utils/compositionSectionFilter');
const { describe, test, expect } = require('@jest/globals');
const { SENSITIVE_CATEGORY } = require('../../../constants');

const compositionFixture = require('./fixtures/Composition/compositionWithSensitiveSections.json');

describe('Composition Section Filter — Fixture Tests', () => {
    test('filters sensitive sections at all nesting levels', () => {
        const composition = deepcopy(compositionFixture);

        filterCompositionSensitiveSections(composition);

        // Top-level: 'Sensitive Top Level' removed, 2 remain
        expect(composition.section).toHaveLength(2);
        expect(composition.section[0].title).toBe('Normal Section 1');
        expect(composition.section[1].title).toBe('Normal Section 2');

        // Nested: 'Nested Sensitive' removed from first section's children
        expect(composition.section[0].section).toHaveLength(1);
        expect(composition.section[0].section[0].title).toBe('Nested Normal');

        // Deep: 'Deep Sensitive' removed, only 'Deep Normal' remains
        expect(composition.section[0].section[0].section).toHaveLength(1);
        expect(composition.section[0].section[0].section[0].title).toBe('Deep Normal');
    });

    test('sensitive sections use the expected system identifier', () => {
        const composition = deepcopy(compositionFixture);
        const sensitiveSections = [];

        // Collect all sensitive sections before filtering
        function collectSensitive(sections) {
            for (const section of sections) {
                const hasSensitive = section.code?.coding?.some(
                    (c) => c.system === SENSITIVE_CATEGORY.SYSTEM
                );
                if (hasSensitive) {
                    sensitiveSections.push(section.title);
                }
                if (section.section) {
                    collectSensitive(section.section);
                }
            }
        }
        collectSensitive(composition.section);

        expect(sensitiveSections).toEqual([
            'Deep Sensitive',
            'Nested Sensitive',
            'Sensitive Top Level'
        ]);

        // After filtering, none should remain
        filterCompositionSensitiveSections(composition);

        const remaining = [];
        function collectAll(sections) {
            for (const section of sections) {
                remaining.push(section.title);
                if (section.section) {
                    collectAll(section.section);
                }
            }
        }
        collectAll(composition.section);

        expect(remaining).toEqual([
            'Normal Section 1',
            'Nested Normal',
            'Deep Normal',
            'Normal Section 2'
        ]);
    });
});
