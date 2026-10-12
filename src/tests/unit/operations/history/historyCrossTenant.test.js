/**
 * Cross-tenant data exposure tests for the FHIR _history operation.
 *
 * A historical version keeps the access tags it had at write time, so a tenant-scoped access
 * code can match a stale tag on an old version (SEC-1580 SAE-1). History therefore requires a
 * non-tenant-specific access scope (access/*.read or access/*.*): ScopesManager.hasHistoryAccess
 * denies every tenant-scoped caller before any query is built, and the callers that are allowed
 * (access/*) are entitled to see every version as stored.
 *
 * These tests use the real ScopesManager so the denial is decided by production code, not by a mock.
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
const { ScopesManager } = require('../../../../operations/security/scopesManager');

const WILDCARD_ACCESS_SCOPE = 'user/*.read access/*.*';
const TENANT_A_SCOPE = 'user/*.read access/tenantA.*';

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
            verifyHasValidScopesAsync: jest.fn().mockResolvedValue(undefined),
            isAdminScope: jest.fn().mockReturnValue(true)
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
            enableConsentedProaDataAccess: false
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
        historyOp.scopesManager = new ScopesManager({
            configManager: mockConfigManager,
            patientFilterManager: {}
        });
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
            scope: WILDCARD_ACCESS_SCOPE,
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

    function makeHistoryEntry({ id = 'p1', accessCodes = ['tenantA'], ownerCode, extraResourceFields = {} } = {}) {
        const security = accessCodes.map(code => ({ system: 'https://www.icanbwell.com/access', code }));
        if (ownerCode) {
            security.push({ system: 'https://www.icanbwell.com/owner', code: ownerCode });
        }
        return {
            id,
            resource: {
                id,
                _uuid: `uuid-${id}`,
                resourceType: 'Patient',
                meta: { versionId: '1', lastUpdated: '2023-01-01T00:00:00Z', security },
                ...extraResourceFields
            }
        };
    }

    function mockCursorReturning(...entries) {
        entries.forEach(() => mockCursor.hasNext.mockResolvedValueOnce(true));
        mockCursor.hasNext.mockResolvedValueOnce(false);
        entries.forEach(entry => mockCursor.next.mockResolvedValueOnce(entry));
        getLastUpdatedISO.mockReturnValue('2023-01-01T00:00:00Z');
    }

    /**
     * A tenant-scoped caller must be rejected before a query is built or any data is read,
     * and the failure must be logged.
     */
    async function expectHistoryDenied({ scope = TENANT_A_SCOPE } = {}) {
        await expect(
            historyOp.fetchHistoryAsync({
                requestInfo: makeRequestInfo({ scope }),
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            })
        ).rejects.toThrow(ForbiddenError);

        expect(mockSearchManager.constructQueryAsync).not.toHaveBeenCalled();
        expect(mockDatabaseHistoryFactory.createDatabaseHistoryManager).not.toHaveBeenCalled();
        expect(mockCursor.hasNext).not.toHaveBeenCalled();
        expect(mockBundleManager.createRawBundleFromEntries).not.toHaveBeenCalled();
        expect(mockFhirLoggingManager.logOperationFailureAsync).toHaveBeenCalledTimes(1);
    }

    describe('security tag filtering in _history queries', () => {
        test('_history passes scope and history-table flag to constructQueryAsync', async () => {
            mockCursorReturning(makeHistoryEntry());

            await historyOp.fetchHistoryAsync({
                requestInfo: makeRequestInfo(),
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            });

            expect(mockSearchManager.constructQueryAsync).toHaveBeenCalledTimes(1);
            const callArgs = mockSearchManager.constructQueryAsync.mock.calls[0][0];
            expect(callArgs.scope).toBe(WILDCARD_ACCESS_SCOPE);
            expect(callArgs.useHistoryTable).toBe(true);
            // The operation should be READ to ensure the same security checks
            expect(callArgs.operation).toBe('READ');
        });

        test('_history denies a tenant-scoped caller so another tenant\'s versions are never queried', async () => {
            mockCursorReturning(
                makeHistoryEntry({ id: 'p1', accessCodes: ['tenantA'] }),
                makeHistoryEntry({ id: 'p2', accessCodes: ['tenantB'] })
            );

            await expectHistoryDenied({ scope: TENANT_A_SCOPE });

            expect(mockCursor.next).not.toHaveBeenCalled();
        });

        test('type-level _history with wildcard access queries the history table for the requested type', async () => {
            mockCursorReturning(makeHistoryEntry());

            await historyOp.fetchHistoryAsync({
                requestInfo: makeRequestInfo({ originalUrl: '/4_0_0/Patient/_history' }),
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            });

            // useHistoryTable: true makes field paths use the 'resource.' prefix
            const constructArgs = mockSearchManager.constructQueryAsync.mock.calls[0][0];
            expect(constructArgs.useHistoryTable).toBe(true);
            expect(constructArgs.resourceType).toBe('Patient');
            expect(constructArgs.scope).toContain('access/*');
        });
    });

    describe('consent changes and _history', () => {
        test('a tenant granted access later cannot read history, whatever combination of tenant codes it holds', async () => {
            // Versions written before the grant would otherwise be reachable through stale tags
            mockCursorReturning(
                makeHistoryEntry({ id: 'p1', accessCodes: ['tenantB'] }),
                makeHistoryEntry({ id: 'p1', accessCodes: ['tenantA', 'tenantB'] })
            );

            await expectHistoryDenied({ scope: 'user/*.read access/tenantA.* access/tenantB.*' });
        });

        test('a tenant whose access was revoked cannot read earlier versions: denial happens before any data access', async () => {
            mockCursorReturning(
                makeHistoryEntry({ id: 'p1', accessCodes: ['tenantB'] }),
                makeHistoryEntry({ id: 'p1', accessCodes: ['tenantA', 'tenantB'] })
            );

            await expectHistoryDenied({ scope: 'user/*.read access/tenantA.read' });
        });
    });

    describe('_history with data sharing (PROA consent)', () => {
        test('_history never requests consented PROA data access, even when the feature is enabled', async () => {
            // PROA expansion is scoped to Person $everything only (docs/resource-authorization.md §6a)
            mockConfigManager.enableConsentedProaDataAccess = true;
            mockCursorReturning(makeHistoryEntry());

            await historyOp.fetchHistoryAsync({
                requestInfo: makeRequestInfo({ requestId: 'req-456' }),
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            });

            const callArgs = mockSearchManager.constructQueryAsync.mock.calls[0][0];
            expect(callArgs).not.toHaveProperty('requestId');
            expect(callArgs.allowConsentedProaDataAccess).toBeUndefined();
        });
    });

    describe('_history with useAccessIndex', () => {
        test('_history must pass useAccessIndex so optimized security tag queries are used', async () => {
            mockConfigManager.useAccessIndex = true;
            mockCursorReturning(makeHistoryEntry({ extraResourceFields: { _access: { tenantA: 1 } } }));

            await historyOp.fetchHistoryAsync({
                requestInfo: makeRequestInfo(),
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            });

            const callArgs = mockSearchManager.constructQueryAsync.mock.calls[0][0];
            expect(callArgs.useAccessIndex).toBe(true);
            expect(callArgs.useHistoryTable).toBe(true);
        });
    });

    describe('_history returns meta.security in responses (information disclosure)', () => {
        test('a tenant-scoped caller gets no bundle even when stored versions carry other tenants\' access codes', async () => {
            mockCursorReturning(
                makeHistoryEntry({ accessCodes: ['tenantA', 'tenantB'], ownerCode: 'tenantB' })
            );

            await expectHistoryDenied({ scope: TENANT_A_SCOPE });
        });

        test('a tenant-scoped caller is denied before any version carrying another tenant\'s owner tag is read', async () => {
            mockCursorReturning(
                makeHistoryEntry({ accessCodes: ['tenantA'], ownerCode: 'tenantB' })
            );

            await expectHistoryDenied({ scope: TENANT_A_SCOPE });

            expect(mockCursor.next).not.toHaveBeenCalled();
        });
    });

    describe('_history with deleted resources', () => {
        test('a deleted version of another tenant\'s resource is not reachable by a tenant-scoped caller', async () => {
            const deletedVersion = {
                ...makeHistoryEntry({ accessCodes: ['tenantB'] }),
                request: { method: 'DELETE', url: 'Patient/p1' }
            };
            mockCursorReturning(deletedVersion);

            await expectHistoryDenied({ scope: TENANT_A_SCOPE });

            expect(mockCursor.next).not.toHaveBeenCalled();
        });
    });

    describe('_history with wildcard access scope', () => {
        test('wildcard access scope (*) is allowed history and receives the versions as stored', async () => {
            // access/* callers are entitled to every tenant's data; only they can read history
            const stored = makeHistoryEntry({ accessCodes: ['tenantA', 'tenantB'] });
            mockCursorReturning(stored);

            let capturedEntries = null;
            mockBundleManager.createRawBundleFromEntries.mockImplementation((args) => {
                capturedEntries = args.entries;
                return { resourceType: 'Bundle', type: 'history', entry: args.entries };
            });

            await historyOp.fetchHistoryAsync({
                requestInfo: makeRequestInfo(),
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            });

            expect(mockFhirLoggingManager.logOperationFailureAsync).not.toHaveBeenCalled();
            expect(capturedEntries).toHaveLength(1);
            expect(capturedEntries[0].resource.id).toBe('p1');
        });
    });

    describe('_history with historyById must also enforce tenant filtering', () => {
        test('historyById passes tenant security context to constructQueryAsync', async () => {
            // Instance-level history (/Patient/123/_history) goes through the same
            // fetchHistoryAsync, so it gets the same scope check and query context.
            const { HistoryByIdOperation } = require('../../../../operations/historyById/historyById');
            const historyByIdOp = Object.create(HistoryByIdOperation.prototype);
            Object.assign(historyByIdOp, historyOp);
            historyByIdOp.currentOperationName = undefined;
            historyByIdOp.errorMessagePostfix = undefined;

            mockParsedArgs.id = 'patient-123';
            mockCursorReturning(makeHistoryEntry({ id: 'patient-123' }));

            await historyByIdOp.historyByIdAsync({
                requestInfo: makeRequestInfo({ originalUrl: '/4_0_0/Patient/patient-123/_history' }),
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            });

            const constructArgs = mockSearchManager.constructQueryAsync.mock.calls[0][0];
            expect(constructArgs.scope).toContain('access/*');
            expect(constructArgs.useHistoryTable).toBe(true);
            expect(constructArgs.personIdFromJwtToken).toBe('person-1');
        });
    });

    describe('_history scope validation completeness', () => {
        test('_history must call scopesValidator before returning results', async () => {
            mockCursorReturning(makeHistoryEntry());

            await historyOp.fetchHistoryAsync({
                requestInfo: makeRequestInfo(),
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            });

            expect(mockScopesValidator.verifyHasValidScopesAsync).toHaveBeenCalledTimes(1);
            expect(mockScopesValidator.verifyHasValidScopesAsync).toHaveBeenCalledWith(
                expect.objectContaining({
                    requestInfo: expect.objectContaining({ scope: WILDCARD_ACCESS_SCOPE }),
                    resourceType: 'Patient',
                    accessRequested: 'read'
                })
            );

            // scopesValidator must be called BEFORE the database query is built
            const scopesCallOrder = mockScopesValidator.verifyHasValidScopesAsync.mock.invocationCallOrder[0];
            const constructQueryOrder = mockSearchManager.constructQueryAsync.mock.invocationCallOrder[0];
            expect(scopesCallOrder).toBeLessThan(constructQueryOrder);
        });

        test('_history must reject requests with no valid access scopes', async () => {
            await expectHistoryDenied({ scope: '' });
        });
    });

    describe('_history query construction', () => {
        test('the query built for the caller is passed unchanged to the history table, newest first', async () => {
            // Each history entry stores the resource as it was at that point in time, so field
            // paths carry the 'resource.' prefix (useHistoryTable: true) -- the query itself is
            // built by constructQueryAsync and must reach the history collection untouched.
            const securityQuery = {
                'resource.meta.security': {
                    $elemMatch: { system: 'https://www.icanbwell.com/access', code: 'tenantA' }
                }
            };
            mockSearchManager.constructQueryAsync.mockImplementation(async (args) => {
                expect(args.useHistoryTable).toBe(true);
                return { query: securityQuery, columns: new Set() };
            });
            mockCursorReturning(makeHistoryEntry());

            await historyOp.fetchHistoryAsync({
                requestInfo: makeRequestInfo(),
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            });

            const dbManager = mockDatabaseHistoryFactory.createDatabaseHistoryManager();
            expect(dbManager.findAsync).toHaveBeenCalledWith({
                query: securityQuery,
                options: { sort: { 'resource.meta.lastUpdated': -1 } }
            });
        });
    });
});
