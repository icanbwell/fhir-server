const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../utils/uid.util', () => ({
    generateUUIDv5: jestObj.fn((input) => `uuid-for-${input}`)
}));

jestObj.mock('../../../fhir/classes/4_0_0/complex_types/coding', () => {
    return jestObj.fn((props) => ({ ...props, _isCoding: true }));
});

jestObj.mock('../../../fhir/classes/4_0_0/resources/resource', () => {
    class MockResource {}
    return MockResource;
});

jestObj.mock('../../../preSaveHandlers/handlers/preSaveHandler', () => ({
    PreSaveHandler: class PreSaveHandler {}
}));

const { UnclassifiedSensitivityTagHandler } = require('../../../preSaveHandlers/handlers/unclassifiedSensitivityTagHandler');
const { SENSITIVE_CATEGORY } = require('../../../constants');
const Resource = require('../../../fhir/classes/4_0_0/resources/resource');

describe('UnclassifiedSensitivityTagHandler', () => {
    let handler;
    let configManager;

    beforeEach(() => {
        configManager = {
            resourceTypesForUnclassifiedTagging: new Set(['Patient', 'Observation', 'Condition'])
        };
        handler = new UnclassifiedSensitivityTagHandler({ configManager });
    });

    describe('constructor', () => {
        test('stores configManager reference', () => {
            expect(handler.configManager).toBe(configManager);
        });
    });

    describe('preSaveAsync - resource type filtering', () => {
        test('returns resource unchanged when resourceType is not in configured set', async () => {
            const resource = {
                resourceType: 'MedicationRequest',
                meta: { security: [] }
            };

            const result = await handler.preSaveAsync({ resource });

            expect(result).toBe(resource);
            expect(result.meta.security).toHaveLength(0);
        });

        test('processes resource when resourceType is in configured set', async () => {
            const resource = {
                resourceType: 'Patient',
                meta: { security: [] }
            };

            const result = await handler.preSaveAsync({ resource });

            expect(result.meta.security).toHaveLength(1);
        });
    });

    describe('preSaveAsync - early return for missing meta/security', () => {
        test('returns resource unchanged when meta is falsy', async () => {
            const resource = {
                resourceType: 'Patient',
                meta: null
            };

            const result = await handler.preSaveAsync({ resource });

            expect(result).toBe(resource);
            expect(result.meta).toBeNull();
        });

        test('returns resource unchanged when meta is undefined', async () => {
            const resource = {
                resourceType: 'Patient'
            };

            const result = await handler.preSaveAsync({ resource });

            expect(result).toBe(resource);
        });

        test('returns resource unchanged when meta.security is null', async () => {
            const resource = {
                resourceType: 'Patient',
                meta: { security: null }
            };

            const result = await handler.preSaveAsync({ resource });

            expect(result).toBe(resource);
            expect(result.meta.security).toBeNull();
        });

        test('returns resource unchanged when meta.security is undefined', async () => {
            const resource = {
                resourceType: 'Observation',
                meta: {}
            };

            const result = await handler.preSaveAsync({ resource });

            expect(result).toBe(resource);
        });
    });

    describe('preSaveAsync - adding unclassified tag', () => {
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

        test('adds tag with deterministic id from generateUUIDv5', async () => {
            const resource = {
                resourceType: 'Patient',
                meta: { security: [] }
            };

            const result = await handler.preSaveAsync({ resource });

            expect(result.meta.security[0].id).toBe(
                `uuid-for-${SENSITIVE_CATEGORY.SYSTEM}|${SENSITIVE_CATEGORY.UNCLASSIFIED_CODE}`
            );
        });

        test('creates Coding instance when resource is instanceof Resource', async () => {
            const resource = Object.create(Resource.prototype);
            resource.resourceType = 'Patient';
            resource.meta = { security: [] };

            const result = await handler.preSaveAsync({ resource });

            expect(result.meta.security).toHaveLength(1);
            expect(result.meta.security[0]._isCoding).toBe(true);
        });

        test('creates plain object when resource is NOT instanceof Resource', async () => {
            const resource = {
                resourceType: 'Patient',
                meta: { security: [] }
            };

            const result = await handler.preSaveAsync({ resource });

            expect(result.meta.security[0]._isCoding).toBeUndefined();
            expect(result.meta.security[0].system).toBe(SENSITIVE_CATEGORY.SYSTEM);
            expect(result.meta.security[0].code).toBe(SENSITIVE_CATEGORY.UNCLASSIFIED_CODE);
        });

        test('preserves existing non-unclassified security tags when adding', async () => {
            const resource = {
                resourceType: 'Patient',
                meta: {
                    security: [
                        { system: 'http://other.com', code: 'restricted', id: 'other-1' }
                    ]
                }
            };

            const result = await handler.preSaveAsync({ resource });

            expect(result.meta.security).toHaveLength(2);
            expect(result.meta.security[0].code).toBe('restricted');
        });
    });

    describe('preSaveAsync - existing unclassified tag handling', () => {
        test('sets id on existing single unclassified tag', async () => {
            const resource = {
                resourceType: 'Observation',
                meta: {
                    security: [
                        { system: SENSITIVE_CATEGORY.SYSTEM, code: SENSITIVE_CATEGORY.UNCLASSIFIED_CODE }
                    ]
                }
            };

            const result = await handler.preSaveAsync({ resource });

            expect(result.meta.security).toHaveLength(1);
            expect(result.meta.security[0].id).toBe(
                `uuid-for-${SENSITIVE_CATEGORY.SYSTEM}|${SENSITIVE_CATEGORY.UNCLASSIFIED_CODE}`
            );
        });

        test('preserves single unclassified tag alongside other tags', async () => {
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

            expect(result.meta.security).toHaveLength(2);
            const unclassified = result.meta.security.filter(
                s => s.system === SENSITIVE_CATEGORY.SYSTEM && s.code === SENSITIVE_CATEGORY.UNCLASSIFIED_CODE
            );
            expect(unclassified).toHaveLength(1);
        });
    });

    describe('preSaveAsync - duplicate collapse', () => {
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

        test('collapsed tag gets correct deterministic id', async () => {
            const resource = {
                resourceType: 'Patient',
                meta: {
                    security: [
                        { system: SENSITIVE_CATEGORY.SYSTEM, code: SENSITIVE_CATEGORY.UNCLASSIFIED_CODE, id: 'old-1' },
                        { system: SENSITIVE_CATEGORY.SYSTEM, code: SENSITIVE_CATEGORY.UNCLASSIFIED_CODE, id: 'old-2' }
                    ]
                }
            };

            const result = await handler.preSaveAsync({ resource });

            const unclassified = result.meta.security.find(
                s => s.system === SENSITIVE_CATEGORY.SYSTEM && s.code === SENSITIVE_CATEGORY.UNCLASSIFIED_CODE
            );
            expect(unclassified.id).toBe(
                `uuid-for-${SENSITIVE_CATEGORY.SYSTEM}|${SENSITIVE_CATEGORY.UNCLASSIFIED_CODE}`
            );
        });

        test('deduplicated tag is pushed at end of security array', async () => {
            const resource = {
                resourceType: 'Patient',
                meta: {
                    security: [
                        { system: SENSITIVE_CATEGORY.SYSTEM, code: SENSITIVE_CATEGORY.UNCLASSIFIED_CODE, id: 'dup-1' },
                        { system: 'http://other.com', code: 'otherCode', id: 'keep' },
                        { system: SENSITIVE_CATEGORY.SYSTEM, code: SENSITIVE_CATEGORY.UNCLASSIFIED_CODE, id: 'dup-2' }
                    ]
                }
            };

            const result = await handler.preSaveAsync({ resource });

            const lastTag = result.meta.security[result.meta.security.length - 1];
            expect(lastTag.system).toBe(SENSITIVE_CATEGORY.SYSTEM);
            expect(lastTag.code).toBe(SENSITIVE_CATEGORY.UNCLASSIFIED_CODE);
        });
    });

    describe('preSaveAsync - suppressUnclassifiedTag option', () => {
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

        test('suppressUnclassifiedTag false does not prevent tag addition', async () => {
            const resource = {
                resourceType: 'Patient',
                meta: { security: [] }
            };

            const result = await handler.preSaveAsync({
                resource,
                options: { suppressUnclassifiedTag: false }
            });

            expect(result.meta.security).toHaveLength(1);
        });

        test('no options object provided still adds tag', async () => {
            const resource = {
                resourceType: 'Condition',
                meta: { security: [] }
            };

            const result = await handler.preSaveAsync({ resource });

            expect(result.meta.security).toHaveLength(1);
            expect(result.meta.security[0].system).toBe(SENSITIVE_CATEGORY.SYSTEM);
        });

        test('options object without suppressUnclassifiedTag adds tag', async () => {
            const resource = {
                resourceType: 'Condition',
                meta: { security: [] }
            };

            const result = await handler.preSaveAsync({
                resource,
                options: {}
            });

            expect(result.meta.security).toHaveLength(1);
        });
    });

    describe('preSaveAsync - in-place mutation behavior', () => {
        test('mutates the existing first unclassified tag id in place', async () => {
            const existingTag = {
                system: SENSITIVE_CATEGORY.SYSTEM,
                code: SENSITIVE_CATEGORY.UNCLASSIFIED_CODE,
                id: 'original-id'
            };
            const resource = {
                resourceType: 'Patient',
                meta: { security: [existingTag] }
            };

            await handler.preSaveAsync({ resource });

            // The handler mutates the first unclassified tag in place
            expect(existingTag.id).toBe(
                `uuid-for-${SENSITIVE_CATEGORY.SYSTEM}|${SENSITIVE_CATEGORY.UNCLASSIFIED_CODE}`
            );
        });
    });
});
