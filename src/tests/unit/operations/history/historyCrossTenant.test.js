/**
 * Cross-tenant data exposure tests for the FHIR _history operation.
 *
 * These tests verify that the _history operation applies the same security tag
 * filtering as regular search/read operations, preventing cross-tenant data leakage
 * via historical resource versions.
 */
const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

// Mock infrastructure
jest.mock('../../../../config', () => ({}));
jest.mock('../../../../utils/mongoDatabaseManager', () => ({}));
jest.mock('@sentry/node', () => ({ init: jest.fn(), captureException: jest.fn() }));
jest.mock('express-http-context', () => ({
    get: jest.fn().mockReturnValue(null),
    set: jest.fn()
}));
jest.mock('../../../../utils/assertType', () => ({
    assertTypeEquals: jest.fn(),
    assertIsValid: jest.fn()
}));
jest.mock('../../../../utils/isTrue', () => ({
    isTrue: jest.fn().mockImplementation(v => v === true || v === 'true')
}));
jest.mock('../../../../utils/httpErrors', () => ({
    NotFoundError: class NotFoundError extends Error {
        constructor(message) { super(message); this.name = 'NotFoundError'; }
    },
    ForbiddenError: class ForbiddenError extends Error {
        constructor(message) { super(message); this.name = 'ForbiddenError'; }
    }
}));
jest.mock('../../../../utils/date.util', () => ({
    getLastUpdatedISO: jest.fn().mockImplementation(v => v || null)
}));
jest.mock('../../../../fhir/fhirResourceSerializer', () => ({
    FhirResourceSerializer: {
        serializeByResourceType: jest.fn()
    }
}));

const { ForbiddenError } = require('../../../../utils/httpErrors');
const { getLastUpdatedISO } = require('../../../../utils/date.util');

