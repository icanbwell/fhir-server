'use strict';

const { describe, test, expect } = require('@jest/globals');
const { DelegatedAccessManager } = require('../../../utils/delegatedAccessManager');
const { ForbiddenError } = require('../../../utils/httpErrors');
const { AUTH_USER_TYPES, DELEGATED_ACCESS } = require('../../../constants');

describe('DelegatedAccessManager', () => {
    const manager = new DelegatedAccessManager();

    describe('isDelegatedUser', () => {
        test('returns true for delegatedUser type', () => {
            expect(manager.isDelegatedUser({ userType: AUTH_USER_TYPES.delegatedUser })).toBe(true);
        });

        test('returns false for regular user type', () => {
            expect(manager.isDelegatedUser({ userType: 'user' })).toBe(false);
        });

        test('returns false for practitioner type', () => {
            expect(manager.isDelegatedUser({ userType: 'practitioner' })).toBe(false);
        });

        test('returns false for null requestInfo', () => {
            expect(manager.isDelegatedUser(null)).toBe(false);
        });

        test('returns false for undefined requestInfo', () => {
            expect(manager.isDelegatedUser(undefined)).toBe(false);
        });

        test('returns false when userType is missing', () => {
            expect(manager.isDelegatedUser({})).toBe(false);
        });

        test('returns false for cmsPartnerUser type', () => {
            expect(manager.isDelegatedUser({ userType: AUTH_USER_TYPES.cmsPartnerUser })).toBe(false);
        });
    });

    describe('verifyAccess', () => {
        test('does nothing for non-delegated users', () => {
            expect(() => manager.verifyAccess({
                requestInfo: { userType: 'user' },
                resourceType: 'Patient',
                operation: 'delete'
            })).not.toThrow();
        });

        test('allows search operation for delegated users', () => {
            expect(() => manager.verifyAccess({
                requestInfo: { userType: AUTH_USER_TYPES.delegatedUser },
                resourceType: 'Patient',
                operation: 'search'
            })).not.toThrow();
        });

        test('allows searchById operation for delegated users', () => {
            expect(() => manager.verifyAccess({
                requestInfo: { userType: AUTH_USER_TYPES.delegatedUser },
                resourceType: 'Observation',
                operation: 'searchById'
            })).not.toThrow();
        });

        test('allows everything operation for delegated users', () => {
            expect(() => manager.verifyAccess({
                requestInfo: { userType: AUTH_USER_TYPES.delegatedUser },
                resourceType: 'Patient',
                operation: 'everything'
            })).not.toThrow();
        });

        test('allows graph operation for delegated users', () => {
            expect(() => manager.verifyAccess({
                requestInfo: { userType: AUTH_USER_TYPES.delegatedUser },
                resourceType: 'Patient',
                operation: 'graph'
            })).not.toThrow();
        });

        test('throws ForbiddenError for create operation', () => {
            expect(() => manager.verifyAccess({
                requestInfo: { userType: AUTH_USER_TYPES.delegatedUser },
                resourceType: 'Patient',
                operation: 'create'
            })).toThrow(/does not have access to CREATE method/);
        });

        test('thrown error has statusCode 403 for disallowed operation', () => {
            try {
                manager.verifyAccess({
                    requestInfo: { userType: AUTH_USER_TYPES.delegatedUser },
                    resourceType: 'Patient',
                    operation: 'create'
                });
                expect(true).toBe(false); // should not reach here
            } catch (e) {
                expect(e.statusCode).toBe(403);
            }
        });

        test('throws ForbiddenError for delete operation', () => {
            expect(() => manager.verifyAccess({
                requestInfo: { userType: AUTH_USER_TYPES.delegatedUser },
                resourceType: 'Patient',
                operation: 'delete'
            })).toThrow(/does not have access to DELETE method/);
        });

        test('throws ForbiddenError for update operation', () => {
            expect(() => manager.verifyAccess({
                requestInfo: { userType: AUTH_USER_TYPES.delegatedUser },
                resourceType: 'Patient',
                operation: 'update'
            })).toThrow(/does not have access to UPDATE method/);
        });

        test('throws ForbiddenError for merge operation', () => {
            expect(() => manager.verifyAccess({
                requestInfo: { userType: AUTH_USER_TYPES.delegatedUser },
                resourceType: 'Patient',
                operation: 'merge'
            })).toThrow(/does not have access to MERGE method/);
        });

        test('throws ForbiddenError for mutation operation (GraphQL)', () => {
            expect(() => manager.verifyAccess({
                requestInfo: { userType: AUTH_USER_TYPES.delegatedUser },
                resourceType: 'Patient',
                operation: 'mutation'
            })).toThrow(/does not have access to MUTATION method/);
        });

        test('throws ForbiddenError for patch operation', () => {
            expect(() => manager.verifyAccess({
                requestInfo: { userType: AUTH_USER_TYPES.delegatedUser },
                resourceType: 'Patient',
                operation: 'patch'
            })).toThrow(/does not have access to PATCH method/);
        });

        test('does not check resourceType for delegated users', () => {
            expect(() => manager.verifyAccess({
                requestInfo: { userType: AUTH_USER_TYPES.delegatedUser },
                resourceType: 'AnyRandomResource',
                operation: 'search'
            })).not.toThrow();
        });

        test('all ALLOWED_OPERATIONS pass verification', () => {
            for (const op of DELEGATED_ACCESS.ALLOWED_OPERATIONS) {
                expect(() => manager.verifyAccess({
                    requestInfo: { userType: AUTH_USER_TYPES.delegatedUser },
                    resourceType: 'Patient',
                    operation: op
                })).not.toThrow();
            }
        });

        test('non-delegated users can perform any write operation', () => {
            const writeOps = ['create', 'update', 'delete', 'mutation', 'merge', 'patch'];
            for (const op of writeOps) {
                expect(() => manager.verifyAccess({
                    requestInfo: { userType: 'user' },
                    resourceType: 'Patient',
                    operation: op
                })).not.toThrow();
            }
        });
    });
});
