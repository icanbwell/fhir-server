const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

/**
 * HITRUST / FHIR Server Admin Authorization Gap Tests
 *
 * These tests verify that admin endpoints enforce PROPER authorization checks:
 * 1. Write operations (POST/DELETE/PUT) require admin write scopes, not just read
 * 2. Restricted user types (cmsPartnerUser) are blocked from admin endpoints
 * 3. Read-only admin scopes cannot perform destructive operations
 * 4. Cache invalidation requires explicit admin/*.write scope
 * 5. Data deletion endpoints require fine-grained authorization
 *
 * Tests assert CORRECT behavior so they FAIL when the code has authorization gaps.
 */

// Mock dependencies before requiring the module
jest.mock('express-http-context', () => ({
    set: jest.fn(),
    get: jest.fn()
}));

jest.mock('../../../operations/common/logging', () => ({
    logInfo: jest.fn(),
    logError: jest.fn()
}));

jest.mock('../../../utils/uid.util', () => ({
    generateUUID: jest.fn().mockReturnValue('mock-uuid-1234')
}));

jest.mock('../../../utils/isTrue', () => ({
    isTrue: jest.fn((val) => val === 'true' || val === true)
}));

jest.mock('../../../admin/adminExportManager', () => ({
    AdminExportManager: jest.fn()
}));

jest.mock('../../../admin/adminLogManager', () => ({
    AdminLogManager: jest.fn().mockImplementation(() => ({
        getLogAsync: jest.fn().mockResolvedValue({ log: 'data' })
    }))
}));

jest.mock('../../../utils/fhirResponseStreamer', () => ({
    FhirResponseStreamer: jest.fn().mockImplementation(() => ({
        startAsync: jest.fn().mockResolvedValue(undefined),
        writeAsync: jest.fn().mockResolvedValue(undefined),
        endAsync: jest.fn().mockResolvedValue(undefined)
    }))
}));

jest.mock('../../../utils/fhirRequestInfoBuilder', () => ({
    FhirRequestInfoBuilder: {
        fromRequest: jest.fn().mockReturnValue({ requestId: 'mock-req-id' })
    }
}));

jest.mock('@asymmetrik/sof-scope-checker', () => {
    return jest.fn().mockReturnValue({ success: true });
});

const { handleAdminGet, handleAdminPost, handleAdminDelete, handleAdminPut } = require('../../../routeHandlers/admin');

