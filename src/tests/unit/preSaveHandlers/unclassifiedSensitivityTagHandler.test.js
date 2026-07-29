const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

/**
 * Security tests for UnclassifiedSensitivityTagHandler.
 *
 * These tests assert CORRECT behavior so they FAIL on buggy code:
 * 1. BUG: resource.meta.security === null causes early return without tagging
 * 2. BUG: in-place mutation of shared tag object leaks via reference
 * 3. Unclassified tag is added for configured resource types (happy path)
 * 4. Duplicates are collapsed to one
 * 5. suppressUnclassifiedTag option skips tagging
 */

jestGlobal.mock('../../../utils/uid.util', () => ({
    generateUUIDv5: jestGlobal.fn((input) => `uuid-for-${input}`)
}));

jestGlobal.mock('../../../fhir/classes/4_0_0/complex_types/coding', () => {
    return jestGlobal.fn((props) => ({ ...props, _isCoding: true }));
});

jestGlobal.mock('../../../fhir/classes/4_0_0/resources/resource', () => {
    class MockResource {}
    return MockResource;
});

jestGlobal.mock('../../../preSaveHandlers/handlers/preSaveHandler', () => ({
    PreSaveHandler: class PreSaveHandler {}
}));

const { UnclassifiedSensitivityTagHandler } = require('../../../preSaveHandlers/handlers/unclassifiedSensitivityTagHandler');
const { SENSITIVE_CATEGORY } = require('../../../constants');
const Resource = require('../../../fhir/classes/4_0_0/resources/resource');

