'use strict';

const { describe, test, expect, afterEach } = require('@jest/globals');
const { DelegatedAccessManager } = require('../../../utils/delegatedAccessManager');
const { ConfigManager } = require('../../../utils/configManager');
const { ForbiddenError } = require('../../../utils/httpErrors');
const { AUTH_USER_TYPES, DELEGATED_ACCESS } = require('../../../constants');

describe('DelegatedAccessManager', () => {
    const manager = new DelegatedAccessManager({ configManager: new ConfigManager() });

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

        describe('Organization actor', () => {
            const orgActorRequestInfo = {
                userType: AUTH_USER_TYPES.delegatedUser,
                actor: { reference: 'Organization/1f0e9d8c-7b6a-4954-8321-0fedcba98765', sub: 'client-org-sub' }
            };

            test('allows Person $everything', () => {
                expect(() => manager.verifyAccess({
                    requestInfo: orgActorRequestInfo,
                    resourceType: 'Person',
                    operation: 'everything'
                })).not.toThrow();
            });

            test.each([
                ['Patient', 'everything'],
                ['Person', 'search'],
                ['Person', 'searchById'],
                ['Person', 'graph'],
                ['Observation', 'search'],
                ['Observation', 'searchById'],
                ['Patient', 'graph']
            ])('rejects %s %s with 403', (resourceType, operation) => {
                let error;
                try {
                    manager.verifyAccess({ requestInfo: orgActorRequestInfo, resourceType, operation });
                } catch (e) {
                    error = e;
                }
                expect(error.statusCode).toBe(403);
                expect(error.message).toContain('Organization actor does not have access');
            });

            describe('DELEGATED_ORGANIZATION_ACTOR_ALLOWED_OPERATIONS', () => {
                const originalValue = process.env.DELEGATED_ORGANIZATION_ACTOR_ALLOWED_OPERATIONS;

                afterEach(() => {
                    if (originalValue === undefined) {
                        delete process.env.DELEGATED_ORGANIZATION_ACTOR_ALLOWED_OPERATIONS;
                    } else {
                        process.env.DELEGATED_ORGANIZATION_ACTOR_ALLOWED_OPERATIONS = originalValue;
                    }
                });

                const isAllowed = (resourceType, operation) => {
                    try {
                        manager.verifyAccess({ requestInfo: orgActorRequestInfo, resourceType, operation });
                        return true;
                    } catch (e) {
                        return false;
                    }
                };

                test.each([
                    ['Person:everything,Patient:everything', 'Patient', 'everything', true],
                    ['Person:everything,Patient:everything', 'Observation', 'search', false],
                    [' Person:everything , Observation:search ', 'Observation', 'search', true],
                    ['*:search', 'Observation', 'search', true],
                    ['*:search', 'Observation', 'searchById', false],
                    ['Observation:search', 'Person', 'everything', false],
                    ['Person:create', 'Person', 'create', false]
                ])('with %j, %s %s allowed = %s', (configValue, resourceType, operation, expected) => {
                    process.env.DELEGATED_ORGANIZATION_ACTOR_ALLOWED_OPERATIONS = configValue;

                    expect(isAllowed(resourceType, operation)).toBe(expected);
                });

                test('defaults to Person:everything when unset', () => {
                    delete process.env.DELEGATED_ORGANIZATION_ACTOR_ALLOWED_OPERATIONS;

                    expect(isAllowed('Person', 'everything')).toBe(true);
                    expect(isAllowed('Patient', 'everything')).toBe(false);
                });
            });

            test('RelatedPerson actor is not limited to Person $everything', () => {
                expect(() => manager.verifyAccess({
                    requestInfo: {
                        userType: AUTH_USER_TYPES.delegatedUser,
                        actor: { reference: 'RelatedPerson/36265db4-0da2-4436-b4e8-85bf7e52a425', sub: 'rp-sub' }
                    },
                    resourceType: 'Observation',
                    operation: 'search'
                })).not.toThrow();
            });
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
