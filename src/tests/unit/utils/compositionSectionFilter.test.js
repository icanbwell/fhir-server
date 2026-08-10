const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../operations/common/logging', () => ({
    logInfo: jestObj.fn()
}));

const { filterCompositionSensitiveSections } = require('../../../utils/compositionSectionFilter');
const { SENSITIVE_CATEGORY } = require('../../../constants');

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
