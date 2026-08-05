/**
 * Unit tests for GraphHelper security context derivation (EA-2335)
 * Verifies that securityContext is correctly derived from JWT and passed to enrichmentManager
 */
const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

// Mock infrastructure
jest.mock('../../../../config', () => ({}));
jest.mock('../../../../utils/mongoDatabaseManager', () => ({}));
jest.mock('@sentry/node', () => ({ init: jest.fn(), captureException: jest.fn() }));
jest.mock('../../../../operations/common/logging', () => ({
    logInfo: jest.fn(),
    logDebug: jest.fn(),
    logError: jest.fn(),
    logWarn: jest.fn()
}));
jest.mock('../../../../utils/assertType', () => ({
    assertTypeEquals: jest.fn(),
    assertIsValid: jest.fn()
}));

const { GraphHelper } = require('../../../../operations/graph/graphHelpers');

describe('GraphHelper - Security Context Derivation (EA-2335)', () => {
    let graphHelper;
    let mockSearchManager;
    let mockEnrichmentManager;
    let mockConfigManager;
    let mockScopesManager;
    let mockSecurityTagManager;

    beforeEach(() => {
        jest.clearAllMocks();

        // Mock SearchManager with scopesManager and securityTagManager
        mockScopesManager = {
            getAccessCodesFromScopes: jest.fn(),
            isAccessAllowedByPatientScopes: jest.fn()
        };
        mockSecurityTagManager = {
            getSecurityTagsFromScope: jest.fn()
        };

        mockSearchManager = {
            scopesManager: mockScopesManager,
            securityTagManager: mockSecurityTagManager,
            constructQueryAsync: jest.fn().mockResolvedValue({ query: {} })
        };

        mockEnrichmentManager = {
            enrichBundleEntriesAsync: jest.fn().mockImplementation(({ entries }) => Promise.resolve(entries))
        };

        mockConfigManager = {
            useAccessIndex: false,
            mongoTimeout: 30000,
            supportLegacyIds: false,
            graphBatchSize: 10
        };

        // Create minimal GraphHelper with required dependencies
        graphHelper = new GraphHelper({
            databaseQueryFactory: { createQuery: jest.fn() },
            configManager: mockConfigManager,
            bundleManager: {
                createRawBundle: jest.fn().mockReturnValue({ resourceType: 'Bundle', type: 'searchset', entry: [] }),
                removeDuplicateEntries: jest.fn().mockImplementation(({ entries }) => entries)
            },
            searchManager: mockSearchManager,
            scopesValidator: {
                hasValidScopesAsync: jest.fn().mockResolvedValue(true),
                verifyHasValidScopesAsync: jest.fn().mockResolvedValue(undefined),
                isAccessToResourceAllowedByAccessAndPatientScopes: jest.fn().mockResolvedValue(undefined)
            },
            enrichmentManager: mockEnrichmentManager,
            r4ArgsParser: {
                parseArgs: jest.fn().mockReturnValue({
                    get: jest.fn(),
                    parsedArgItems: [],
                    getRawArgs: jest.fn().mockReturnValue({}),
                    clone: jest.fn().mockReturnThis(),
                    remove: jest.fn(),
                    headers: {},
                    _includeHidden: false
                })
            },
            databaseAttachmentManager: { transformAttachments: jest.fn().mockImplementation((r) => Promise.resolve(r)) },
            base64DataManager: { transformAsync: jest.fn().mockImplementation((r) => Promise.resolve(r)) },
            searchParametersManager: {},
            removeHelper: { deleteManyAsync: jest.fn().mockResolvedValue(undefined) },
            auditLogger: { logAuditEntryAsync: jest.fn().mockResolvedValue(undefined) },
            postRequestProcessor: { add: jest.fn() }
        });
    });

    describe('processGraphAsync', () => {
        test('derives securityContext with access tags for non-admin user', async () => {
            // ARRANGE
            const requestInfo = {
                user: 'client-a',
                scope: 'access/client-a.*',
                userType: 'client',
                actor: 'user@example.com'
            };

            mockScopesManager.getAccessCodesFromScopes.mockReturnValue(['client-a']);
            mockScopesManager.isAccessAllowedByPatientScopes.mockReturnValue(false);
            mockSecurityTagManager.getSecurityTagsFromScope.mockReturnValue(['client-a']);

            // Mock database query to return no results (we just want to verify enrichmentManager call)
            graphHelper.databaseQueryFactory.createQuery = jest.fn().mockReturnValue({
                findAsync: jest.fn().mockResolvedValue({
                    toArrayAsync: jest.fn().mockResolvedValue([])
                })
            });

            const parsedArgs = {
                get: jest.fn().mockReturnValue(null),
                parsedArgItems: [],
                getRawArgs: jest.fn().mockReturnValue({}),
                clone: jest.fn().mockReturnThis(),
                remove: jest.fn(),
                headers: {},
                _includeHidden: false
            };

            // ACT
            await graphHelper.processGraphAsync({
                requestInfo,
                parsedArgs,
                resourceType: 'Patient',
                useAccessIndex: false,
                ids: ['patient1'],
                isReferencesRead: false
            });

            // ASSERT
            expect(mockScopesManager.getAccessCodesFromScopes).toHaveBeenCalledWith(
                'read', 'client-a', 'access/client-a.*'
            );
            expect(mockScopesManager.isAccessAllowedByPatientScopes).toHaveBeenCalledWith({
                scope: 'access/client-a.*',
                resourceType: 'Patient'
            });
            expect(mockSecurityTagManager.getSecurityTagsFromScope).toHaveBeenCalledWith({
                user: 'client-a',
                scope: 'access/client-a.*',
                accessRequested: 'read',
                accessViaPatientScopes: false
            });

            expect(mockEnrichmentManager.enrichBundleEntriesAsync).toHaveBeenCalledWith(
                expect.objectContaining({
                    enrichmentContext: expect.objectContaining({
                        userType: 'client',
                        actor: 'user@example.com',
                        user: 'client-a',
                        scope: 'access/client-a.*',
                        securityContext: {
                            accessTags: ['client-a'],
                            ownerTags: [],
                            hasFullAccess: false
                        }
                    })
                })
            );
        });

        test('derives securityContext with hasFullAccess for admin user', async () => {
            // ARRANGE
            const requestInfo = {
                user: 'admin-user',
                scope: 'access/*.*',
                userType: 'admin',
                actor: 'admin@example.com'
            };

            mockScopesManager.getAccessCodesFromScopes.mockReturnValue(['*']);
            mockScopesManager.isAccessAllowedByPatientScopes.mockReturnValue(false);
            mockSecurityTagManager.getSecurityTagsFromScope.mockReturnValue([]);

            graphHelper.databaseQueryFactory.createQuery = jest.fn().mockReturnValue({
                findAsync: jest.fn().mockResolvedValue({
                    toArrayAsync: jest.fn().mockResolvedValue([])
                })
            });

            const parsedArgs = {
                get: jest.fn().mockReturnValue(null),
                parsedArgItems: [],
                getRawArgs: jest.fn().mockReturnValue({}),
                clone: jest.fn().mockReturnThis(),
                remove: jest.fn(),
                headers: {},
                _includeHidden: false
            };

            // ACT
            await graphHelper.processGraphAsync({
                requestInfo,
                parsedArgs,
                resourceType: 'Patient',
                useAccessIndex: false,
                ids: ['patient1'],
                isReferencesRead: false
            });

            // ASSERT
            expect(mockScopesManager.getAccessCodesFromScopes).toHaveBeenCalledWith(
                'read', 'admin-user', 'access/*.*'
            );
            expect(mockScopesManager.isAccessAllowedByPatientScopes).toHaveBeenCalledWith({
                scope: 'access/*.*',
                resourceType: 'Patient'
            });
            expect(mockSecurityTagManager.getSecurityTagsFromScope).toHaveBeenCalledWith({
                user: 'admin-user',
                scope: 'access/*.*',
                accessRequested: 'read',
                accessViaPatientScopes: false
            });

            expect(mockEnrichmentManager.enrichBundleEntriesAsync).toHaveBeenCalledWith(
                expect.objectContaining({
                    enrichmentContext: expect.objectContaining({
                        securityContext: {
                            accessTags: [],
                            ownerTags: [],
                            hasFullAccess: true
                        }
                    })
                })
            );
        });

        test('derives securityContext with multiple access tags', async () => {
            // ARRANGE
            const requestInfo = {
                user: 'multi-tenant-user',
                scope: 'access/client-a.* access/client-b.*',
                userType: 'client',
                actor: 'user@example.com'
            };

            mockScopesManager.getAccessCodesFromScopes.mockReturnValue(['client-a', 'client-b']);
            mockScopesManager.isAccessAllowedByPatientScopes.mockReturnValue(false);
            mockSecurityTagManager.getSecurityTagsFromScope.mockReturnValue(['client-a', 'client-b']);

            graphHelper.databaseQueryFactory.createQuery = jest.fn().mockReturnValue({
                findAsync: jest.fn().mockResolvedValue({
                    toArrayAsync: jest.fn().mockResolvedValue([])
                })
            });

            const parsedArgs = {
                get: jest.fn().mockReturnValue(null),
                parsedArgItems: [],
                getRawArgs: jest.fn().mockReturnValue({}),
                clone: jest.fn().mockReturnThis(),
                remove: jest.fn(),
                headers: {},
                _includeHidden: false
            };

            // ACT
            await graphHelper.processGraphAsync({
                requestInfo,
                parsedArgs,
                resourceType: 'Patient',
                useAccessIndex: false,
                ids: ['patient1'],
                isReferencesRead: false
            });

            // ASSERT
            expect(mockScopesManager.isAccessAllowedByPatientScopes).toHaveBeenCalledWith({
                scope: 'access/client-a.* access/client-b.*',
                resourceType: 'Patient'
            });
            expect(mockSecurityTagManager.getSecurityTagsFromScope).toHaveBeenCalledWith({
                user: 'multi-tenant-user',
                scope: 'access/client-a.* access/client-b.*',
                accessRequested: 'read',
                accessViaPatientScopes: false
            });
            expect(mockEnrichmentManager.enrichBundleEntriesAsync).toHaveBeenCalledWith(
                expect.objectContaining({
                    enrichmentContext: expect.objectContaining({
                        securityContext: {
                            accessTags: ['client-a', 'client-b'],
                            ownerTags: [],
                            hasFullAccess: false
                        }
                    })
                })
            );
        });

        test('derives securityContext with empty tags for user with no access', async () => {
            // ARRANGE
            const requestInfo = {
                user: 'no-access-user',
                scope: 'user/*.*',
                userType: 'client',
                actor: 'user@example.com'
            };

            mockScopesManager.getAccessCodesFromScopes.mockReturnValue([]);
            mockScopesManager.isAccessAllowedByPatientScopes.mockReturnValue(false);
            mockSecurityTagManager.getSecurityTagsFromScope.mockReturnValue([]);

            graphHelper.databaseQueryFactory.createQuery = jest.fn().mockReturnValue({
                findAsync: jest.fn().mockResolvedValue({
                    toArrayAsync: jest.fn().mockResolvedValue([])
                })
            });

            const parsedArgs = {
                get: jest.fn().mockReturnValue(null),
                parsedArgItems: [],
                getRawArgs: jest.fn().mockReturnValue({}),
                clone: jest.fn().mockReturnThis(),
                remove: jest.fn(),
                headers: {},
                _includeHidden: false
            };

            // ACT
            await graphHelper.processGraphAsync({
                requestInfo,
                parsedArgs,
                resourceType: 'Patient',
                useAccessIndex: false,
                ids: ['patient1'],
                isReferencesRead: false
            });

            // ASSERT
            expect(mockScopesManager.isAccessAllowedByPatientScopes).toHaveBeenCalledWith({
                scope: 'user/*.*',
                resourceType: 'Patient'
            });
            expect(mockSecurityTagManager.getSecurityTagsFromScope).toHaveBeenCalledWith({
                user: 'no-access-user',
                scope: 'user/*.*',
                accessRequested: 'read',
                accessViaPatientScopes: false
            });
            expect(mockEnrichmentManager.enrichBundleEntriesAsync).toHaveBeenCalledWith(
                expect.objectContaining({
                    enrichmentContext: expect.objectContaining({
                        securityContext: {
                            accessTags: [],
                            ownerTags: [],
                            hasFullAccess: false
                        }
                    })
                })
            );
        });
    });
});
