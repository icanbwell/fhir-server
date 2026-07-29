'use strict';

const { describe, test, expect, jest: jestObj, beforeEach } = require('@jest/globals');

// Mock assertTypeEquals to be a no-op
jestObj.mock('../../../utils/assertType', () => ({
    assertTypeEquals: jestObj.fn()
}));

// Mock generateUUIDv5 to return a predictable value for testing
jestObj.mock('../../../utils/uid.util', () => ({
    generateUUIDv5: jestObj.fn((name) => `uuid5-for-${name}`)
}));

jestObj.mock('../../../fhir/classes/4_0_0/resources/resource', () => class Resource {});

jestObj.mock('../../../fhir/classes/4_0_0/complex_types/coding', () => {
    return class Coding {
        constructor(props) {
            Object.assign(this, props);
        }
    };
});

const { OwnerColumnHandler } = require('../../../preSaveHandlers/handlers/ownerColumnHandler');
const { SecurityTagSystem } = require('../../../utils/securityTagSystem');
const { generateUUIDv5 } = require('../../../utils/uid.util');
const Resource = require('../../../fhir/classes/4_0_0/resources/resource');

describe('OwnerColumnHandler', () => {
    let handler;
    let configManager;

    beforeEach(() => {
        configManager = {
            preSaveCodingIdUpdateResources: ['Observation', 'Patient']
        };
        handler = new OwnerColumnHandler({ configManager });
        jestObj.clearAllMocks();
    });

    describe('constructor', () => {
        test('creates codingIdResourceTypes Set from config', () => {
            expect(handler.codingIdResourceTypes).toBeInstanceOf(Set);
            expect(handler.codingIdResourceTypes.has('Observation')).toBe(true);
            expect(handler.codingIdResourceTypes.has('Patient')).toBe(true);
        });

        test('handles empty preSaveCodingIdUpdateResources array', () => {
            const h = new OwnerColumnHandler({
                configManager: { preSaveCodingIdUpdateResources: [] }
            });
            expect(h.codingIdResourceTypes.size).toBe(0);
        });
    });

    describe('preSaveAsync - adds owner tag from access code', () => {
        test('adds owner tag from first access code when owner is missing', async () => {
            const resource = {
                resourceType: 'Observation',
                meta: {
                    security: [
                        { system: SecurityTagSystem.access, code: 'tenant_a' }
                    ]
                }
            };

            const result = await handler.preSaveAsync({ resource });

            const ownerTags = result.meta.security.filter(
                s => s.system === SecurityTagSystem.owner
            );
            expect(ownerTags).toHaveLength(1);
            expect(ownerTags[0].code).toBe('tenant_a');
        });

        test('adds owner tag with Coding instance when resource is instanceof Resource', async () => {
            const resource = new Resource();
            resource.resourceType = 'Patient';
            resource.meta = {
                security: [
                    { system: SecurityTagSystem.access, code: 'my_org' }
                ]
            };

            const result = await handler.preSaveAsync({ resource });

            const ownerTags = result.meta.security.filter(
                s => s.system === SecurityTagSystem.owner
            );
            expect(ownerTags).toHaveLength(1);
            expect(ownerTags[0].system).toBe(SecurityTagSystem.owner);
            expect(ownerTags[0].code).toBe('my_org');
        });

        test('uses buildOwnerTag for plain objects (non-Resource)', async () => {
            const resource = {
                resourceType: 'Observation',
                meta: {
                    security: [
                        { system: SecurityTagSystem.access, code: 'tenant_x' }
                    ]
                }
            };

            const result = await handler.preSaveAsync({ resource });

            const ownerTag = result.meta.security.find(
                s => s.system === SecurityTagSystem.owner
            );
            // Observation is in codingIdResourceTypes, so id should be generated
            expect(ownerTag.id).toBe(`uuid5-for-${SecurityTagSystem.owner}|tenant_x`);
            expect(ownerTag.code).toBe('tenant_x');
        });

        test('plain object owner tag has no id for unconfigured resource type', async () => {
            const resource = {
                resourceType: 'Encounter',
                meta: {
                    security: [
                        { system: SecurityTagSystem.access, code: 'org_y' }
                    ]
                }
            };

            const result = await handler.preSaveAsync({ resource });

            const ownerTag = result.meta.security.find(
                s => s.system === SecurityTagSystem.owner
            );
            expect(ownerTag.id).toBeUndefined();
            expect(ownerTag.code).toBe('org_y');
        });

        test('uses first access code when multiple access codes exist', async () => {
            const resource = {
                resourceType: 'Observation',
                meta: {
                    security: [
                        { system: SecurityTagSystem.access, code: 'tenant_a' },
                        { system: SecurityTagSystem.access, code: 'tenant_b' }
                    ]
                }
            };

            const result = await handler.preSaveAsync({ resource });

            const ownerTags = result.meta.security.filter(
                s => s.system === SecurityTagSystem.owner
            );
            expect(ownerTags).toHaveLength(1);
            expect(ownerTags[0].code).toBe('tenant_a');
        });

        test('different tag order produces different owner (first access code wins)', async () => {
            const resourceBA = {
                resourceType: 'Observation',
                meta: {
                    security: [
                        { system: SecurityTagSystem.access, code: 'tenant_b' },
                        { system: SecurityTagSystem.access, code: 'tenant_a' }
                    ]
                }
            };

            const resultBA = await handler.preSaveAsync({ resource: resourceBA });

            const ownerBA = resultBA.meta.security.find(
                s => s.system === SecurityTagSystem.owner
            );
            expect(ownerBA.code).toBe('tenant_b');
        });
    });

    describe('preSaveAsync - existing owner is NOT overwritten', () => {
        test('preserves existing owner even if access codes differ', async () => {
            const resource = {
                resourceType: 'Observation',
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'original_owner' },
                        { system: SecurityTagSystem.access, code: 'different_tenant' }
                    ]
                }
            };

            const result = await handler.preSaveAsync({ resource });

            const ownerTags = result.meta.security.filter(
                s => s.system === SecurityTagSystem.owner
            );
            expect(ownerTags).toHaveLength(1);
            expect(ownerTags[0].code).toBe('original_owner');
        });

        test('does not add a second owner when one already exists', async () => {
            const resource = {
                resourceType: 'Patient',
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'existing_owner' },
                        { system: SecurityTagSystem.access, code: 'access_a' },
                        { system: SecurityTagSystem.access, code: 'access_b' }
                    ]
                }
            };

            const result = await handler.preSaveAsync({ resource });

            const ownerTags = result.meta.security.filter(
                s => s.system === SecurityTagSystem.owner
            );
            expect(ownerTags).toHaveLength(1);
            expect(ownerTags[0].code).toBe('existing_owner');
        });

        test('preserves multiple existing owner tags without adding new ones', async () => {
            const resource = {
                resourceType: 'Patient',
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'owner_1' },
                        { system: SecurityTagSystem.owner, code: 'owner_2' },
                        { system: SecurityTagSystem.access, code: 'access_a' }
                    ]
                }
            };

            const result = await handler.preSaveAsync({ resource });

            const ownerTags = result.meta.security.filter(
                s => s.system === SecurityTagSystem.owner
            );
            expect(ownerTags).toHaveLength(2);
        });
    });

    describe('preSaveAsync - no access codes', () => {
        test('does not add owner when there are no access codes', async () => {
            const resource = {
                resourceType: 'Observation',
                meta: {
                    security: [
                        { system: SecurityTagSystem.vendor, code: 'some_vendor' }
                    ]
                }
            };

            const result = await handler.preSaveAsync({ resource });

            const ownerTags = result.meta.security.filter(
                s => s.system === SecurityTagSystem.owner
            );
            expect(ownerTags).toHaveLength(0);
        });

        test('does not add owner when security array is empty', async () => {
            const resource = {
                resourceType: 'Patient',
                meta: { security: [] }
            };

            const result = await handler.preSaveAsync({ resource });

            expect(result.meta.security).toHaveLength(0);
        });
    });

    describe('preSaveAsync - null/undefined meta.security', () => {
        test('returns resource unchanged when meta is undefined', async () => {
            const resource = { resourceType: 'Patient' };

            const result = await handler.preSaveAsync({ resource });

            expect(result).toBe(resource);
            expect(result.meta).toBeUndefined();
        });

        test('returns resource unchanged when meta.security is null', async () => {
            const resource = { resourceType: 'Patient', meta: { security: null } };

            const result = await handler.preSaveAsync({ resource });

            expect(result).toBe(resource);
            expect(result.meta.security).toBeNull();
        });

        test('returns resource unchanged when meta.security is undefined', async () => {
            const resource = { resourceType: 'Patient', meta: {} };

            const result = await handler.preSaveAsync({ resource });

            expect(result).toBe(resource);
            expect(result.meta.security).toBeUndefined();
        });

        test('returns resource unchanged when meta is null', async () => {
            const resource = { resourceType: 'Patient', meta: null };

            const result = await handler.preSaveAsync({ resource });

            expect(result).toBe(resource);
        });
    });

    describe('preSaveAsync - return value', () => {
        test('returns the same resource reference (same object)', async () => {
            const resource = {
                resourceType: 'Patient',
                meta: {
                    security: [
                        { system: SecurityTagSystem.access, code: 'tenant_a' }
                    ]
                }
            };

            const result = await handler.preSaveAsync({ resource });

            expect(result).toBe(resource);
        });
    });

    describe('buildOwnerTag', () => {
        test('generates ID for configured resource types', () => {
            const tag = handler.buildOwnerTag('Observation', 'my_org');

            expect(tag.system).toBe(SecurityTagSystem.owner);
            expect(tag.code).toBe('my_org');
            expect(tag.id).toBe(`uuid5-for-${SecurityTagSystem.owner}|my_org`);
            expect(generateUUIDv5).toHaveBeenCalledWith(
                `${SecurityTagSystem.owner}|my_org`
            );
        });

        test('generates ID when Resource is in configured list', () => {
            const handlerWithResource = new OwnerColumnHandler({
                configManager: { preSaveCodingIdUpdateResources: ['Resource'] }
            });

            const tag = handlerWithResource.buildOwnerTag('AnyType', 'some_code');

            expect(tag.id).toBe(`uuid5-for-${SecurityTagSystem.owner}|some_code`);
        });

        test('does NOT generate ID for unconfigured resource types', () => {
            const tag = handler.buildOwnerTag('Encounter', 'org_x');

            expect(tag.system).toBe(SecurityTagSystem.owner);
            expect(tag.code).toBe('org_x');
            expect(tag.id).toBeUndefined();
            expect(generateUUIDv5).not.toHaveBeenCalled();
        });

        test('produces same ID for same input (deterministic)', () => {
            const tag1 = handler.buildOwnerTag('Patient', 'tenant_a');
            const tag2 = handler.buildOwnerTag('Patient', 'tenant_a');

            expect(tag1.id).toBe(tag2.id);
        });

        test('produces different IDs for different codes', () => {
            const tag1 = handler.buildOwnerTag('Patient', 'tenant_a');
            const tag2 = handler.buildOwnerTag('Patient', 'tenant_b');

            expect(tag1.id).not.toBe(tag2.id);
        });

        test('tag has correct structure with id', () => {
            const tag = handler.buildOwnerTag('Patient', 'my_tenant');

            expect(Object.keys(tag).sort()).toEqual(['code', 'id', 'system']);
        });

        test('tag has correct structure without id', () => {
            const tag = handler.buildOwnerTag('Encounter', 'my_tenant');

            expect(Object.keys(tag).sort()).toEqual(['code', 'system']);
        });
    });
});
