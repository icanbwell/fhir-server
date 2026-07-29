const { describe, test, expect, jest, beforeEach } = require('@jest/globals');

// Mock assertTypeEquals to be a no-op
jest.mock('../../../utils/assertType', () => ({
    assertTypeEquals: jest.fn()
}));

// Mock generateUUIDv5 to return a predictable value for testing
jest.mock('../../../utils/uid.util', () => ({
    generateUUIDv5: jest.fn((name) => `uuid5-for-${name}`)
}));

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
        jest.clearAllMocks();
    });

    describe('preSaveAsync - happy path', () => {
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
            const resource = Object.create(Resource.prototype);
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
    });

    describe('BUG: tag ordering determines ownership', () => {
        test('uses first access code as owner when multiple exist - order matters', async () => {
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
            // Documents that the FIRST access code becomes owner
            expect(ownerTags[0].code).toBe('tenant_a');
        });

        test('different tag order produces different owner - demonstrates ordering dependency', async () => {
            const resourceOrderAB = {
                resourceType: 'Observation',
                meta: {
                    security: [
                        { system: SecurityTagSystem.access, code: 'tenant_a' },
                        { system: SecurityTagSystem.access, code: 'tenant_b' }
                    ]
                }
            };

            const resourceOrderBA = {
                resourceType: 'Observation',
                meta: {
                    security: [
                        { system: SecurityTagSystem.access, code: 'tenant_b' },
                        { system: SecurityTagSystem.access, code: 'tenant_a' }
                    ]
                }
            };

            const resultAB = await handler.preSaveAsync({ resource: resourceOrderAB });
            const resultBA = await handler.preSaveAsync({ resource: resourceOrderBA });

            const ownerAB = resultAB.meta.security.find(
                s => s.system === SecurityTagSystem.owner
            );
            const ownerBA = resultBA.meta.security.find(
                s => s.system === SecurityTagSystem.owner
            );

            // This assertion proves the bug: different ordering yields different owners
            expect(ownerAB.code).not.toBe(ownerBA.code);
            expect(ownerAB.code).toBe('tenant_a');
            expect(ownerBA.code).toBe('tenant_b');
        });
    });

    describe('BUG: no validation of existing owner against access codes', () => {
        test('owner remains unchanged even when it does not match any access code', async () => {
            const resource = {
                resourceType: 'Patient',
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'victim_tenant' },
                        { system: SecurityTagSystem.access, code: 'attacker_tenant' }
                    ]
                }
            };

            const result = await handler.preSaveAsync({ resource });

            const ownerTags = result.meta.security.filter(
                s => s.system === SecurityTagSystem.owner
            );
            // Documents the bug: owner is never validated against access codes
            expect(ownerTags).toHaveLength(1);
            expect(ownerTags[0].code).toBe('victim_tenant');

            // The access code does NOT match the owner - inconsistency is allowed
            const accessCodes = result.meta.security
                .filter(s => s.system === SecurityTagSystem.access)
                .map(s => s.code);
            expect(accessCodes).not.toContain('victim_tenant');
        });
    });

    describe('BUG: null/undefined meta.security', () => {
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
            // No owner tag was added despite having meta
            expect(result.meta.security).toBeNull();
        });

        test('returns resource unchanged when meta.security is undefined', async () => {
            const resource = { resourceType: 'Patient', meta: {} };

            const result = await handler.preSaveAsync({ resource });

            expect(result).toBe(resource);
            expect(result.meta.security).toBeUndefined();
        });

        test('returns resource unchanged when meta.security is empty array', async () => {
            const resource = { resourceType: 'Patient', meta: { security: [] } };

            const result = await handler.preSaveAsync({ resource });

            expect(result).toBe(resource);
            expect(result.meta.security).toHaveLength(0);
        });
    });

    describe('buildOwnerTag - deterministic ID generation', () => {
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
    });
});
