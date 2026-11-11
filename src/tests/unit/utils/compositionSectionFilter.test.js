const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../operations/common/logging', () => ({
    logInfo: jestObj.fn()
}));

const {
    filterCompositionSensitiveSections,
    filterCompositionBlockedReferenceSections
} = require('../../../utils/compositionSectionFilter');
const { SENSITIVE_CATEGORY } = require('../../../constants');
const { IdentifierSystem } = require('../../../utils/identifierSystem');

describe('filterCompositionSensitiveSections', () => {
    const SYSTEM = SENSITIVE_CATEGORY.SYSTEM;

    describe('no-op cases', () => {
        test('does nothing when resource is null', () => {
            expect(() => filterCompositionSensitiveSections(null, new Set(['code1']))).not.toThrow();
        });

        test('does nothing when resource is undefined', () => {
            expect(() => filterCompositionSensitiveSections(undefined, new Set(['code1']))).not.toThrow();
        });

        test('does nothing when resource has no section property', () => {
            const resource = { resourceType: 'Composition', _uuid: 'comp-1' };
            filterCompositionSensitiveSections(resource, new Set(['code1']));
            expect(resource.section).toBeUndefined();
        });
    });

    describe('section filtering', () => {
        test('removes sections with denied sensitive category codes', () => {
            const resource = {
                resourceType: 'Composition',
                _uuid: 'comp-1',
                section: [
                    {
                        id: 'section-1',
                        code: { coding: [{ system: SYSTEM, code: 'restricted' }] }
                    },
                    {
                        id: 'section-2',
                        code: { coding: [{ system: SYSTEM, code: 'allowed' }] }
                    }
                ]
            };

            filterCompositionSensitiveSections(resource, new Set(['restricted']));

            expect(resource.section).toHaveLength(1);
            expect(resource.section[0].id).toBe('section-2');
        });

        test('keeps sections with non-matching system', () => {
            const resource = {
                resourceType: 'Composition',
                _uuid: 'comp-1',
                section: [
                    {
                        id: 'section-1',
                        code: { coding: [{ system: 'http://other-system.com', code: 'restricted' }] }
                    }
                ]
            };

            filterCompositionSensitiveSections(resource, new Set(['restricted']));

            expect(resource.section).toHaveLength(1);
            expect(resource.section[0].id).toBe('section-1');
        });

        test('keeps sections when coding has matching system but code not in denied set', () => {
            const resource = {
                resourceType: 'Composition',
                _uuid: 'comp-1',
                section: [
                    {
                        id: 'section-1',
                        code: { coding: [{ system: SYSTEM, code: 'safe-code' }] }
                    }
                ]
            };

            filterCompositionSensitiveSections(resource, new Set(['restricted']));

            expect(resource.section).toHaveLength(1);
        });

        test('keeps sections without code property', () => {
            const resource = {
                resourceType: 'Composition',
                _uuid: 'comp-1',
                section: [
                    { id: 'no-code-section' }
                ]
            };

            filterCompositionSensitiveSections(resource, new Set(['restricted']));

            expect(resource.section).toHaveLength(1);
            expect(resource.section[0].id).toBe('no-code-section');
        });

        test('keeps section when coding has empty system string', () => {
            const resource = {
                resourceType: 'Composition',
                _uuid: 'comp-1',
                section: [
                    {
                        id: 'empty-system-section',
                        code: { coding: [{ system: '', code: 'restricted' }] }
                    }
                ]
            };

            filterCompositionSensitiveSections(resource, new Set(['restricted']));

            expect(resource.section).toHaveLength(1);
            expect(resource.section[0].id).toBe('empty-system-section');
        });

        test('keeps section when coding entries have no system property', () => {
            const resource = {
                resourceType: 'Composition',
                _uuid: 'comp-1',
                section: [
                    {
                        id: 'no-system-prop-section',
                        code: { coding: [{ code: 'restricted' }] }
                    }
                ]
            };

            filterCompositionSensitiveSections(resource, new Set(['restricted']));

            expect(resource.section).toHaveLength(1);
            expect(resource.section[0].id).toBe('no-system-prop-section');
        });

        test('keeps sections where code.coding is not an array', () => {
            const resource = {
                resourceType: 'Composition',
                _uuid: 'comp-1',
                section: [
                    {
                        id: 'non-array-coding',
                        code: { coding: 'not-an-array' }
                    }
                ]
            };

            filterCompositionSensitiveSections(resource, new Set(['restricted']));

            expect(resource.section).toHaveLength(1);
        });

        test('removes section if any coding entry matches denied category', () => {
            const resource = {
                resourceType: 'Composition',
                _uuid: 'comp-1',
                section: [
                    {
                        id: 'multi-coding',
                        code: {
                            coding: [
                                { system: 'http://other.com', code: 'safe' },
                                { system: SYSTEM, code: 'restricted' }
                            ]
                        }
                    }
                ]
            };

            filterCompositionSensitiveSections(resource, new Set(['restricted']));

            expect(resource.section).toBeUndefined();
        });

        test('deletes the section property entirely when all sections are removed', () => {
            const resource = {
                resourceType: 'Composition',
                _uuid: 'comp-1',
                section: [
                    {
                        id: 'section-1',
                        code: { coding: [{ system: SYSTEM, code: 'restricted' }] }
                    }
                ]
            };

            filterCompositionSensitiveSections(resource, new Set(['restricted']));

            expect(resource.section).toBeUndefined();
        });
    });

    describe('nested section filtering', () => {
        test('recursively filters nested sections', () => {
            const resource = {
                resourceType: 'Composition',
                _uuid: 'comp-1',
                section: [
                    {
                        id: 'parent-section',
                        code: { coding: [{ system: SYSTEM, code: 'allowed' }] },
                        section: [
                            {
                                id: 'child-keep',
                                code: { coding: [{ system: SYSTEM, code: 'allowed' }] }
                            },
                            {
                                id: 'child-remove',
                                code: { coding: [{ system: SYSTEM, code: 'restricted' }] }
                            }
                        ]
                    }
                ]
            };

            filterCompositionSensitiveSections(resource, new Set(['restricted']));

            expect(resource.section).toHaveLength(1);
            expect(resource.section[0].section).toHaveLength(1);
            expect(resource.section[0].section[0].id).toBe('child-keep');
        });

        test('removes nested section property when all children are filtered out', () => {
            const resource = {
                resourceType: 'Composition',
                _uuid: 'comp-1',
                section: [
                    {
                        id: 'parent-section',
                        code: { coding: [{ system: SYSTEM, code: 'allowed' }] },
                        section: [
                            {
                                id: 'child-remove',
                                code: { coding: [{ system: SYSTEM, code: 'restricted' }] }
                            }
                        ]
                    }
                ]
            };

            filterCompositionSensitiveSections(resource, new Set(['restricted']));

            expect(resource.section).toHaveLength(1);
            expect(resource.section[0].section).toBeUndefined();
        });

        test('removes parent section if it matches denied category even if children are safe', () => {
            const resource = {
                resourceType: 'Composition',
                _uuid: 'comp-1',
                section: [
                    {
                        id: 'parent-restricted',
                        code: { coding: [{ system: SYSTEM, code: 'restricted' }] },
                        section: [
                            {
                                id: 'child-safe',
                                code: { coding: [{ system: SYSTEM, code: 'allowed' }] }
                            }
                        ]
                    }
                ]
            };

            filterCompositionSensitiveSections(resource, new Set(['restricted']));

            expect(resource.section).toBeUndefined();
        });

        test('handles deeply nested sections', () => {
            const resource = {
                resourceType: 'Composition',
                _uuid: 'comp-1',
                section: [
                    {
                        id: 'level-0',
                        code: { coding: [{ system: SYSTEM, code: 'allowed' }] },
                        section: [
                            {
                                id: 'level-1',
                                code: { coding: [{ system: SYSTEM, code: 'allowed' }] },
                                section: [
                                    {
                                        id: 'level-2-remove',
                                        code: { coding: [{ system: SYSTEM, code: 'restricted' }] }
                                    },
                                    {
                                        id: 'level-2-keep',
                                        code: { coding: [{ system: SYSTEM, code: 'allowed' }] }
                                    }
                                ]
                            }
                        ]
                    }
                ]
            };

            filterCompositionSensitiveSections(resource, new Set(['restricted']));

            expect(resource.section[0].section[0].section).toHaveLength(1);
            expect(resource.section[0].section[0].section[0].id).toBe('level-2-keep');
        });
    });

    describe('multiple denied codes', () => {
        test('filters sections matching any code in the denied set', () => {
            const resource = {
                resourceType: 'Composition',
                _uuid: 'comp-1',
                section: [
                    {
                        id: 'section-a',
                        code: { coding: [{ system: SYSTEM, code: 'code-a' }] }
                    },
                    {
                        id: 'section-b',
                        code: { coding: [{ system: SYSTEM, code: 'code-b' }] }
                    },
                    {
                        id: 'section-c',
                        code: { coding: [{ system: SYSTEM, code: 'code-c' }] }
                    }
                ]
            };

            filterCompositionSensitiveSections(resource, new Set(['code-a', 'code-c']));

            expect(resource.section).toHaveLength(1);
            expect(resource.section[0].id).toBe('section-b');
        });
    });

    describe('empty denied set', () => {
        test('keeps all sections when denied set is empty', () => {
            const resource = {
                resourceType: 'Composition',
                _uuid: 'comp-1',
                section: [
                    {
                        id: 'section-1',
                        code: { coding: [{ system: SYSTEM, code: 'anything' }] }
                    },
                    {
                        id: 'section-2',
                        code: { coding: [{ system: SYSTEM, code: 'something-else' }] }
                    }
                ]
            };

            filterCompositionSensitiveSections(resource, new Set());

            expect(resource.section).toHaveLength(2);
        });
    });

    describe('hardcoded unclassified category (DCON-4892)', () => {
        // filterCompositionSensitiveSections/shouldRemoveSection is a pure denylist-membership
        // check -- it has no built-in knowledge of the hardcoded unclassified code. Folding
        // 'unclassified' into the denylist unconditionally (so it's always stripped regardless of
        // what the grantor's Consent denies) is the CALLER's responsibility -- see
        // CompositionSectionFilterEnrichmentProvider.getDeniedSensitiveCategorySet, which mirrors
        // DataSharingManager.updateQueryForDelegatedAccessSensitiveData's query-level exclusion.
        // These tests confirm this layer correctly removes an unclassified-tagged section when
        // the caller's set includes it (the provider's contract), without special-casing it here.
        test('removes a section tagged with the hardcoded unclassified code when the caller includes it in the denied set', () => {
            const resource = {
                resourceType: 'Composition',
                _uuid: 'comp-1',
                section: [
                    {
                        id: 'section-unclassified',
                        code: { coding: [{ system: SYSTEM, code: SENSITIVE_CATEGORY.UNCLASSIFIED_CODE }] }
                    },
                    {
                        id: 'section-visible',
                        code: { coding: [{ system: SYSTEM, code: 'not-denied' }] }
                    }
                ]
            };

            filterCompositionSensitiveSections(
                resource,
                new Set(['restricted', SENSITIVE_CATEGORY.UNCLASSIFIED_CODE])
            );

            expect(resource.section).toHaveLength(1);
            expect(resource.section[0].id).toBe('section-visible');
        });

        test('keeps a section tagged with the hardcoded unclassified code when the caller-supplied set does not include it (this layer has no special case)', () => {
            const resource = {
                resourceType: 'Composition',
                _uuid: 'comp-1',
                section: [
                    {
                        id: 'section-unclassified',
                        code: { coding: [{ system: SYSTEM, code: SENSITIVE_CATEGORY.UNCLASSIFIED_CODE }] }
                    }
                ]
            };

            // Deliberately omits SENSITIVE_CATEGORY.UNCLASSIFIED_CODE -- proves this function no
            // longer hardcodes the special case itself; that's the provider's job now.
            filterCompositionSensitiveSections(resource, new Set(['restricted']));

            expect(resource.section).toHaveLength(1);
            expect(resource.section[0].id).toBe('section-unclassified');
        });

        test('removes a Consent-denied category alongside the hardcoded unclassified code in the same Composition', () => {
            const resource = {
                resourceType: 'Composition',
                _uuid: 'comp-1',
                section: [
                    {
                        id: 'section-unclassified',
                        code: { coding: [{ system: SYSTEM, code: SENSITIVE_CATEGORY.UNCLASSIFIED_CODE }] }
                    },
                    {
                        id: 'section-restricted',
                        code: { coding: [{ system: SYSTEM, code: 'restricted' }] }
                    },
                    {
                        id: 'section-visible',
                        code: { coding: [{ system: SYSTEM, code: 'not-denied' }] }
                    }
                ]
            };

            filterCompositionSensitiveSections(
                resource,
                new Set(['restricted', SENSITIVE_CATEGORY.UNCLASSIFIED_CODE])
            );

            expect(resource.section).toHaveLength(1);
            expect(resource.section[0].id).toBe('section-visible');
        });
    });
});

