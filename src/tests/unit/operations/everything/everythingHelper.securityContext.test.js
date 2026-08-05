/**
 * Unit tests for EverythingHelper security context derivation (EA-2335)
 * Verifies that securityContext is correctly derived from JWT and passed to enrichmentManager
 */
const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

// Mock infrastructure
jest.mock('../../../../config', () => ({}));
jest.mock('../../../../utils/mongoDatabaseManager', () => ({}));
jest.mock('@sentry/node', () => ({ init: jest.fn(), captureException: jest.fn() }));
jest.mock('express-http-context', () => ({
    get: jest.fn(),
    set: jest.fn()
}));
jest.mock('../../../../operations/common/logging', () => ({
    logInfo: jest.fn(),
    logDebug: jest.fn(),
    logError: jest.fn(),
    logWarn: jest.fn()
}));
jest.mock('../../../../utils/metrics', () => ({
    recordOutboundEverything: jest.fn()
}));

// Mock assertTypeEquals to avoid instanceof checks during construction
jest.mock('../../../../utils/assertType', () => ({
    assertTypeEquals: jest.fn(),
    assertIsValid: jest.fn()
}));

const { EverythingHelper } = require('../../../../operations/everything/everythingHelper');

describe('EverythingHelper - Security Context Derivation (EA-2335)', () => {
    let everythingHelper;
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
            everythingBatchSize: 10,
            mongoTimeout: 30000,
            supportLegacyIds: false,
            writeToCacheForEverythingOperation: false,
            readFromCacheForEverythingOperation: false,
            everythingCacheTtlSeconds: 300,
            everythingMaxParallelProcess: 5,
            mongoInQueryIdBatchSize: 100,
            externalServicesWithRestrictions: {}
        };

        // Create minimal EverythingHelper with required dependencies
        everythingHelper = new EverythingHelper({
            databaseQueryFactory: { createQuery: jest.fn() },
            configManager: mockConfigManager,
            bundleManager: {
                createRawBundle: jest.fn().mockReturnValue({ resourceType: 'Bundle', type: 'searchset', entry: [] })
            },
            searchManager: mockSearchManager,
            scopesValidator: { hasValidScopesAsync: jest.fn().mockResolvedValue(true) },
            enrichmentManager: mockEnrichmentManager,
            r4ArgsParser: {
                parseArgs: jest.fn().mockReturnValue({
                    get: jest.fn(),
                    parsedArgItems: [],
                    getRawArgs: jest.fn().mockReturnValue({}),
                    clone: jest.fn().mockReturnThis(),
                    remove: jest.fn(),
                    headers: {}
                })
            },
            databaseAttachmentManager: { transformAttachments: jest.fn().mockImplementation((r) => Promise.resolve(r)) },
            base64DataManager: { transformAsync: jest.fn().mockImplementation((r) => Promise.resolve(r)) },
            searchParametersManager: { getFieldNameForSearchParameter: jest.fn().mockReturnValue('subject.reference') },
            everythingRelatedResourceMapper: {
                getEverythingRelatedResourcesAsync: jest.fn().mockResolvedValue({ relatedResources: [], patientFilters: [] })
            },
            customTracer: {
                async traceAsync({ name }, fn) { return await fn(); },
                createChildSpan: jest.fn().mockReturnThis()
            },
            patientDataViewControlManager: {
                applyDataViewControlsForEverythingAsync: jest.fn().mockImplementation(({ resources }) => Promise.resolve(resources))
            },
            auditLogger: { logAuditEntryAsync: jest.fn().mockResolvedValue() },
            postRequestProcessor: { add: jest.fn() },
            redisStreamManager: null
        });
    });

    describe('processMultipleIdsAsync - Non-streaming path', () => {
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
            everythingHelper.databaseQueryFactory.createQuery = jest.fn().mockReturnValue({
                findAsync: jest.fn().mockResolvedValue({
                    toArrayAsync: jest.fn().mockResolvedValue([])
                })
            });

            const parsedArgs = {
                get: jest.fn().mockReturnValue(['person1']),
                parsedArgItems: [],
                getRawArgs: jest.fn().mockReturnValue({}),
                clone: jest.fn().mockReturnThis(),
                remove: jest.fn(),
                headers: {}
            };

            // ACT
            await everythingHelper.processMultipleIdsAsync({
                requestInfo,
                parsedArgs,
                resourceType: 'Person',
                useAccessIndex: false,
                queries: [],
                resourceIds: [],
                optionsForQueries: { _bundle: [{ id: 'test' }] }
            });

            // ASSERT
            expect(mockScopesManager.getAccessCodesFromScopes).toHaveBeenCalledWith(
                'read', 'client-a', 'access/client-a.*'
            );
            expect(mockScopesManager.isAccessAllowedByPatientScopes).toHaveBeenCalledWith({
                scope: 'access/client-a.*',
                resourceType: 'Person'
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

            everythingHelper.databaseQueryFactory.createQuery = jest.fn().mockReturnValue({
                findAsync: jest.fn().mockResolvedValue({
                    toArrayAsync: jest.fn().mockResolvedValue([])
                })
            });

            const parsedArgs = {
                get: jest.fn().mockReturnValue(['person1']),
                parsedArgItems: [],
                getRawArgs: jest.fn().mockReturnValue({}),
                clone: jest.fn().mockReturnThis(),
                remove: jest.fn(),
                headers: {}
            };

            // ACT
            await everythingHelper.processMultipleIdsAsync({
                requestInfo,
                parsedArgs,
                resourceType: 'Person',
                useAccessIndex: false,
                queries: [],
                resourceIds: [],
                optionsForQueries: { _bundle: [{ id: 'test' }] }
            });

            // ASSERT
            expect(mockScopesManager.getAccessCodesFromScopes).toHaveBeenCalledWith(
                'read', 'admin-user', 'access/*.*'
            );
            expect(mockScopesManager.isAccessAllowedByPatientScopes).toHaveBeenCalledWith({
                scope: 'access/*.*',
                resourceType: 'Person'
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

            everythingHelper.databaseQueryFactory.createQuery = jest.fn().mockReturnValue({
                findAsync: jest.fn().mockResolvedValue({
                    toArrayAsync: jest.fn().mockResolvedValue([])
                })
            });

            const parsedArgs = {
                get: jest.fn().mockReturnValue(['person1']),
                parsedArgItems: [],
                getRawArgs: jest.fn().mockReturnValue({}),
                clone: jest.fn().mockReturnThis(),
                remove: jest.fn(),
                headers: {}
            };

            // ACT
            await everythingHelper.processMultipleIdsAsync({
                requestInfo,
                parsedArgs,
                resourceType: 'Person',
                useAccessIndex: false,
                queries: [],
                resourceIds: [],
                optionsForQueries: { _bundle: [{ id: 'test' }] }
            });

            // ASSERT
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

        test('skips securityContext derivation when responseStreamer is present', async () => {
            // ARRANGE
            const requestInfo = {
                user: 'client-a',
                scope: 'access/client-a.*',
                userType: 'client',
                actor: 'user@example.com'
            };

            // Mock responseStreamer present
            const mockResponseStreamer = {
                writeBundleEntryAsync: jest.fn().mockResolvedValue()
            };

            everythingHelper.databaseQueryFactory.createQuery = jest.fn().mockReturnValue({
                findAsync: jest.fn().mockResolvedValue({
                    toArrayAsync: jest.fn().mockResolvedValue([])
                })
            });

            const parsedArgs = {
                get: jest.fn().mockReturnValue(['person1']),
                parsedArgItems: [],
                getRawArgs: jest.fn().mockReturnValue({}),
                clone: jest.fn().mockReturnThis(),
                remove: jest.fn(),
                headers: {}
            };

            // ACT
            await everythingHelper.processMultipleIdsAsync({
                requestInfo,
                parsedArgs,
                resourceType: 'Person',
                useAccessIndex: false,
                queries: [],
                resourceIds: [],
                optionsForQueries: { _bundle: [{ id: 'test' }] },
                responseStreamer: mockResponseStreamer
            });

            // ASSERT
            // With responseStreamer, enrichment is skipped in non-streaming path
            expect(mockEnrichmentManager.enrichBundleEntriesAsync).not.toHaveBeenCalled();
        });
    });

    describe('retriveveRelatedResourcesParallelyAsync - Streaming path', () => {
        test('derives securityContext for each resource in streaming mode', async () => {
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

            const mockResponseStreamer = {
                writeBundleEntryAsync: jest.fn().mockResolvedValue()
            };

            const mockRelatedResourceManager = {
                getRelatedResourcesAsync: jest.fn().mockResolvedValue({
                    resources: [{ resourceType: 'Group', id: 'test-group-1', member: [] }],
                    errors: []
                })
            };

            const parentParsedArgs = {
                parsedArgItems: [],
                getRawArgs: jest.fn().mockReturnValue({}),
                headers: { useExternalStorage: 'true' }
            };

            // ACT
            await everythingHelper.retriveveRelatedResourcesParallelyAsync({
                requestInfo,
                resourceType: 'Person',
                useAccessIndex: false,
                patientFilters: [],
                relatedResources: [{ resourceType: 'Group', id: 'test-group-1' }],
                relatedResourceManager: mockRelatedResourceManager,
                parentParsedArgs,
                responseStreamer: mockResponseStreamer,
                cachedStreamer: null
            });

            // ASSERT
            expect(mockScopesManager.getAccessCodesFromScopes).toHaveBeenCalledWith(
                'read', 'client-a', 'access/client-a.*'
            );
            expect(mockScopesManager.isAccessAllowedByPatientScopes).toHaveBeenCalledWith({
                scope: 'access/client-a.*',
                resourceType: 'Group'
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
    });
});