describe('Admin Authorization Gaps - HITRUST Compliance', () => {
    let mockReq;
    let mockRes;
    let mockContainer;
    let fnGetContainer;

    beforeEach(() => {
        mockReq = {
            id: null,
            header: jest.fn().mockReturnValue(null),
            params: { op: null, id: null },
            query: {},
            body: {},
            authInfo: { context: {} }
        };

        mockRes = {
            json: jest.fn().mockReturnThis(),
            status: jest.fn().mockReturnThis()
        };

        mockContainer = {
            scopesManager: {
                getScopeFromRequest: jest.fn(),
                getAdminScopes: jest.fn(),
                parseScopes: jest.fn()
            },
            indexManager: {
                compareCurrentIndexesWithConfigurationInAllCollectionsAsync: jest.fn().mockResolvedValue([]),
                synchronizeIndexesWithConfigAsync: jest.fn().mockResolvedValue({})
            },
            adminExportManager: {
                getExportStatus: jest.fn().mockResolvedValue({ status: 'completed' }),
                updateExportStatus: jest.fn().mockResolvedValue({ status: 'updated' }),
                triggerExportJob: jest.fn().mockResolvedValue({ status: 'triggered' })
            },
            adminPersonPatientLinkManager: {
                showPersonToPersonLinkAsync: jest.fn().mockResolvedValue({ links: [] }),
                createPersonToPersonLinkAsync: jest.fn().mockResolvedValue({ created: true }),
                removePersonToPersonLinkAsync: jest.fn().mockResolvedValue({ removed: true }),
                createPersonToPatientLinkAsync: jest.fn().mockResolvedValue({ created: true }),
                removePersonToPatientLinkAsync: jest.fn().mockResolvedValue({ removed: true }),
                updatePatientLinkAsync: jest.fn().mockResolvedValue({ updated: true }),
                deletePersonAsync: jest.fn().mockResolvedValue({ deleted: true })
            },
            adminPersonPatientDataManager: {
                deletePatientDataGraphAsync: jest.fn().mockResolvedValue({ deleted: true }),
                deletePersonDataGraphAsync: jest.fn().mockResolvedValue({ deleted: true })
            },
            personMatchManager: {
                personMatchAsync: jest.fn().mockResolvedValue({ match: true }),
                personOneToNMatchAsync: jest.fn().mockResolvedValue({ matches: [] }),
                runMatchWithPayloadAsync: jest.fn().mockResolvedValue({ result: 'done' })
            },
            configManager: {
                enableAccessLogsClickHouse: false
            },
            adminAccessLogClickHouseManager: {
                getLogAsync: jest.fn().mockResolvedValue({ log: 'data' })
            },
            mongoDatabaseManager: {},
            fhirCacheKeyManager: {
                getAllKeysForResource: jest.fn().mockResolvedValue({ keys: [] }),
                invalidateCacheKeysForResource: jest.fn().mockResolvedValue(),
                invalidateCacheKeys: jest.fn().mockResolvedValue()
            }
        };

        fnGetContainer = jest.fn().mockReturnValue(mockContainer);
    });

    describe('Write operations must require admin write scope (not just any admin scope)', () => {
        test('POST invalidateCache returns 403 when user has only admin/*.read scope', async () => {
            // A user with admin/*.read should NOT be able to invalidate caches (a write operation).
            // Correct behavior: 403 Forbidden
            mockContainer.scopesManager.getScopeFromRequest.mockReturnValue('admin/*.read');
            mockContainer.scopesManager.getAdminScopes.mockReturnValue(['admin/*.read']);

            mockReq.params.op = 'invalidateCache';
            mockReq.body = { resourceType: 'Patient', resourceId: 'p-1' };

            await handleAdminPost(fnGetContainer, mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(403);
            expect(mockContainer.fhirCacheKeyManager.invalidateCacheKeysForResource).not.toHaveBeenCalled();
        });

        test('POST createPersonToPersonLink returns 403 when user has only admin/*.read scope', async () => {
            // Creating links is a write operation; admin/*.read alone should not authorize it.
            mockContainer.scopesManager.getScopeFromRequest.mockReturnValue('admin/*.read');
            mockContainer.scopesManager.getAdminScopes.mockReturnValue(['admin/*.read']);

            mockReq.params.op = 'createPersonToPersonLink';
            mockReq.body = { bwellPersonId: 'bwell-1', externalPersonId: 'ext-1' };

            await handleAdminPost(fnGetContainer, mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(403);
            expect(mockContainer.adminPersonPatientLinkManager.createPersonToPersonLinkAsync).not.toHaveBeenCalled();
        });

        test('POST removePersonToPersonLink returns 403 when user has only admin/*.read scope', async () => {
            // Removing links is a write/delete operation; read scope is insufficient.
            mockContainer.scopesManager.getScopeFromRequest.mockReturnValue('admin/*.read');
            mockContainer.scopesManager.getAdminScopes.mockReturnValue(['admin/*.read']);

            mockReq.params.op = 'removePersonToPersonLink';
            mockReq.body = { bwellPersonId: 'bwell-1', externalPersonId: 'ext-1' };

            await handleAdminPost(fnGetContainer, mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(403);
            expect(mockContainer.adminPersonPatientLinkManager.removePersonToPersonLinkAsync).not.toHaveBeenCalled();
        });

        test('DELETE deletePerson returns 403 when user has only admin/*.read scope', async () => {
            // Deleting a person is a destructive write; read scope must not allow it.
            mockContainer.scopesManager.getScopeFromRequest.mockReturnValue('admin/*.read');
            mockContainer.scopesManager.getAdminScopes.mockReturnValue(['admin/*.read']);

            mockReq.params.op = 'deletePerson';
            mockReq.query = { personId: 'per-1' };

            await handleAdminDelete(fnGetContainer, mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(403);
            expect(mockContainer.adminPersonPatientLinkManager.deletePersonAsync).not.toHaveBeenCalled();
        });

        test('DELETE deletePatientDataGraph returns 403 when user has only admin/*.read scope', async () => {
            // Deleting an entire patient data graph is extremely destructive.
            mockContainer.scopesManager.getScopeFromRequest.mockReturnValue('admin/*.read');
            mockContainer.scopesManager.getAdminScopes.mockReturnValue(['admin/*.read']);

            mockReq.params.op = 'deletePatientDataGraph';
            mockReq.query = { id: 'pat-1', sync: 'true' };

            await handleAdminDelete(fnGetContainer, mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(403);
            expect(mockContainer.adminPersonPatientDataManager.deletePatientDataGraphAsync).not.toHaveBeenCalled();
        });

        test('DELETE deletePersonDataGraph returns 403 when user has only admin/*.read scope', async () => {
            mockContainer.scopesManager.getScopeFromRequest.mockReturnValue('admin/*.read');
            mockContainer.scopesManager.getAdminScopes.mockReturnValue(['admin/*.read']);

            mockReq.params.op = 'deletePersonDataGraph';
            mockReq.query = { id: 'per-1' };

            await handleAdminDelete(fnGetContainer, mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(403);
            expect(mockContainer.adminPersonPatientDataManager.deletePersonDataGraphAsync).not.toHaveBeenCalled();
        });

        test('PUT ExportStatus returns 403 when user has only admin/*.read scope', async () => {
            // Updating export status is a write operation.
            mockContainer.scopesManager.getScopeFromRequest.mockReturnValue('admin/*.read');
            mockContainer.scopesManager.getAdminScopes.mockReturnValue(['admin/*.read']);

            mockReq.params.op = 'ExportStatus';
            mockReq.params.id = 'export-1';

            await handleAdminPut(fnGetContainer, mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(403);
            expect(mockContainer.adminExportManager.updateExportStatus).not.toHaveBeenCalled();
        });

        test('GET synchronizeIndexes returns 403 when user has only admin/*.read scope', async () => {
            // synchronizeIndexes mutates database indexes; it is a write operation despite using GET.
            // A read-only admin scope must not be able to trigger index synchronization.
            mockContainer.scopesManager.getScopeFromRequest.mockReturnValue('admin/*.read');
            mockContainer.scopesManager.getAdminScopes.mockReturnValue(['admin/*.read']);

            mockReq.params.op = 'synchronizeIndexes';

            await handleAdminGet(fnGetContainer, mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(403);
            expect(mockContainer.indexManager.synchronizeIndexesWithConfigAsync).not.toHaveBeenCalled();
        });
    });

    describe('Restricted user types must be blocked from admin endpoints', () => {
        test('POST invalidateCache returns 403 for cmsPartnerUser even with admin scopes', async () => {
            // cmsPartnerUser is a restricted user type blocked from GraphQL;
            // they must also be blocked from admin endpoints.
            mockContainer.scopesManager.getScopeFromRequest.mockReturnValue('admin/*.read admin/*.write');
            mockContainer.scopesManager.getAdminScopes.mockReturnValue(['admin/*.read', 'admin/*.write']);
            mockReq.authInfo = { context: { userType: 'cmsPartnerUser' } };

            mockReq.params.op = 'invalidateCache';
            mockReq.body = { resourceType: 'Patient', resourceId: 'p-1' };

            await handleAdminPost(fnGetContainer, mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(403);
            expect(mockContainer.fhirCacheKeyManager.invalidateCacheKeysForResource).not.toHaveBeenCalled();
        });

        test('GET indexes returns 403 for cmsPartnerUser even with admin scopes', async () => {
            mockContainer.scopesManager.getScopeFromRequest.mockReturnValue('admin/*.read');
            mockContainer.scopesManager.getAdminScopes.mockReturnValue(['admin/*.read']);
            mockReq.authInfo = { context: { userType: 'cmsPartnerUser' } };

            mockReq.params.op = 'indexes';

            await handleAdminGet(fnGetContainer, mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(403);
            expect(mockContainer.indexManager.compareCurrentIndexesWithConfigurationInAllCollectionsAsync).not.toHaveBeenCalled();
        });

        test('DELETE deletePerson returns 403 for cmsPartnerUser even with admin scopes', async () => {
            mockContainer.scopesManager.getScopeFromRequest.mockReturnValue('admin/*.read admin/*.write');
            mockContainer.scopesManager.getAdminScopes.mockReturnValue(['admin/*.read', 'admin/*.write']);
            mockReq.authInfo = { context: { userType: 'cmsPartnerUser' } };

            mockReq.params.op = 'deletePerson';
            mockReq.query = { personId: 'per-1' };

            await handleAdminDelete(fnGetContainer, mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(403);
            expect(mockContainer.adminPersonPatientLinkManager.deletePersonAsync).not.toHaveBeenCalled();
        });
    });

    describe('Granular scope enforcement for sensitive operations', () => {
        test('POST invalidateCache requires explicit cache-invalidation scope or admin/*.write', async () => {
            // A narrow admin scope like admin/export.read should NOT grant cache invalidation access.
            // Only admin/*.write or a specific admin/cache.write scope should.
            mockContainer.scopesManager.getScopeFromRequest.mockReturnValue('admin/export.read');
            mockContainer.scopesManager.getAdminScopes.mockReturnValue(['admin/export.read']);

            mockReq.params.op = 'invalidateCache';
            mockReq.body = { resourceType: 'Patient', resourceId: 'p-1' };

            await handleAdminPost(fnGetContainer, mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(403);
            expect(mockContainer.fhirCacheKeyManager.invalidateCacheKeysForResource).not.toHaveBeenCalled();
        });

        test('DELETE deletePatientDataGraph requires explicit write scope, not admin/export.read', async () => {
            // A narrow read scope on exports must not permit data graph deletion.
            mockContainer.scopesManager.getScopeFromRequest.mockReturnValue('admin/export.read');
            mockContainer.scopesManager.getAdminScopes.mockReturnValue(['admin/export.read']);
            mockContainer.scopesManager.parseScopes.mockReturnValue(['admin/export.read']);

            mockReq.params.op = 'deletePatientDataGraph';
            mockReq.query = { id: 'pat-1', sync: 'true' };

            await handleAdminDelete(fnGetContainer, mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(403);
            expect(mockContainer.adminPersonPatientDataManager.deletePatientDataGraphAsync).not.toHaveBeenCalled();
        });

        test('POST triggerExport requires admin write scope, not just any admin scope', async () => {
            // Triggering an export is a write action.
            mockContainer.scopesManager.getScopeFromRequest.mockReturnValue('admin/logs.read');
            mockContainer.scopesManager.getAdminScopes.mockReturnValue(['admin/logs.read']);

            mockReq.params.op = 'triggerExport';
            mockReq.params.id = 'export-1';

            await handleAdminPost(fnGetContainer, mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(403);
            expect(mockContainer.adminExportManager.triggerExportJob).not.toHaveBeenCalled();
        });

        test('POST runMatchWithPayload requires admin write scope, not just any admin scope', async () => {
            // Running a match with payload is a mutating operation that should require write.
            mockContainer.scopesManager.getScopeFromRequest.mockReturnValue('admin/logs.read');
            mockContainer.scopesManager.getAdminScopes.mockReturnValue(['admin/logs.read']);

            mockReq.params.op = 'runMatchWithPayload';
            mockReq.body = { resourceType: 'Patient', resource: {} };

            await handleAdminPost(fnGetContainer, mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(403);
            expect(mockContainer.personMatchManager.runMatchWithPayloadAsync).not.toHaveBeenCalled();
        });
    });

    describe('Admin route authentication enforcement does not rely solely on network isolation', () => {
        test('handleAdminGet returns 401/403 when scope is undefined (unauthenticated request passed through)', async () => {
            // If somehow an unauthenticated request gets past the middleware (e.g., misconfigured
            // gateway), the handler itself must still reject it. getScopeFromRequest returns undefined
            // for unauthenticated requests.
            mockContainer.scopesManager.getScopeFromRequest.mockReturnValue(undefined);
            mockContainer.scopesManager.getAdminScopes.mockReturnValue([]);

            mockReq.params.op = 'indexes';

            await handleAdminGet(fnGetContainer, mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(403);
        });

        test('handleAdminPost returns 401/403 when scope is undefined', async () => {
            mockContainer.scopesManager.getScopeFromRequest.mockReturnValue(undefined);
            mockContainer.scopesManager.getAdminScopes.mockReturnValue([]);

            mockReq.params.op = 'invalidateCache';
            mockReq.body = { resourceType: 'Patient', resourceId: 'p-1' };

            await handleAdminPost(fnGetContainer, mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(403);
        });

        test('handleAdminDelete returns 401/403 when scope is undefined', async () => {
            mockContainer.scopesManager.getScopeFromRequest.mockReturnValue(undefined);
            mockContainer.scopesManager.getAdminScopes.mockReturnValue([]);

            mockReq.params.op = 'deletePerson';
            mockReq.query = { personId: 'per-1' };

            await handleAdminDelete(fnGetContainer, mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(403);
        });

        test('handleAdminPut returns 401/403 when scope is undefined', async () => {
            mockContainer.scopesManager.getScopeFromRequest.mockReturnValue(undefined);
            mockContainer.scopesManager.getAdminScopes.mockReturnValue([]);

            mockReq.params.op = 'ExportStatus';
            mockReq.params.id = 'export-1';

            await handleAdminPut(fnGetContainer, mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(403);
        });
    });

    describe('Admin scope check differentiates read vs write access level', () => {
        test('getAdminScopes with read-only scope must not grant write access to handler', async () => {
            // This test verifies that admin handlers differentiate between read and write scopes.
            // A user with ONLY admin/*.read should be rejected from write operations.
            // The handler must inspect the scope to determine if write access is present.
            mockContainer.scopesManager.getScopeFromRequest.mockReturnValue('admin/*.read');
            mockContainer.scopesManager.getAdminScopes.mockReturnValue(['admin/*.read']);

            // Attempt a write operation (updatePatientReference) with only read scope
            mockReq.params.op = 'updatePatientReference';
            mockReq.body = { patientId: 'pat-1', resourceType: 'Observation', resourceId: 'obs-1' };

            await handleAdminPost(fnGetContainer, mockReq, mockRes);

            // Correct behavior: should be rejected because admin/*.read is not sufficient for POST
            expect(mockRes.status).toHaveBeenCalledWith(403);
            expect(mockContainer.adminPersonPatientLinkManager.updatePatientLinkAsync).not.toHaveBeenCalled();
        });

        test('getAdminScopes with write scope should allow write operations', async () => {
            // Positive test: admin/*.write should allow POST operations
            mockContainer.scopesManager.getScopeFromRequest.mockReturnValue('admin/*.write');
            mockContainer.scopesManager.getAdminScopes.mockReturnValue(['admin/*.write']);

            mockReq.params.op = 'invalidateCache';
            mockReq.body = { resourceType: 'Patient', resourceId: 'p-1' };

            await handleAdminPost(fnGetContainer, mockReq, mockRes);

            // With write scope, the operation should proceed (not 403)
            expect(mockRes.status).not.toHaveBeenCalledWith(403);
            expect(mockContainer.fhirCacheKeyManager.invalidateCacheKeysForResource).toHaveBeenCalled();
        });
    });
});
