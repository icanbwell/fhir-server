const { describe, test, expect, beforeEach } = require('@jest/globals');
const { AccessColumnHandler } = require('../../../preSaveHandlers/handlers/accessColumnHandler');
const { SecurityTagSystem } = require('../../../utils/securityTagSystem');

describe('AccessColumnHandler', () => {
    let handler;

    beforeEach(() => {
        handler = new AccessColumnHandler();
    });

    describe('preSaveAsync', () => {
        describe('CRITICAL: stale _access when meta.security is absent', () => {
            test('does not clear _access when resource has no meta at all', async () => {
                const resource = {
                    resourceType: 'Patient',
                    _access: { tenantA: 1, tenantB: 1 }
                };

                const result = await handler.preSaveAsync({ resource });

                // BUG: stale _access persists because handler only acts when meta.security exists
                expect(result._access).toEqual({ tenantA: 1, tenantB: 1 });
            });

            test('does not clear _access when resource.meta exists but has no security property', async () => {
                const resource = {
                    resourceType: 'Patient',
                    meta: { versionId: '1' },
                    _access: { tenantA: 1 }
                };

                const result = await handler.preSaveAsync({ resource });

                // BUG: stale _access persists
                expect(result._access).toEqual({ tenantA: 1 });
            });
        });

        describe('CRITICAL: only access-system tags populate _access', () => {
            test('non-access security tags do not leak into _access', async () => {
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

            test('multiple access tags all appear in _access', async () => {
                const resource = {
                    resourceType: 'Patient',
                    meta: {
                        security: [
                            { system: SecurityTagSystem.access, code: 'tenantA' },
                            { system: SecurityTagSystem.access, code: 'tenantB' },
                            { system: SecurityTagSystem.owner, code: 'ownerX' }
                        ]
                    }
                };

                const result = await handler.preSaveAsync({ resource });

                expect(result._access).toEqual({ tenantA: 1, tenantB: 1 });
            });
        });

        describe('CRITICAL: subset of previous access tags removes old entries', () => {
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
        });

        describe('BUG: meta.security is null or undefined leaves stale _access', () => {
            test('does not clear _access when meta.security is null', async () => {
                const resource = {
                    resourceType: 'Patient',
                    meta: { security: null },
                    _access: { tenantA: 1 }
                };

                const result = await handler.preSaveAsync({ resource });

                // BUG: stale _access persists because null is falsy
                expect(result._access).toEqual({ tenantA: 1 });
            });

            test('does not clear _access when meta.security is undefined', async () => {
                const resource = {
                    resourceType: 'Patient',
                    meta: { security: undefined },
                    _access: { tenantA: 1 }
                };

                const result = await handler.preSaveAsync({ resource });

                // BUG: stale _access persists because undefined is falsy
                expect(result._access).toEqual({ tenantA: 1 });
            });
        });

        describe('BUG: empty security array leaves stale _access', () => {
            test('does not clear _access when meta.security is empty array', async () => {
                const resource = {
                    resourceType: 'Patient',
                    meta: { security: [] },
                    _access: { tenantA: 1, tenantB: 1 }
                };

                const result = await handler.preSaveAsync({ resource });

                // BUG: accessCodes is empty so handler skips, stale _access persists
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

                // BUG: no access-system tags means accessCodes is empty, stale _access persists
                expect(result._access).toEqual({ tenantA: 1 });
            });
        });

        describe('BUG: empty string access code creates meaningless _access key', () => {
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

                // BUG: empty string becomes a key, could match unintended queries
                expect(result._access).toHaveProperty('', 1);
            });

            test('empty string code mixed with valid codes still creates empty key', async () => {
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
        });

        describe('happy path', () => {
            test('initializes _access when not present on resource', async () => {
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
        });
    });
});
