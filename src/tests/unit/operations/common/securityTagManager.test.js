const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

// Mock assertType to bypass type checking in constructor
jestObj.mock('../../../../utils/assertType', () => ({
    assertTypeEquals: jestObj.fn(),
    assertIsValid: jestObj.fn()
}));

// Mock FieldMapper - controls field name prefixing behavior
jestObj.mock('../../../../operations/query/filters/fieldMapper', () => ({
    FieldMapper: class MockFieldMapper {
        constructor({ useHistoryTable }) {
            this.useHistoryTable = useHistoryTable;
        }

        getFieldName(field) {
            return this.useHistoryTable ? `resource.${field}` : field;
        }
    }
}));

const { SecurityTagManager } = require('../../../../operations/common/securityTagManager');
const { SecurityTagSystem } = require('../../../../utils/securityTagSystem');

describe('SecurityTagManager', () => {
    let securityTagManager;
    let mockScopesManager;
    let mockAccessIndexManager;
    let mockPatientFilterManager;
    let mockR4SearchQueryCreator;

    beforeEach(() => {
        mockScopesManager = {
            getAccessCodesFromScopes: jestObj.fn()
        };
        mockAccessIndexManager = {
            resourceHasAccessIndexForAccessCodes: jestObj.fn()
        };
        mockPatientFilterManager = {};
        mockR4SearchQueryCreator = {
            appendAndSimplifyQuery: jestObj.fn(({ query, andQuery }) => {
                // Simulates combining query with andQuery via $and
                if (Object.keys(query).length === 0) {
                    return andQuery;
                }
                return { $and: [query, andQuery] };
            })
        };

        securityTagManager = new SecurityTagManager({
            scopesManager: mockScopesManager,
            accessIndexManager: mockAccessIndexManager,
            patientFilterManager: mockPatientFilterManager,
            r4SearchQueryCreator: mockR4SearchQueryCreator
        });
    });

    describe('getSecurityTagsFromScope', () => {
        test('throws ForbiddenError when no access codes and no patient scopes', () => {
            mockScopesManager.getAccessCodesFromScopes.mockReturnValue([]);

            expect(() => {
                securityTagManager.getSecurityTagsFromScope({
                    user: 'testUser',
                    scope: 'patient/*.read',
                    accessViaPatientScopes: false,
                    accessRequested: 'read'
                });
            }).toThrow();

            try {
                securityTagManager.getSecurityTagsFromScope({
                    user: 'testUser',
                    scope: 'patient/*.read',
                    accessViaPatientScopes: false,
                    accessRequested: 'read'
                });
            } catch (e) {
                expect(e.statusCode).toBe(403);
            }
        });

        test('error message includes user and scope info', () => {
            mockScopesManager.getAccessCodesFromScopes.mockReturnValue([]);

            expect(() => {
                securityTagManager.getSecurityTagsFromScope({
                    user: 'admin@example.com',
                    scope: 'system/*.read',
                    accessViaPatientScopes: false,
                    accessRequested: 'read'
                });
            }).toThrow(/admin@example\.com/);

            expect(() => {
                securityTagManager.getSecurityTagsFromScope({
                    user: 'admin@example.com',
                    scope: 'system/*.read',
                    accessViaPatientScopes: false,
                    accessRequested: 'read'
                });
            }).toThrow(/system\/\*\.read/);
        });

        test('returns empty array when access code is * (full access)', () => {
            mockScopesManager.getAccessCodesFromScopes.mockReturnValue(['*']);

            const result = securityTagManager.getSecurityTagsFromScope({
                user: 'superAdmin',
                scope: 'system/*.*',
                accessViaPatientScopes: false,
                accessRequested: 'read'
            });

            expect(result).toEqual([]);
        });

        test('returns access codes as security tags when not wildcard', () => {
            mockScopesManager.getAccessCodesFromScopes.mockReturnValue(['bwell', 'client-abc']);

            const result = securityTagManager.getSecurityTagsFromScope({
                user: 'testUser',
                scope: 'system/*.read',
                accessViaPatientScopes: false,
                accessRequested: 'read'
            });

            expect(result).toEqual(['bwell', 'client-abc']);
        });

        test('does not throw when no access codes but accessViaPatientScopes is true', () => {
            mockScopesManager.getAccessCodesFromScopes.mockReturnValue([]);

            const result = securityTagManager.getSecurityTagsFromScope({
                user: 'patientUser',
                scope: 'patient/Patient.read',
                accessViaPatientScopes: true,
                accessRequested: 'read'
            });

            expect(result).toEqual([]);
        });

        test('passes correct parameters to scopesManager.getAccessCodesFromScopes', () => {
            mockScopesManager.getAccessCodesFromScopes.mockReturnValue(['bwell']);

            securityTagManager.getSecurityTagsFromScope({
                user: 'myUser',
                scope: 'system/*.read',
                accessViaPatientScopes: false,
                accessRequested: 'write'
            });

            expect(mockScopesManager.getAccessCodesFromScopes).toHaveBeenCalledWith(
                'write', 'myUser', 'system/*.read'
            );
        });

        test('wildcard among other codes still grants full access (returns empty)', () => {
            mockScopesManager.getAccessCodesFromScopes.mockReturnValue(['bwell', '*', 'client-abc']);

            const result = securityTagManager.getSecurityTagsFromScope({
                user: 'testUser',
                scope: 'system/*.*',
                accessViaPatientScopes: false,
                accessRequested: 'read'
            });

            expect(result).toEqual([]);
        });
    });

    describe('getQueryWithSecurityTags', () => {
        test('returns query unchanged when securityTags is empty', () => {
            const originalQuery = { resourceType: 'Patient' };

            const result = securityTagManager.getQueryWithSecurityTags({
                resourceType: 'Patient',
                securityTags: [],
                query: originalQuery
            });

            expect(result).toEqual(originalQuery);
            expect(mockR4SearchQueryCreator.appendAndSimplifyQuery).not.toHaveBeenCalled();
        });

        test('returns query unchanged when securityTags is null', () => {
            const originalQuery = { resourceType: 'Patient' };

            const result = securityTagManager.getQueryWithSecurityTags({
                resourceType: 'Patient',
                securityTags: null,
                query: originalQuery
            });

            expect(result).toEqual(originalQuery);
            expect(mockR4SearchQueryCreator.appendAndSimplifyQuery).not.toHaveBeenCalled();
        });

        test('uses _access index pattern with single tag when useAccessIndex=true and resource has index', () => {
            mockAccessIndexManager.resourceHasAccessIndexForAccessCodes.mockReturnValue(true);

            securityTagManager.getQueryWithSecurityTags({
                resourceType: 'Patient',
                securityTags: ['bwell'],
                query: {},
                useAccessIndex: true
            });

            expect(mockR4SearchQueryCreator.appendAndSimplifyQuery).toHaveBeenCalledWith({
                query: {},
                andQuery: { '_access.bwell': 1 }
            });
        });

        test('uses $or with _access pattern for multiple tags when useAccessIndex=true and resource has index', () => {
            mockAccessIndexManager.resourceHasAccessIndexForAccessCodes.mockReturnValue(true);

            securityTagManager.getQueryWithSecurityTags({
                resourceType: 'Patient',
                securityTags: ['bwell', 'client-abc'],
                query: {},
                useAccessIndex: true
            });

            expect(mockR4SearchQueryCreator.appendAndSimplifyQuery).toHaveBeenCalledWith({
                query: {},
                andQuery: {
                    $or: [
                        { '_access.bwell': 1 },
                        { '_access.client-abc': 1 }
                    ]
                }
            });
        });

        test('uses meta.security.$elemMatch with single tag when useAccessIndex=false', () => {
            securityTagManager.getQueryWithSecurityTags({
                resourceType: 'Patient',
                securityTags: ['bwell'],
                query: {},
                useAccessIndex: false
            });

            expect(mockR4SearchQueryCreator.appendAndSimplifyQuery).toHaveBeenCalledWith({
                query: {},
                andQuery: {
                    'meta.security': {
                        $elemMatch: {
                            system: SecurityTagSystem.access,
                            code: 'bwell'
                        }
                    }
                }
            });
        });

        test('uses meta.security.$elemMatch with $in for multiple tags when useAccessIndex=false', () => {
            securityTagManager.getQueryWithSecurityTags({
                resourceType: 'Patient',
                securityTags: ['bwell', 'client-abc'],
                query: {},
                useAccessIndex: false
            });

            expect(mockR4SearchQueryCreator.appendAndSimplifyQuery).toHaveBeenCalledWith({
                query: {},
                andQuery: {
                    'meta.security': {
                        $elemMatch: {
                            system: SecurityTagSystem.access,
                            code: { $in: ['bwell', 'client-abc'] }
                        }
                    }
                }
            });
        });

        test('falls back to meta.security pattern when useAccessIndex=true but resource has no index', () => {
            mockAccessIndexManager.resourceHasAccessIndexForAccessCodes.mockReturnValue(false);

            securityTagManager.getQueryWithSecurityTags({
                resourceType: 'Observation',
                securityTags: ['bwell'],
                query: {},
                useAccessIndex: true
            });

            expect(mockR4SearchQueryCreator.appendAndSimplifyQuery).toHaveBeenCalledWith({
                query: {},
                andQuery: {
                    'meta.security': {
                        $elemMatch: {
                            system: SecurityTagSystem.access,
                            code: 'bwell'
                        }
                    }
                }
            });
        });

        test('useHistoryTable=true prefixes field names with resource.', () => {
            mockAccessIndexManager.resourceHasAccessIndexForAccessCodes.mockReturnValue(true);

            securityTagManager.getQueryWithSecurityTags({
                resourceType: 'Patient',
                securityTags: ['bwell'],
                query: {},
                useAccessIndex: true,
                useHistoryTable: true
            });

            expect(mockR4SearchQueryCreator.appendAndSimplifyQuery).toHaveBeenCalledWith({
                query: {},
                andQuery: { 'resource._access.bwell': 1 }
            });
        });

        test('useHistoryTable=true prefixes meta.security with resource.', () => {
            securityTagManager.getQueryWithSecurityTags({
                resourceType: 'Patient',
                securityTags: ['bwell'],
                query: {},
                useAccessIndex: false,
                useHistoryTable: true
            });

            expect(mockR4SearchQueryCreator.appendAndSimplifyQuery).toHaveBeenCalledWith({
                query: {},
                andQuery: {
                    'resource.meta.security': {
                        $elemMatch: {
                            system: SecurityTagSystem.access,
                            code: 'bwell'
                        }
                    }
                }
            });
        });

        test('passes resourceType and securityTags to accessIndexManager check', () => {
            mockAccessIndexManager.resourceHasAccessIndexForAccessCodes.mockReturnValue(false);

            securityTagManager.getQueryWithSecurityTags({
                resourceType: 'Encounter',
                securityTags: ['bwell', 'client-xyz'],
                query: {},
                useAccessIndex: true
            });

            expect(mockAccessIndexManager.resourceHasAccessIndexForAccessCodes).toHaveBeenCalledWith({
                resourceType: 'Encounter',
                accessCodes: ['bwell', 'client-xyz']
            });
        });

        test('does not check access index when useAccessIndex is false (default)', () => {
            securityTagManager.getQueryWithSecurityTags({
                resourceType: 'Patient',
                securityTags: ['bwell'],
                query: {}
            });

            expect(mockAccessIndexManager.resourceHasAccessIndexForAccessCodes).not.toHaveBeenCalled();
        });
    });
});