describe('UnclassifiedSensitivityTagHandler - Security', () => {
    let handler;
    let configManager;

    beforeEach(() => {
        configManager = {
            resourceTypesForUnclassifiedTagging: new Set(['Patient', 'Observation', 'Condition'])
        };
        handler = new UnclassifiedSensitivityTagHandler({ configManager });
    });

    describe('Null security array bypass', () => {
        test('BUG: adds unclassified tag when resource.meta.security is null', async () => {
            // BUG: The handler checks `if (!resource.meta || !resource.meta.security)` which
            // treats null as falsy and returns early WITHOUT adding the unclassified tag.
            // Resources with null security arrays bypass sensitivity-based filtering entirely.
            // CORRECT behavior: null security should be initialized to [] and tag should be added.
            const resource = {
                resourceType: 'Patient',
                meta: { security: null }
            };

            const result = await handler.preSaveAsync({ resource });

            // Correct behavior: the unclassified tag MUST be added
            expect(result.meta.security).not.toBeNull();
            expect(result.meta.security).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        system: SENSITIVE_CATEGORY.SYSTEM,
                        code: SENSITIVE_CATEGORY.UNCLASSIFIED_CODE
                    })
                ])
            );
        });

        test('BUG: adds unclassified tag when resource.meta is present but security is undefined', async () => {
            // Same issue: undefined security causes early return without tagging.
            // CORRECT behavior: should initialize security array and add tag.
            const resource = {
                resourceType: 'Observation',
                meta: { /* security is undefined */ }
            };

            const result = await handler.preSaveAsync({ resource });

            expect(result.meta.security).toBeDefined();
            expect(result.meta.security).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        system: SENSITIVE_CATEGORY.SYSTEM,
                        code: SENSITIVE_CATEGORY.UNCLASSIFIED_CODE
                    })
                ])
            );
        });
    });

    describe('Shared reference mutation leak', () => {
        test('BUG: does not mutate the original tag object in-place (shared reference safety)', async () => {
            // BUG: The handler does `firstUnclassifiedTag.id = generateUUIDv5(...)` which
            // mutates the tag object in-place. If this object is referenced from elsewhere
            // (e.g., shallow copy of the resource), the mutation leaks to external consumers.
            // CORRECT behavior: create a new tag object instead of mutating the existing one.
            const sharedTag = {
                system: SENSITIVE_CATEGORY.SYSTEM,
                code: SENSITIVE_CATEGORY.UNCLASSIFIED_CODE,
                id: 'original-id'
            };

            const resource = {
                resourceType: 'Patient',
                meta: {
                    security: [sharedTag]
                }
            };

            // Keep a reference to the original tag
            const originalId = sharedTag.id;

            await handler.preSaveAsync({ resource });

            // Correct behavior: the original shared tag should NOT have been mutated
            expect(sharedTag.id).toBe(originalId);
        });
    });

    describe('Happy path - tag addition for configured resource types', () => {
        test('adds unclassified tag to resource with empty security array', async () => {
            const resource = {
                resourceType: 'Patient',
                meta: { security: [] }
            };

            const result = await handler.preSaveAsync({ resource });

            expect(result.meta.security).toHaveLength(1);
            expect(result.meta.security[0]).toEqual(
                expect.objectContaining({
                    system: SENSITIVE_CATEGORY.SYSTEM,
                    code: SENSITIVE_CATEGORY.UNCLASSIFIED_CODE
                })
            );
        });

        test('does not add tag for non-configured resource types', async () => {
            const resource = {
                resourceType: 'MedicationRequest',
                meta: { security: [] }
            };

            const result = await handler.preSaveAsync({ resource });

            expect(result.meta.security).toHaveLength(0);
        });

        test('creates Coding instance when resource is instanceof Resource', async () => {
            const resource = Object.create(Resource.prototype);
            resource.resourceType = 'Patient';
            resource.meta = { security: [] };

            const result = await handler.preSaveAsync({ resource });

            expect(result.meta.security).toHaveLength(1);
            expect(result.meta.security[0]._isCoding).toBe(true);
        });
    });

    describe('Duplicate collapse', () => {
        test('collapses multiple unclassified tags to one', async () => {
            const resource = {
                resourceType: 'Patient',
                meta: {
                    security: [
                        { system: SENSITIVE_CATEGORY.SYSTEM, code: SENSITIVE_CATEGORY.UNCLASSIFIED_CODE, id: 'dup-1' },
                        { system: 'http://other-system.com', code: 'other', id: 'keep-me' },
                        { system: SENSITIVE_CATEGORY.SYSTEM, code: SENSITIVE_CATEGORY.UNCLASSIFIED_CODE, id: 'dup-2' },
                        { system: SENSITIVE_CATEGORY.SYSTEM, code: SENSITIVE_CATEGORY.UNCLASSIFIED_CODE, id: 'dup-3' }
                    ]
                }
            };

            const result = await handler.preSaveAsync({ resource });

            const unclassifiedTags = result.meta.security.filter(
                s => s.system === SENSITIVE_CATEGORY.SYSTEM && s.code === SENSITIVE_CATEGORY.UNCLASSIFIED_CODE
            );
            expect(unclassifiedTags).toHaveLength(1);

            // The non-unclassified tag should be preserved
            const otherTags = result.meta.security.filter(s => s.code === 'other');
            expect(otherTags).toHaveLength(1);
        });

        test('preserves single unclassified tag without removing others', async () => {
            const resource = {
                resourceType: 'Observation',
                meta: {
                    security: [
                        { system: 'http://other.com', code: 'restricted', id: 'other-1' },
                        { system: SENSITIVE_CATEGORY.SYSTEM, code: SENSITIVE_CATEGORY.UNCLASSIFIED_CODE, id: 'existing' }
                    ]
                }
            };

            const result = await handler.preSaveAsync({ resource });

            // Should still have exactly 2 entries (no collapse needed, no addition needed)
            expect(result.meta.security).toHaveLength(2);
            const unclassifiedTags = result.meta.security.filter(
                s => s.system === SENSITIVE_CATEGORY.SYSTEM && s.code === SENSITIVE_CATEGORY.UNCLASSIFIED_CODE
            );
            expect(unclassifiedTags).toHaveLength(1);
        });
    });

    describe('suppressUnclassifiedTag option', () => {
        test('does not add unclassified tag when suppressUnclassifiedTag is true', async () => {
            const resource = {
                resourceType: 'Patient',
                meta: { security: [] }
            };

            const result = await handler.preSaveAsync({
                resource,
                options: { suppressUnclassifiedTag: true }
            });

            expect(result.meta.security).toHaveLength(0);
        });

        test('still collapses duplicates even when suppressUnclassifiedTag is true', async () => {
            // suppressUnclassifiedTag only prevents ADDING a new tag; it should not skip
            // the deduplication logic for tags that already exist.
            const resource = {
                resourceType: 'Patient',
                meta: {
                    security: [
                        { system: SENSITIVE_CATEGORY.SYSTEM, code: SENSITIVE_CATEGORY.UNCLASSIFIED_CODE, id: 'dup-1' },
                        { system: SENSITIVE_CATEGORY.SYSTEM, code: SENSITIVE_CATEGORY.UNCLASSIFIED_CODE, id: 'dup-2' }
                    ]
                }
            };

            const result = await handler.preSaveAsync({
                resource,
                options: { suppressUnclassifiedTag: true }
            });

            const unclassifiedTags = result.meta.security.filter(
                s => s.system === SENSITIVE_CATEGORY.SYSTEM && s.code === SENSITIVE_CATEGORY.UNCLASSIFIED_CODE
            );
            expect(unclassifiedTags).toHaveLength(1);
        });
    });
});