describe('History Operation - Cross-Tenant Data Exposure', () => {
    let historyOp;
    let mockDatabaseHistoryFactory;
    let mockFhirLoggingManager;
    let mockScopesValidator;
    let mockBundleManager;
    let mockResourceLocatorFactory;
    let mockConfigManager;
    let mockSearchManager;
    let mockResourceManager;
    let mockDatabaseAttachmentManager;
    let mockBase64DataManager;
    let mockScopesManager;
    let mockIdentifierEnrichmentProvider;
    let mockCompositionSectionFilterEnrichmentProvider;
    let mockParsedArgs;
    let mockCursor;

    beforeEach(() => {
        jest.clearAllMocks();

        mockCursor = {
            hasNext: jest.fn().mockResolvedValue(false),
            next: jest.fn().mockResolvedValue(null),
            explainAsync: jest.fn().mockResolvedValue([]),
            setEmpty: jest.fn(),
            getCollection: jest.fn().mockReturnValue('Patient_4_0_0_History')
        };

        mockDatabaseHistoryFactory = {
            createDatabaseHistoryManager: jest.fn().mockReturnValue({
                findAsync: jest.fn().mockResolvedValue(mockCursor)
            })
        };
        mockFhirLoggingManager = {
            logOperationSuccessAsync: jest.fn().mockResolvedValue(undefined),
            logOperationFailureAsync: jest.fn().mockResolvedValue(undefined)
        };
        mockScopesValidator = {
            verifyHasValidScopesAsync: jest.fn().mockResolvedValue(undefined)
        };
        mockBundleManager = {
            createRawBundleFromEntries: jest.fn().mockReturnValue({
                resourceType: 'Bundle',
                type: 'history',
                entry: []
            })
        };
        mockResourceLocatorFactory = {
            createResourceLocator: jest.fn().mockReturnValue({
                getCollectionName: jest.fn().mockReturnValue('Patient_4_0_0')
            })
        };
        mockConfigManager = {
            useAccessIndex: false,
            cloudStorageHistoryResources: [],
            cloudStorageBatchDownloadSize: 10,
            enableConsentedProaDataAccess: false,
            enableHIETreatmentRelatedDataAccess: false
        };
        mockSearchManager = {
            constructQueryAsync: jest.fn().mockResolvedValue({ query: {}, columns: new Set() })
        };
        mockResourceManager = {
            getFullUrlForResource: jest.fn().mockReturnValue('https://localhost/Patient/p1')
        };
        mockDatabaseAttachmentManager = {
            transformAttachments: jest.fn().mockImplementation(r => r)
        };
        mockBase64DataManager = {
            transformAsync: jest.fn().mockImplementation(r => r),
            rehydrateHistoryDiagnostics: jest.fn()
        };
        mockScopesManager = {
            hasPatientScope: jest.fn().mockReturnValue(false)
        };
        mockIdentifierEnrichmentProvider = {
            enrichBundleEntriesAsync: jest.fn().mockImplementation(({ entries }) => entries)
        };
        mockCompositionSectionFilterEnrichmentProvider = {
            enrichBundleEntriesAsync: jest.fn().mockImplementation(({ entries }) => entries)
        };

        const { ParsedArgs } = require('../../../../operations/query/parsedArgs');
        mockParsedArgs = Object.create(ParsedArgs.prototype);
        mockParsedArgs.base_version = '4_0_0';
        mockParsedArgs._useAccessIndex = false;
        mockParsedArgs._explain = false;
        mockParsedArgs._debug = false;
        mockParsedArgs._count = undefined;
        mockParsedArgs.getRawArgs = jest.fn().mockReturnValue({});

        const { HistoryOperation } = require('../../../../operations/history/history');
        historyOp = Object.create(HistoryOperation.prototype);
        historyOp.databaseHistoryFactory = mockDatabaseHistoryFactory;
        historyOp.fhirLoggingManager = mockFhirLoggingManager;
        historyOp.scopesValidator = mockScopesValidator;
        historyOp.bundleManager = mockBundleManager;
        historyOp.resourceLocatorFactory = mockResourceLocatorFactory;
        historyOp.configManager = mockConfigManager;
        historyOp.searchManager = mockSearchManager;
        historyOp.resourceManager = mockResourceManager;
        historyOp.databaseAttachmentManager = mockDatabaseAttachmentManager;
        historyOp.base64DataManager = mockBase64DataManager;
        historyOp.scopesManager = mockScopesManager;
        historyOp.historyResourceCloudStorageClient = null;
        historyOp.identifierEnrichmentProvider = mockIdentifierEnrichmentProvider;
        historyOp.compositionSectionFilterEnrichmentProvider = mockCompositionSectionFilterEnrichmentProvider;
        historyOp.currentOperationName = 'history';
        historyOp.errorMessagePostfix = 'for Patient resources';
    });

    function makeRequestInfo(overrides = {}) {
        return {
            user: 'testUser',
            userType: 'practitioner',
            scope: 'user/*.read access/tenantA',
            originalUrl: '/Patient/_history',
            protocol: 'https',
            host: 'localhost',
            personIdFromJwtToken: 'person-1',
            isUser: true,
            requestId: 'req-123',
            userRequestId: 'ureq-123',
            actor: null,
            ...overrides
        };
    }

    describe('security tag filtering in _history queries', () => {
        test('_history passes security tags to constructQueryAsync for tenant scoping', async () => {
            // Tenant A user with scope "access/tenantA" requests _history.
            // The constructQueryAsync MUST receive the security tag so the query
            // only returns history records belonging to tenantA.
            const historyResource = {
                id: 'p1',
                resource: {
                    id: 'p1',
                    _uuid: 'uuid-p1',
                    resourceType: 'Patient',
                    meta: {
                        lastUpdated: '2023-01-01T00:00:00Z',
                        security: [
                            { system: 'https://www.icanbwell.com/access', code: 'tenantA' },
                            { system: 'https://www.icanbwell.com/owner', code: 'tenantA' }
                        ]
                    }
                }
            };

            mockCursor.hasNext
                .mockResolvedValueOnce(true)
                .mockResolvedValueOnce(false);
            mockCursor.next.mockResolvedValueOnce(historyResource);
            getLastUpdatedISO.mockReturnValue('2023-01-01T00:00:00Z');

            await historyOp.fetchHistoryAsync({
                requestInfo: makeRequestInfo({ scope: 'user/*.read access/tenantA' }),
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            });

            // Verify that constructQueryAsync was called with the scope that contains the
            // access tag, so security filtering can be applied
            expect(mockSearchManager.constructQueryAsync).toHaveBeenCalledTimes(1);
            const callArgs = mockSearchManager.constructQueryAsync.mock.calls[0][0];
            expect(callArgs.scope).toBe('user/*.read access/tenantA');
            expect(callArgs.useHistoryTable).toBe(true);
            // The operation should be READ to ensure the same security checks
            expect(callArgs.operation).toBe('READ');
        });

        test('_history must filter out resources belonging to other tenants', async () => {
            // Simulate: constructQueryAsync is called, but it returns an unfiltered query
            // (simulating the bug where security tags are not applied to history).
            // The test verifies the query IS constructed with proper scoping.
            //
            // Two history resources in the DB: one for tenantA, one for tenantB.
            // TenantA user should only see tenantA resources.
            const tenantAResource = {
                id: 'p1',
                resource: {
                    id: 'p1',
                    _uuid: 'uuid-p1',
                    resourceType: 'Patient',
                    meta: {
                        lastUpdated: '2023-01-01T00:00:00Z',
                        security: [
                            { system: 'https://www.icanbwell.com/access', code: 'tenantA' }
                        ]
                    }
                }
            };
            const tenantBResource = {
                id: 'p2',
                resource: {
                    id: 'p2',
                    _uuid: 'uuid-p2',
                    resourceType: 'Patient',
                    meta: {
                        lastUpdated: '2023-01-02T00:00:00Z',
                        security: [
                            { system: 'https://www.icanbwell.com/access', code: 'tenantB' }
                        ]
                    }
                }
            };

            // The mock simulates what would happen if the query was NOT filtered:
            // both resources are returned by the cursor.
            mockCursor.hasNext
                .mockResolvedValueOnce(true)
                .mockResolvedValueOnce(true)
                .mockResolvedValueOnce(false);
            mockCursor.next
                .mockResolvedValueOnce(tenantAResource)
                .mockResolvedValueOnce(tenantBResource);
            getLastUpdatedISO.mockReturnValue('2023-01-01T00:00:00Z');

            // Capture what query is constructed - it MUST include security tag filtering
            let capturedQuery = null;
            mockSearchManager.constructQueryAsync.mockImplementation(async (args) => {
                capturedQuery = args;
                // Return a query that SHOULD filter by security tag
                // If it returns {} (empty), that means no filtering was applied - the bug
                return {
                    query: {
                        'resource.meta.security': {
                            $elemMatch: {
                                system: 'https://www.icanbwell.com/access',
                                code: 'tenantA'
                            }
                        }
                    },
                    columns: new Set()
                };
            });

            await historyOp.fetchHistoryAsync({
                requestInfo: makeRequestInfo({ scope: 'user/*.read access/tenantA' }),
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            });

            // The constructed query MUST include the security tag filter
            expect(capturedQuery).not.toBeNull();
            expect(capturedQuery.scope).toContain('access/tenantA');

            // The database query applied to history MUST have security tag filter.
            // The key is literally 'resource.meta.security' (a dotted key name in MongoDB).
            const findAsyncCall = mockDatabaseHistoryFactory.createDatabaseHistoryManager()
                .findAsync.mock.calls[0][0];
            expect(findAsyncCall.query['resource.meta.security']).toBeDefined();
            expect(findAsyncCall.query['resource.meta.security'].$elemMatch.code).toBe('tenantA');
        });

        test('type-level _history must scope results to the requesting tenant', async () => {
            // Type-level history (e.g. /Patient/_history) returns all versions of ALL
            // Patients. Without tenant filtering, this leaks data across tenants.
            const tenantAResource = {
                id: 'p1',
                resource: {
                    id: 'p1',
                    _uuid: 'uuid-p1',
                    resourceType: 'Patient',
                    meta: {
                        lastUpdated: '2023-06-01T00:00:00Z',
                        security: [
                            { system: 'https://www.icanbwell.com/access', code: 'tenantA' }
                        ]
                    }
                }
            };

            mockCursor.hasNext
                .mockResolvedValueOnce(true)
                .mockResolvedValueOnce(false);
            mockCursor.next.mockResolvedValueOnce(tenantAResource);
            getLastUpdatedISO.mockReturnValue('2023-06-01T00:00:00Z');

            // Set up constructQueryAsync to enforce security filtering
            mockSearchManager.constructQueryAsync.mockResolvedValue({
                query: {
                    'resource.meta.security': {
                        $elemMatch: {
                            system: 'https://www.icanbwell.com/access',
                            code: 'tenantA'
                        }
                    }
                },
                columns: new Set()
            });

            await historyOp.fetchHistoryAsync({
                requestInfo: makeRequestInfo({
                    scope: 'user/*.read access/tenantA',
                    originalUrl: '/4_0_0/Patient/_history'
                }),
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            });

            // Verify constructQueryAsync was called with useHistoryTable: true
            // which ensures field paths use 'resource.' prefix for security tag lookups
            const constructArgs = mockSearchManager.constructQueryAsync.mock.calls[0][0];
            expect(constructArgs.useHistoryTable).toBe(true);
            expect(constructArgs.resourceType).toBe('Patient');
            expect(constructArgs.scope).toContain('access/tenantA');
        });
    });

    describe('consent revocation in _history', () => {
        test('_history must not return versions from before consent was granted', async () => {
            // Scenario: A resource was created at T1 with access tag "tenantB" only.
            // At T2, consent was granted and access tag "tenantA" was added.
            // TenantA should NOT see the T1 version (before their access was granted).
            //
            // The history table stores BundleEntry format with the resource at the time.
            // If the query only checks the CURRENT resource's security tags, old versions
            // from before consent may leak.
            const versionBeforeConsent = {
                id: 'p1',
                resource: {
                    id: 'p1',
                    _uuid: 'uuid-p1',
                    resourceType: 'Patient',
                    meta: {
                        versionId: '1',
                        lastUpdated: '2023-01-01T00:00:00Z',
                        security: [
                            { system: 'https://www.icanbwell.com/access', code: 'tenantB' }
                        ]
                    }
                }
            };
            const versionAfterConsent = {
                id: 'p1',
                resource: {
                    id: 'p1',
                    _uuid: 'uuid-p1',
                    resourceType: 'Patient',
                    meta: {
                        versionId: '2',
                        lastUpdated: '2023-06-01T00:00:00Z',
                        security: [
                            { system: 'https://www.icanbwell.com/access', code: 'tenantA' },
                            { system: 'https://www.icanbwell.com/access', code: 'tenantB' }
                        ]
                    }
                }
            };

            // The DB returns both versions (sorted newest first)
            mockCursor.hasNext
                .mockResolvedValueOnce(true)
                .mockResolvedValueOnce(true)
                .mockResolvedValueOnce(false);
            mockCursor.next
                .mockResolvedValueOnce(versionAfterConsent)
                .mockResolvedValueOnce(versionBeforeConsent);
            getLastUpdatedISO
                .mockReturnValueOnce('2023-06-01T00:00:00Z')
                .mockReturnValueOnce('2023-06-01T00:00:00Z')
                .mockReturnValueOnce('2023-01-01T00:00:00Z')
                .mockReturnValueOnce('2023-01-01T00:00:00Z');

            // The query MUST filter each history entry by its own security tags.
            // Since useHistoryTable=true, the field is 'resource.meta.security'.
            // The query should ensure EACH history entry has the right access code.
            mockSearchManager.constructQueryAsync.mockResolvedValue({
                query: {
                    'resource.meta.security': {
                        $elemMatch: {
                            system: 'https://www.icanbwell.com/access',
                            code: 'tenantA'
                        }
                    }
                },
                columns: new Set()
            });

            await historyOp.fetchHistoryAsync({
                requestInfo: makeRequestInfo({ scope: 'user/*.read access/tenantA' }),
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            });

            // The query passed to findAsync MUST filter by tenant's access tag
            // so that versionBeforeConsent (which only has tenantB) is excluded
            const dbManager = mockDatabaseHistoryFactory.createDatabaseHistoryManager();
            const findCall = dbManager.findAsync.mock.calls[0][0];
            expect(findCall.query['resource.meta.security']).toBeDefined();
            expect(findCall.query['resource.meta.security'].$elemMatch.code).toBe('tenantA');
        });

        test('_history must not expose resources after consent revocation', async () => {
            // If consent was revoked (access tag removed from current version),
            // the history operation should not return ANY versions including
            // those from when consent was active.
            //
            // This test verifies the query construction includes the security filter.
            const versionWithConsent = {
                id: 'p1',
                resource: {
                    id: 'p1',
                    _uuid: 'uuid-p1',
                    resourceType: 'Patient',
                    meta: {
                        versionId: '2',
                        lastUpdated: '2023-06-01T00:00:00Z',
                        security: [
                            { system: 'https://www.icanbwell.com/access', code: 'tenantA' },
                            { system: 'https://www.icanbwell.com/access', code: 'tenantB' }
                        ]
                    }
                }
            };
            const versionAfterRevocation = {
                id: 'p1',
                resource: {
                    id: 'p1',
                    _uuid: 'uuid-p1',
                    resourceType: 'Patient',
                    meta: {
                        versionId: '3',
                        lastUpdated: '2023-12-01T00:00:00Z',
                        security: [
                            { system: 'https://www.icanbwell.com/access', code: 'tenantB' }
                            // tenantA access revoked
                        ]
                    }
                }
            };

            // DB returns newest first. After revocation, tenantA tag is gone.
            mockCursor.hasNext
                .mockResolvedValueOnce(true)
                .mockResolvedValueOnce(true)
                .mockResolvedValueOnce(false);
            mockCursor.next
                .mockResolvedValueOnce(versionAfterRevocation)
                .mockResolvedValueOnce(versionWithConsent);
            getLastUpdatedISO
                .mockReturnValueOnce('2023-12-01T00:00:00Z')
                .mockReturnValueOnce('2023-12-01T00:00:00Z')
                .mockReturnValueOnce('2023-06-01T00:00:00Z')
                .mockReturnValueOnce('2023-06-01T00:00:00Z');

            // Security query should filter by tenantA access tag on EACH history entry
            mockSearchManager.constructQueryAsync.mockResolvedValue({
                query: {
                    'resource.meta.security': {
                        $elemMatch: {
                            system: 'https://www.icanbwell.com/access',
                            code: 'tenantA'
                        }
                    }
                },
                columns: new Set()
            });

            await historyOp.fetchHistoryAsync({
                requestInfo: makeRequestInfo({ scope: 'user/*.read access/tenantA' }),
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            });

            // The DB query MUST filter history entries by security tag so that
            // versionAfterRevocation (no tenantA access) is excluded from results.
            // Without this filtering, an attacker can see v3 which was EXPLICITLY
            // restricted from their access.
            const dbManager = mockDatabaseHistoryFactory.createDatabaseHistoryManager();
            const findCall = dbManager.findAsync.mock.calls[0][0];
            expect(findCall.query['resource.meta.security']).toBeDefined();
            expect(findCall.query['resource.meta.security'].$elemMatch.code).toBe('tenantA');
        });
    });

    describe('_history with data sharing (PROA consent)', () => {
        test('_history must pass enableConsentedProaDataAccess context when consent features are enabled', async () => {
            // When enableConsentedProaDataAccess is true, the constructQueryAsync in
            // normal search calls updateQueryConsideringDataSharing. The _history
            // operation does NOT pass requestId, which means the data sharing cache
            // cannot be used — but it still must trigger the consent filtering logic.
            mockConfigManager.enableConsentedProaDataAccess = true;

            const historyResource = {
                id: 'p1',
                resource: {
                    id: 'p1',
                    _uuid: 'uuid-p1',
                    resourceType: 'Patient',
                    meta: {
                        lastUpdated: '2023-01-01T00:00:00Z',
                        security: [
                            { system: 'https://www.icanbwell.com/access', code: 'tenantA' }
                        ]
                    }
                }
            };

            mockCursor.hasNext
                .mockResolvedValueOnce(true)
                .mockResolvedValueOnce(false);
            mockCursor.next.mockResolvedValueOnce(historyResource);
            getLastUpdatedISO.mockReturnValue('2023-01-01T00:00:00Z');

            await historyOp.fetchHistoryAsync({
                requestInfo: makeRequestInfo({
                    scope: 'user/*.read access/tenantA',
                    requestId: 'req-456'
                }),
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            });

            // Verify constructQueryAsync is called. The important thing is that
            // the dataSharingManager logic inside constructQueryAsync can still execute
            // even for history. The history operation should pass requestId so caching works.
            const callArgs = mockSearchManager.constructQueryAsync.mock.calls[0][0];
            // BUG: history does NOT pass requestId to constructQueryAsync, which means
            // dataSharingManager cache cannot function properly and consent logic may
            // not execute correctly for history queries
            expect(callArgs).toHaveProperty('requestId');
            expect(callArgs.requestId).toBeTruthy();
        });
    });

    describe('_history with useAccessIndex', () => {
        test('_history must pass useAccessIndex so optimized security tag queries are used', async () => {
            // When useAccessIndex is true, the SecurityTagManager uses the _access
            // field instead of meta.security for performance. The history operation
            // must also benefit from this optimization while maintaining security.
            mockConfigManager.useAccessIndex = true;

            const historyResource = {
                id: 'p1',
                resource: {
                    id: 'p1',
                    _uuid: 'uuid-p1',
                    resourceType: 'Patient',
                    _access: { tenantA: 1 },
                    meta: {
                        lastUpdated: '2023-01-01T00:00:00Z',
                        security: [
                            { system: 'https://www.icanbwell.com/access', code: 'tenantA' }
                        ]
                    }
                }
            };

            mockCursor.hasNext
                .mockResolvedValueOnce(true)
                .mockResolvedValueOnce(false);
            mockCursor.next.mockResolvedValueOnce(historyResource);
            getLastUpdatedISO.mockReturnValue('2023-01-01T00:00:00Z');

            await historyOp.fetchHistoryAsync({
                requestInfo: makeRequestInfo({ scope: 'user/*.read access/tenantA' }),
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            });

            const callArgs = mockSearchManager.constructQueryAsync.mock.calls[0][0];
            expect(callArgs.useAccessIndex).toBe(true);
            expect(callArgs.useHistoryTable).toBe(true);
        });
    });

    describe('_history returns meta.security in responses (information disclosure)', () => {
        test('_history response must not leak other tenant access codes in meta.security', async () => {
            // When a resource has multiple access tags (tenantA AND tenantB),
            // the _history response should not reveal that tenantB also has access.
            // This is an information disclosure issue: knowing which other clients
            // have access to a resource is sensitive.
            const historyResource = {
                id: 'p1',
                resource: {
                    id: 'p1',
                    _uuid: 'uuid-p1',
                    resourceType: 'Patient',
                    meta: {
                        versionId: '1',
                        lastUpdated: '2023-01-01T00:00:00Z',
                        security: [
                            { system: 'https://www.icanbwell.com/access', code: 'tenantA' },
                            { system: 'https://www.icanbwell.com/access', code: 'tenantB' },
                            { system: 'https://www.icanbwell.com/owner', code: 'tenantB' }
                        ]
                    }
                }
            };

            mockCursor.hasNext
                .mockResolvedValueOnce(true)
                .mockResolvedValueOnce(false);
            mockCursor.next.mockResolvedValueOnce(historyResource);
            getLastUpdatedISO.mockReturnValue('2023-01-01T00:00:00Z');

            // Track what entries are passed to the bundle manager
            let capturedEntries = null;
            mockBundleManager.createRawBundleFromEntries.mockImplementation((args) => {
                capturedEntries = args.entries;
                return { resourceType: 'Bundle', type: 'history', entry: args.entries };
            });

            await historyOp.fetchHistoryAsync({
                requestInfo: makeRequestInfo({ scope: 'user/*.read access/tenantA' }),
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            });

            expect(capturedEntries).not.toBeNull();
            expect(capturedEntries.length).toBe(1);

            // Check that the returned resource does NOT contain other tenants' access codes
            const returnedResource = capturedEntries[0].resource;
            const accessTags = returnedResource.meta.security.filter(
                s => s.system === 'https://www.icanbwell.com/access'
            );

            // EXPECTED BEHAVIOR: Only the requesting tenant's access tag should be visible
            // This FAILS because the history operation does not strip other tenants' security tags
            const otherTenantTags = accessTags.filter(s => s.code !== 'tenantA');
            expect(otherTenantTags).toHaveLength(0);
        });

        test('_history response must not expose owner tags from other tenants', async () => {
            // Owner tags reveal which organization owns the data - this is sensitive
            // cross-tenant information that should not be disclosed.
            const historyResource = {
                id: 'p1',
                resource: {
                    id: 'p1',
                    _uuid: 'uuid-p1',
                    resourceType: 'Patient',
                    meta: {
                        versionId: '1',
                        lastUpdated: '2023-01-01T00:00:00Z',
                        security: [
                            { system: 'https://www.icanbwell.com/access', code: 'tenantA' },
                            { system: 'https://www.icanbwell.com/owner', code: 'tenantB' },
                            { system: 'https://www.icanbwell.com/vendor', code: 'vendor-secret' }
                        ]
                    }
                }
            };

            mockCursor.hasNext
                .mockResolvedValueOnce(true)
                .mockResolvedValueOnce(false);
            mockCursor.next.mockResolvedValueOnce(historyResource);
            getLastUpdatedISO.mockReturnValue('2023-01-01T00:00:00Z');

            let capturedEntries = null;
            mockBundleManager.createRawBundleFromEntries.mockImplementation((args) => {
                capturedEntries = args.entries;
                return { resourceType: 'Bundle', type: 'history', entry: args.entries };
            });

            await historyOp.fetchHistoryAsync({
                requestInfo: makeRequestInfo({ scope: 'user/*.read access/tenantA' }),
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            });

            expect(capturedEntries).not.toBeNull();
            const returnedResource = capturedEntries[0].resource;

            // Owner and vendor tags from other tenants should be stripped
            const ownerTags = returnedResource.meta.security.filter(
                s => s.system === 'https://www.icanbwell.com/owner'
            );
            const otherOwnerTags = ownerTags.filter(s => s.code !== 'tenantA');
            expect(otherOwnerTags).toHaveLength(0);
        });
    });

    describe('_history with deleted resources', () => {
        test('deleted resource versions must not be visible to other tenants via _history', async () => {
            // When a resource is deleted, a "deleted" marker version is stored.
            // If that deleted version still has cross-tenant tags, it should not
            // be visible to the tenant that did NOT own the original resource.
            const deletedVersion = {
                id: 'p1',
                resource: {
                    id: 'p1',
                    _uuid: 'uuid-p1',
                    resourceType: 'Patient',
                    meta: {
                        versionId: '3',
                        lastUpdated: '2023-09-01T00:00:00Z',
                        security: [
                            { system: 'https://www.icanbwell.com/access', code: 'tenantB' }
                        ]
                    }
                },
                request: {
                    method: 'DELETE',
                    url: 'Patient/p1'
                }
            };

            mockCursor.hasNext
                .mockResolvedValueOnce(true)
                .mockResolvedValueOnce(false);
            mockCursor.next.mockResolvedValueOnce(deletedVersion);
            getLastUpdatedISO.mockReturnValue('2023-09-01T00:00:00Z');

            // Security filter MUST prevent tenantA from seeing tenantB's deleted resource
            mockSearchManager.constructQueryAsync.mockResolvedValue({
                query: {
                    'resource.meta.security': {
                        $elemMatch: {
                            system: 'https://www.icanbwell.com/access',
                            code: 'tenantA'
                        }
                    }
                },
                columns: new Set()
            });

            await historyOp.fetchHistoryAsync({
                requestInfo: makeRequestInfo({ scope: 'user/*.read access/tenantA' }),
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            });

            // The DB query MUST filter by tenantA's access tag
            const dbManager = mockDatabaseHistoryFactory.createDatabaseHistoryManager();
            const findCall = dbManager.findAsync.mock.calls[0][0];
            expect(findCall.query['resource.meta.security']).toBeDefined();
            // The filter must require tenantA access, which means tenantB-only
            // deleted records will be excluded at the DB level
            expect(findCall.query['resource.meta.security'].$elemMatch.code).toBe('tenantA');
        });
    });

    describe('_history with wildcard access scope', () => {
        test('wildcard access scope (*) must not bypass all security filtering', async () => {
            // A scope with 'access/*' means full access. However, even wildcard
            // access should not expose internal fields or other tenants' metadata
            // in the history response.
            const historyResource = {
                id: 'p1',
                resource: {
                    id: 'p1',
                    _uuid: 'uuid-p1',
                    _access: { tenantA: 1, tenantB: 1 },
                    _sourceAssigningAuthority: 'tenantB',
                    _sourceId: 'p1',
                    resourceType: 'Patient',
                    meta: {
                        versionId: '1',
                        lastUpdated: '2023-01-01T00:00:00Z',
                        security: [
                            { system: 'https://www.icanbwell.com/access', code: 'tenantA' },
                            { system: 'https://www.icanbwell.com/access', code: 'tenantB' }
                        ]
                    }
                }
            };

            mockCursor.hasNext
                .mockResolvedValueOnce(true)
                .mockResolvedValueOnce(false);
            mockCursor.next.mockResolvedValueOnce(historyResource);
            getLastUpdatedISO.mockReturnValue('2023-01-01T00:00:00Z');

            let capturedEntries = null;
            mockBundleManager.createRawBundleFromEntries.mockImplementation((args) => {
                capturedEntries = args.entries;
                return { resourceType: 'Bundle', type: 'history', entry: args.entries };
            });

            await historyOp.fetchHistoryAsync({
                requestInfo: makeRequestInfo({ scope: 'user/*.read access/tenantA' }),
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            });

            expect(capturedEntries).not.toBeNull();
            const returnedResource = capturedEntries[0].resource;

            // Internal fields (_access, _sourceAssigningAuthority, _sourceId) must NOT
            // be exposed in the response - they are internal implementation details
            expect(returnedResource).not.toHaveProperty('_access');
            expect(returnedResource).not.toHaveProperty('_sourceAssigningAuthority');
        });
    });

    describe('_history with historyById must also enforce tenant filtering', () => {
        test('historyById passes tenant security context to constructQueryAsync', async () => {
            // Instance-level history (/Patient/123/_history) must also filter.
            // Even though a specific resource ID is given, the history versions
            // themselves may have varying security tags over time.
            const { HistoryByIdOperation } = require('../../../../operations/historyById/historyById');
            const historyByIdOp = Object.create(HistoryByIdOperation.prototype);
            Object.assign(historyByIdOp, historyOp);
            historyByIdOp.currentOperationName = undefined;
            historyByIdOp.errorMessagePostfix = undefined;

            mockParsedArgs.id = 'patient-123';

            const historyResource = {
                id: 'patient-123',
                resource: {
                    id: 'patient-123',
                    _uuid: 'uuid-patient-123',
                    resourceType: 'Patient',
                    meta: {
                        lastUpdated: '2023-01-01T00:00:00Z',
                        security: [
                            { system: 'https://www.icanbwell.com/access', code: 'tenantA' }
                        ]
                    }
                }
            };

            mockCursor.hasNext
                .mockResolvedValueOnce(true)
                .mockResolvedValueOnce(false);
            mockCursor.next.mockResolvedValueOnce(historyResource);
            getLastUpdatedISO.mockReturnValue('2023-01-01T00:00:00Z');

            await historyByIdOp.historyByIdAsync({
                requestInfo: makeRequestInfo({
                    scope: 'user/*.read access/tenantA',
                    originalUrl: '/4_0_0/Patient/patient-123/_history'
                }),
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            });

            // Verify security context is passed properly
            const constructArgs = mockSearchManager.constructQueryAsync.mock.calls[0][0];
            expect(constructArgs.scope).toContain('access/tenantA');
            expect(constructArgs.useHistoryTable).toBe(true);
            expect(constructArgs.personIdFromJwtToken).toBe('person-1');
        });
    });

    describe('_history scope validation completeness', () => {
        test('_history must call scopesValidator before returning results', async () => {
            // Ensure that scopesValidator.verifyHasValidScopesAsync is called
            // BEFORE any database queries are made
            const historyResource = {
                id: 'p1',
                resource: {
                    id: 'p1',
                    _uuid: 'uuid-p1',
                    resourceType: 'Patient',
                    meta: { lastUpdated: '2023-01-01T00:00:00Z' }
                }
            };

            mockCursor.hasNext
                .mockResolvedValueOnce(true)
                .mockResolvedValueOnce(false);
            mockCursor.next.mockResolvedValueOnce(historyResource);
            getLastUpdatedISO.mockReturnValue('2023-01-01T00:00:00Z');

            await historyOp.fetchHistoryAsync({
                requestInfo: makeRequestInfo({ scope: 'user/*.read access/tenantA' }),
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            });

            // scopesValidator must be called
            expect(mockScopesValidator.verifyHasValidScopesAsync).toHaveBeenCalledTimes(1);
            expect(mockScopesValidator.verifyHasValidScopesAsync).toHaveBeenCalledWith(
                expect.objectContaining({
                    requestInfo: expect.objectContaining({ scope: 'user/*.read access/tenantA' }),
                    resourceType: 'Patient',
                    accessRequested: 'read'
                })
            );

            // scopesValidator must be called BEFORE the database query
            const scopesCallOrder = mockScopesValidator.verifyHasValidScopesAsync.mock.invocationCallOrder[0];
            const constructQueryOrder = mockSearchManager.constructQueryAsync.mock.invocationCallOrder[0];
            expect(scopesCallOrder).toBeLessThan(constructQueryOrder);
        });

        test('_history must reject requests with no valid access scopes', async () => {
            // If the user has no access scopes at all, _history must reject
            mockScopesValidator.verifyHasValidScopesAsync.mockRejectedValue(
                new ForbiddenError('No valid scopes')
            );

            await expect(
                historyOp.fetchHistoryAsync({
                    requestInfo: makeRequestInfo({ scope: '' }),
                    parsedArgs: mockParsedArgs,
                    resourceType: 'Patient'
                })
            ).rejects.toThrow(ForbiddenError);
        });
    });

    describe('_history must not expose versions from before tenant access was granted', () => {
        test('query must use per-entry security filtering not just resource-level filtering', async () => {
            // Critical: In the history table, each entry stores the resource AS IT WAS
            // at that point in time. The security tag query on useHistoryTable=true
            // prefixes fields with 'resource.' - this means it filters on each
            // INDIVIDUAL history entry's security tags, not the current version.
            //
            // This is the CORRECT behavior - verify it is preserved.
            mockSearchManager.constructQueryAsync.mockImplementation(async (args) => {
                // Verify the call includes useHistoryTable flag
                expect(args.useHistoryTable).toBe(true);

                // Return a properly prefixed query for the history table
                return {
                    query: {
                        'resource.meta.security': {
                            $elemMatch: {
                                system: 'https://www.icanbwell.com/access',
                                code: 'tenantA'
                            }
                        }
                    },
                    columns: new Set()
                };
            });

            const historyResource = {
                id: 'p1',
                resource: {
                    id: 'p1',
                    _uuid: 'uuid-p1',
                    resourceType: 'Patient',
                    meta: {
                        lastUpdated: '2023-01-01T00:00:00Z',
                        security: [
                            { system: 'https://www.icanbwell.com/access', code: 'tenantA' }
                        ]
                    }
                }
            };

            mockCursor.hasNext
                .mockResolvedValueOnce(true)
                .mockResolvedValueOnce(false);
            mockCursor.next.mockResolvedValueOnce(historyResource);
            getLastUpdatedISO.mockReturnValue('2023-01-01T00:00:00Z');

            await historyOp.fetchHistoryAsync({
                requestInfo: makeRequestInfo({ scope: 'user/*.read access/tenantA' }),
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            });

            // Verify the DB query uses 'resource.' prefixed field names (history table format)
            const dbManager = mockDatabaseHistoryFactory.createDatabaseHistoryManager();
            const findCall = dbManager.findAsync.mock.calls[0][0];

            // The query must use 'resource.meta.security' NOT 'meta.security'
            // because history table stores data as { resource: { ... }, request: { ... } }
            const queryStr = JSON.stringify(findCall.query);
            expect(queryStr).toContain('resource.meta.security');
            expect(queryStr).not.toMatch(/^{"meta\.security"/);
        });
    });
});
