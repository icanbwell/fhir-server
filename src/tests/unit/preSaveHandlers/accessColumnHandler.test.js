'use strict';

const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');
const { AccessColumnHandler } = require('../../../preSaveHandlers/handlers/accessColumnHandler');
const { SecurityTagSystem } = require('../../../utils/securityTagSystem');

describe('AccessColumnHandler', () => {
    let handler;

    beforeEach(() => {
        handler = new AccessColumnHandler();
    });

    describe('preSaveAsync - happy path', () => {
        test('initializes _access from access security tags', async () => {
            const resource = {
                resourceType: 'Patient',
                meta: {
                    security: [
                        { system: SecurityTagSystem.access, code: 'tenantA' }
                    ]
                }
            };

            const result = await handler.preSaveAsync({ resource });

            expect(result._access).toEqual({ tenantA: 1 });
        });

        test('handles multiple access tags', async () => {
            const resource = {
                resourceType: 'Patient',
                meta: {
                    security: [
                        { system: SecurityTagSystem.access, code: 'tenantA' },
                        { system: SecurityTagSystem.access, code: 'tenantB' },
                        { system: SecurityTagSystem.access, code: 'tenantC' }
                    ]
                }
            };

            const result = await handler.preSaveAsync({ resource });

            expect(result._access).toEqual({ tenantA: 1, tenantB: 1, tenantC: 1 });
        });

        test('preserves existing _access entry when it already has correct value', async () => {
            const resource = {
                resourceType: 'Patient',
                meta: {
                    security: [
                        { system: SecurityTagSystem.access, code: 'tenantA' }
                    ]
                },
                _access: { tenantA: 1 }
            };

            const result = await handler.preSaveAsync({ resource });

            expect(result._access).toEqual({ tenantA: 1 });
        });

        test('returns the resource object itself (same reference)', async () => {
            const resource = {
                resourceType: 'Patient',
                meta: {
                    security: [
                        { system: SecurityTagSystem.access, code: 'tenantA' }
                    ]
                }
            };

            const result = await handler.preSaveAsync({ resource });

            expect(result).toBe(resource);
        });

        test('initializes _access as empty object if not present', async () => {
            const resource = {
                resourceType: 'Patient',
                meta: {
                    security: [
                        { system: SecurityTagSystem.access, code: 'tenantA' }
                    ]
                }
            };

            expect(resource._access).toBeUndefined();

            await handler.preSaveAsync({ resource });

            expect(resource._access).toBeDefined();
            expect(resource._access.tenantA).toBe(1);
        });

        test('sets value to 1 for new access codes', async () => {
            const resource = {
                resourceType: 'Patient',
                meta: {
                    security: [
                        { system: SecurityTagSystem.access, code: 'newTenant' }
                    ]
                },
                _access: {}
            };

            const result = await handler.preSaveAsync({ resource });

            expect(result._access.newTenant).toBe(1);
        });

        test('corrects existing _access entry that does not have value 1', async () => {
            const resource = {
                resourceType: 'Patient',
                meta: {
                    security: [
                        { system: SecurityTagSystem.access, code: 'tenantA' }
                    ]
                },
                _access: { tenantA: 0 }
            };

            const result = await handler.preSaveAsync({ resource });

            expect(result._access.tenantA).toBe(1);
        });

        test('corrects access value from string to 1', async () => {
            const resource = {
                resourceType: 'Patient',
                meta: {
                    security: [
                        { system: SecurityTagSystem.access, code: 'tenantA' }
                    ]
                },
                _access: { tenantA: 'wrong' }
            };

            const result = await handler.preSaveAsync({ resource });

            expect(result._access.tenantA).toBe(1);
        });
    });

    describe('preSaveAsync - filtering', () => {
        test('only access-system tags populate _access', async () => {
            const resource = {
                resourceType: 'Patient',
                meta: {
                    security: [
                        { system: SecurityTagSystem.access, code: 'tenantA' },
                        { system: SecurityTagSystem.owner, code: 'ownerX' },
                        { system: SecurityTagSystem.sourceAssigningAuthority, code: 'authY' },
                        { system: SecurityTagSystem.vendor, code: 'vendorZ' }
                    ]
                }
            };

            const result = await handler.preSaveAsync({ resource });

            expect(result._access).toEqual({ tenantA: 1 });
            expect(result._access).not.toHaveProperty('ownerX');
            expect(result._access).not.toHaveProperty('authY');
            expect(result._access).not.toHaveProperty('vendorZ');
        });
    });

    describe('preSaveAsync - removes stale entries', () => {
        test('removes _access entries not in current security tags', async () => {
            const resource = {
                resourceType: 'Patient',
                meta: {
                    security: [
                        { system: SecurityTagSystem.access, code: 'tenantA' }
                    ]
                },
                _access: { tenantA: 1, tenantB: 1 }
            };

            const result = await handler.preSaveAsync({ resource });

            expect(result._access).toEqual({ tenantA: 1 });
            expect(result._access).not.toHaveProperty('tenantB');
        });

        test('removes all old entries when access tags change completely', async () => {
            const resource = {
                resourceType: 'Patient',
                meta: {
                    security: [
                        { system: SecurityTagSystem.access, code: 'tenantC' }
                    ]
                },
                _access: { tenantA: 1, tenantB: 1 }
            };

            const result = await handler.preSaveAsync({ resource });

            expect(result._access).toEqual({ tenantC: 1 });
            expect(result._access).not.toHaveProperty('tenantA');
            expect(result._access).not.toHaveProperty('tenantB');
        });

        test('removes multiple stale entries and adds multiple new ones', async () => {
            const resource = {
                resourceType: 'Patient',
                meta: {
                    security: [
                        { system: SecurityTagSystem.access, code: 'new1' },
                        { system: SecurityTagSystem.access, code: 'new2' }
                    ]
                },
                _access: { old1: 1, old2: 1, old3: 1 }
            };

            const result = await handler.preSaveAsync({ resource });

            expect(result._access).toEqual({ new1: 1, new2: 1 });
        });
    });

    describe('preSaveAsync - stale _access when meta.security is absent', () => {
        test('does not clear _access when resource has no meta at all', async () => {
            const resource = {
                resourceType: 'Patient',
                _access: { tenantA: 1, tenantB: 1 }
            };

            const result = await handler.preSaveAsync({ resource });

            expect(result._access).toEqual({ tenantA: 1, tenantB: 1 });
        });

        test('does not clear _access when resource.meta exists but has no security property', async () => {
            const resource = {
                resourceType: 'Patient',
                meta: { versionId: '1' },
                _access: { tenantA: 1 }
            };

            const result = await handler.preSaveAsync({ resource });

            expect(result._access).toEqual({ tenantA: 1 });
        });

        test('does not clear _access when meta.security is null', async () => {
            const resource = {
                resourceType: 'Patient',
                meta: { security: null },
                _access: { tenantA: 1 }
            };

            const result = await handler.preSaveAsync({ resource });

            expect(result._access).toEqual({ tenantA: 1 });
        });

        test('does not clear _access when meta.security is undefined', async () => {
            const resource = {
                resourceType: 'Patient',
                meta: { security: undefined },
                _access: { tenantA: 1 }
            };

            const result = await handler.preSaveAsync({ resource });

            expect(result._access).toEqual({ tenantA: 1 });
        });

        test('does not clear _access when meta.security is empty array', async () => {
            const resource = {
                resourceType: 'Patient',
                meta: { security: [] },
                _access: { tenantA: 1, tenantB: 1 }
            };

            const result = await handler.preSaveAsync({ resource });

            expect(result._access).toEqual({ tenantA: 1, tenantB: 1 });
        });

        test('does not clear _access when security has tags but none are access system', async () => {
            const resource = {
                resourceType: 'Patient',
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'ownerX' }
                    ]
                },
                _access: { tenantA: 1 }
            };

            const result = await handler.preSaveAsync({ resource });

            expect(result._access).toEqual({ tenantA: 1 });
        });
    });

    describe('preSaveAsync - edge cases', () => {
        test('empty string code creates an empty-string key in _access', async () => {
            const resource = {
                resourceType: 'Patient',
                meta: {
                    security: [
                        { system: SecurityTagSystem.access, code: '' }
                    ]
                }
            };

            const result = await handler.preSaveAsync({ resource });

            expect(result._access).toHaveProperty('', 1);
        });

        test('empty string code mixed with valid codes', async () => {
            const resource = {
                resourceType: 'Patient',
                meta: {
                    security: [
                        { system: SecurityTagSystem.access, code: '' },
                        { system: SecurityTagSystem.access, code: 'tenantA' }
                    ]
                }
            };

            const result = await handler.preSaveAsync({ resource });

            expect(result._access).toHaveProperty('', 1);
            expect(result._access).toHaveProperty('tenantA', 1);
        });

        test('duplicate access codes do not cause issues', async () => {
            const resource = {
                resourceType: 'Patient',
                meta: {
                    security: [
                        { system: SecurityTagSystem.access, code: 'tenantA' },
                        { system: SecurityTagSystem.access, code: 'tenantA' }
                    ]
                }
            };

            const result = await handler.preSaveAsync({ resource });

            expect(result._access).toEqual({ tenantA: 1 });
        });

        test('idempotent - calling preSaveAsync twice produces same result', async () => {
            const resource = {
                resourceType: 'Patient',
                meta: {
                    security: [
                        { system: SecurityTagSystem.access, code: 'tenantA' },
                        { system: SecurityTagSystem.access, code: 'tenantB' }
                    ]
                }
            };

            await handler.preSaveAsync({ resource });
            const firstResult = { ...resource._access };

            await handler.preSaveAsync({ resource });

            expect(resource._access).toEqual(firstResult);
        });

        test('handles special characters in access codes', async () => {
            const resource = {
                resourceType: 'Patient',
                meta: {
                    security: [
                        { system: SecurityTagSystem.access, code: 'tenant.with.dots' },
                        { system: SecurityTagSystem.access, code: 'tenant-with-dashes' },
                        { system: SecurityTagSystem.access, code: 'tenant_with_underscores' }
                    ]
                }
            };

            const result = await handler.preSaveAsync({ resource });

            expect(result._access['tenant.with.dots']).toBe(1);
            expect(result._access['tenant-with-dashes']).toBe(1);
            expect(result._access['tenant_with_underscores']).toBe(1);
        });

        test('preserves existing _access object reference', async () => {
            const existingAccess = { tenantA: 1 };
            const resource = {
                resourceType: 'Patient',
                meta: {
                    security: [
                        { system: SecurityTagSystem.access, code: 'tenantA' },
                        { system: SecurityTagSystem.access, code: 'tenantB' }
                    ]
                },
                _access: existingAccess
            };

            await handler.preSaveAsync({ resource });

            // The same object is reused, not replaced
            expect(resource._access).toBe(existingAccess);
            expect(resource._access.tenantB).toBe(1);
        });
    });
});
