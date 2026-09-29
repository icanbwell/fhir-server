'use strict';

/**
 * SEC-1580 BB.3 #11 - AccessColumnHandler never cleared the denormalized `_access` field when
 * access tags were removed from meta.security.
 *
 * `_access` is not a cache - it is a query surface. `securityTagManager.getQueryWithSecurityTags()`
 * filters on `{ '_access.<tagcode>': 1 }` whenever the access index is in use, so a stale
 * `_access` entry keeps a resource readable by a tenant whose access tag has already been revoked.
 * That makes it a permanent cross-tenant read, not a transient staleness window.
 *
 * The bug was that the stale-entry removal loop lived inside `if (accessCodes.length > 0)`, so it
 * only ever ran when at least one access tag survived. Removing the last access tag - or replacing
 * the access tags with tags of a different system - skipped removal entirely.
 *
 * Oracle: bwell-business-logic-master.md
 *   §3  Security Tag System
 *   §67 Fail-Open vs Fail-Closed Classification
 *   §110 Pre-Save Handler Chain (All Resources)
 */

const { describe, test, expect, beforeEach } = require('@jest/globals');
const { AccessColumnHandler } = require('../../../preSaveHandlers/handlers/accessColumnHandler');
const { SecurityTagSystem } = require('../../../utils/securityTagSystem');

describe('AccessColumnHandler - _access stays synchronized with meta.security (SEC-1580 BB.3 #11)', () => {
    let handler;

    beforeEach(() => {
        handler = new AccessColumnHandler();
    });

    describe('revoking access tags revokes _access', () => {
        test('removing the only access tag empties _access', async () => {
            const resource = {
                resourceType: 'Observation',
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'clientA' }
                    ]
                },
                // what was written on a previous save, when clientA still had an access tag
                _access: { clientA: 1 }
            };

            const result = await handler.preSaveAsync({ resource });

            // §3: "The internal `_access` field MUST be exactly synchronized with meta.security
            // access tags. For each access code, `_access[code]` = 1. Stale codes MUST be deleted."
            expect(result._access).toEqual({});
            expect(result._access).not.toHaveProperty('clientA');
        });

        test('removing every access tag empties _access even when several were present', async () => {
            const resource = {
                resourceType: 'Observation',
                meta: { security: [] },
                _access: { clientA: 1, clientB: 1, clientC: 1 }
            };

            const result = await handler.preSaveAsync({ resource });

            // §67: "FAIL CLOSED: ... Resources with no access tag visible to nobody." A surviving
            // _access entry is exactly the "visible to somebody" outcome that must not happen.
            expect(result._access).toEqual({});
        });

        test('revoking one of two access tags drops only the revoked code', async () => {
            const resource = {
                resourceType: 'Observation',
                meta: {
                    security: [
                        { system: SecurityTagSystem.access, code: 'clientA' }
                    ]
                },
                _access: { clientA: 1, clientB: 1 }
            };

            const result = await handler.preSaveAsync({ resource });

            // §3: exact synchronization - clientA retained, clientB deleted.
            expect(result._access).toEqual({ clientA: 1 });
        });

        test('replacing access tags with non-access tags of the same system family empties _access', async () => {
            const resource = {
                resourceType: 'Observation',
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'clientA' },
                        { system: SecurityTagSystem.sourceAssigningAuthority, code: 'clientA' },
                        { system: SecurityTagSystem.vendor, code: 'vendorX' }
                    ]
                },
                _access: { clientA: 1 }
            };

            const result = await handler.preSaveAsync({ resource });

            // §3: only tags whose system is the access system produce _access entries. An owner or
            // sourceAssigningAuthority tag with the same code does NOT keep read access alive.
            expect(result._access).toEqual({});
        });
    });

    describe('cross-tenant revocation scenario', () => {
        test('un-sharing a resource from clientB removes clientB from the access-index surface', async () => {
            // clientA owns the resource and had shared it with clientB.
            const resource = {
                resourceType: 'Condition',
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'clientA' },
                        { system: SecurityTagSystem.access, code: 'clientA' }
                    ]
                },
                _access: { clientA: 1, clientB: 1 }
            };

            const result = await handler.preSaveAsync({ resource });

            // §3 + §2: tenant isolation is enforced by security tags on EVERY query path. The
            // access-index path filters on `_access.<code>`, so clientB must not remain there once
            // its access tag is gone - otherwise the un-share never takes effect for that path.
            expect(result._access).toEqual({ clientA: 1 });
            expect(result._access).not.toHaveProperty('clientB');
        });
    });

    describe('absent meta.security is not a statement about access', () => {
        // meta.security absent entirely means the caller supplied no access information, which is
        // different from supplying an empty list. Leaving _access untouched there is intentional:
        // it avoids stripping access from a resource whose meta was simply not loaded.
        test.each([
            ['no meta at all', { resourceType: 'Patient', _access: { clientA: 1 } }],
            ['meta without security', { resourceType: 'Patient', meta: { versionId: '1' }, _access: { clientA: 1 } }],
            ['meta.security null', { resourceType: 'Patient', meta: { security: null }, _access: { clientA: 1 } }]
        ])('leaves _access untouched when %s', async (_label, resource) => {
            const result = await handler.preSaveAsync({ resource });

            expect(result._access).toEqual({ clientA: 1 });
        });
    });

    describe('idempotency', () => {
        test('running twice after a revocation is stable', async () => {
            const resource = {
                resourceType: 'Observation',
                meta: {
                    security: [
                        { system: SecurityTagSystem.access, code: 'clientA' }
                    ]
                },
                _access: { clientA: 1, clientB: 1 }
            };

            await handler.preSaveAsync({ resource });
            const afterFirst = { ...resource._access };
            await handler.preSaveAsync({ resource });

            // §110: the pre-save chain runs on every write; repeated runs must converge.
            expect(resource._access).toEqual(afterFirst);
            expect(resource._access).toEqual({ clientA: 1 });
        });
    });
});