describe('filterCompositionBlockedReferenceSections', () => {
    const BLOCKED_UUID = '11111111-1111-5111-8111-111111111111';
    const OTHER_UUID = '22222222-2222-5222-8222-222222222222';
    const sourceIdExt = (value) => ({ id: 'sourceId', url: IdentifierSystem.sourceId, valueString: value });
    const uuidExt = (value) => ({ id: 'uuid', url: IdentifierSystem.uuid, valueString: value });
    const composition = (section) => ({ resourceType: 'Composition', _uuid: 'comp-1', section });
    const sectionIds = (sections) => (sections || []).map((s) => s.id);

    test.each([
        ['the entry reference is the blocked uuid', { reference: `CarePlan/${BLOCKED_UUID}` }],
        ['the entry reference is the blocked source id', { reference: 'CarePlan/care-plan-1' }],
        ['the entry reference carries an owner suffix', { reference: 'CarePlan/care-plan-1|client-a' }],
        ['the stored _uuid matches', { reference: 'CarePlan/other', _uuid: `CarePlan/${BLOCKED_UUID}` }],
        ['the stored _sourceId matches', { reference: `CarePlan/${OTHER_UUID}`, _sourceId: 'CarePlan/care-plan-1' }],
        ['the uuid extension matches', { reference: 'CarePlan/other', extension: [uuidExt(`CarePlan/${BLOCKED_UUID}`)] }],
        ['the sourceId extension matches', {
            reference: `CarePlan/${OTHER_UUID}`, extension: [sourceIdExt('CarePlan/care-plan-1')]
        }]
    ])('removes a section when %s', (_name, entry) => {
        const resource = composition([
            { id: 'blocked', entry: [entry] },
            { id: 'kept', entry: [{ reference: 'CarePlan/care-plan-3' }] }
        ]);

        filterCompositionBlockedReferenceSections(resource, { CarePlan: [BLOCKED_UUID, 'care-plan-1'] });

        expect(sectionIds(resource.section)).toEqual(['kept']);
    });

    test.each([
        ['the same id on a different resource type', { reference: 'Observation/care-plan-1' }],
        ['an extension with another url', {
            reference: 'CarePlan/care-plan-3', extension: [{ url: 'https://example.com/other', valueString: 'CarePlan/care-plan-1' }]
        }],
        ['an entry with no reference', { display: 'no reference' }],
        ['a contained (#) reference', { reference: '#care-plan-1' }]
    ])('keeps a section for %s', (_name, entry) => {
        const resource = composition([{ id: 'kept', entry: [entry] }]);

        filterCompositionBlockedReferenceSections(resource, { CarePlan: ['care-plan-1'] });

        expect(sectionIds(resource.section)).toEqual(['kept']);
    });

    test('removes a whole multi-entry section when any one entry is blocked', () => {
        const resource = composition([
            { id: 'mixed', entry: [{ reference: 'CarePlan/care-plan-3' }, { reference: 'CarePlan/care-plan-1' }] }
        ]);

        filterCompositionBlockedReferenceSections(resource, { CarePlan: ['care-plan-1'] });

        expect(resource.section).toBeUndefined();
    });

    test('removes a blocked nested section and keeps its parent', () => {
        const resource = composition([{
            id: 'parent',
            entry: [{ reference: 'CarePlan/care-plan-3' }],
            section: [
                { id: 'child-blocked', entry: [{ reference: 'CarePlan/care-plan-1' }] },
                { id: 'child-kept', entry: [{ reference: 'CarePlan/care-plan-4' }] }
            ]
        }]);

        filterCompositionBlockedReferenceSections(resource, { CarePlan: ['care-plan-1'] });

        expect(sectionIds(resource.section)).toEqual(['parent']);
        expect(sectionIds(resource.section[0].section)).toEqual(['child-kept']);
    });

    test('keeps a parent whose only child is removed, without an empty section array', () => {
        const resource = composition([{
            id: 'parent',
            section: [{ id: 'child-blocked', entry: [{ reference: 'CarePlan/care-plan-1' }] }]
        }]);

        filterCompositionBlockedReferenceSections(resource, { CarePlan: ['care-plan-1'] });

        expect(sectionIds(resource.section)).toEqual(['parent']);
        expect(resource.section[0].section).toBeUndefined();
    });

    test('deletes section when every section is removed', () => {
        const resource = composition([{ id: 'blocked', entry: [{ reference: 'CarePlan/care-plan-1' }] }]);

        filterCompositionBlockedReferenceSections(resource, { CarePlan: ['care-plan-1'] });

        expect(resource).not.toHaveProperty('section');
    });

    test.each([
        ['an empty exclude map', {}],
        ['no exclude map', undefined],
        ['an exclude map for other types only', { Observation: ['care-plan-1'] }]
    ])('leaves the Composition untouched for %s', (_name, excludeMap) => {
        const resource = composition([{ id: 's1', entry: [{ reference: 'CarePlan/care-plan-1' }] }]);
        const before = JSON.parse(JSON.stringify(resource));

        filterCompositionBlockedReferenceSections(resource, excludeMap);

        expect(resource).toEqual(before);
    });

    test.each([
        ['null', null],
        ['a Composition with no section', { resourceType: 'Composition', _uuid: 'comp-1' }]
    ])('does nothing for %s', (_name, resource) => {
        expect(() => filterCompositionBlockedReferenceSections(resource, { CarePlan: ['care-plan-1'] })).not.toThrow();
    });

    test('accepts a frozen exclude map (the shared lookup is frozen)', () => {
        const resource = composition([{ id: 'blocked', entry: [{ reference: 'CarePlan/care-plan-1' }] }]);
        const excludeMap = Object.freeze({ CarePlan: Object.freeze(['care-plan-1']) });

        filterCompositionBlockedReferenceSections(resource, excludeMap);

        expect(resource.section).toBeUndefined();
    });
});
