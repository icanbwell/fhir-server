const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

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

// Mock modules that have deep dependency chains pulling in ESM/k8s
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

describe('routeHandlers/admin', () => {
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
            body: {}
        };

        mockRes = {
            json: jest.fn().mockReturnThis(),
            status: jest.fn().mockReturnThis()
        };

        mockContainer = {
            scopesManager: {
                getScopeFromRequest: jest.fn().mockReturnValue('admin/*.read admin/*.write'),
                getAdminScopes: jest.fn().mockReturnValue(['admin/*.read']),
                parseScopes: jest.fn().mockReturnValue(['admin/*.read', 'admin/*.write', 'user/Patient.write'])
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

    describe('handleAdminGet', () => {
        test('returns 403 when no admin scopes', async () => {
            mockContainer.scopesManager.getAdminScopes.mockReturnValue([]);
            mockReq.params.op = 'indexes';
            await handleAdminGet(fnGetContainer, mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(403);
            expect(mockRes.json).toHaveBeenCalledWith(
                expect.objectContaining({ message: expect.stringContaining('Missing scopes') })
            );
        });

        test('handles searchLogResults with valid id', async () => {
            mockReq.params.op = 'searchLogResults';
            mockReq.query = { id: 'valid-id-123' };
            await handleAdminGet(fnGetContainer, mockReq, mockRes);
            expect(mockRes.json).toHaveBeenCalled();
        });

        test('handles searchLogResults with invalid id (object)', async () => {
            mockReq.params.op = 'searchLogResults';
            mockReq.query = { id: { $gt: '' } };
            await handleAdminGet(fnGetContainer, mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(400);
        });

        test('handles searchLogResults with no id', async () => {
            mockReq.params.op = 'searchLogResults';
            mockReq.query = {};
            await handleAdminGet(fnGetContainer, mockReq, mockRes);
            expect(mockRes.json).toHaveBeenCalledWith({ message: 'No id passed' });
        });

        test('handles searchLogResults with ClickHouse enabled', async () => {
            mockReq.params.op = 'searchLogResults';
            mockReq.query = { id: 'ch-id-123' };
            mockContainer.configManager.enableAccessLogsClickHouse = true;
            await handleAdminGet(fnGetContainer, mockReq, mockRes);
            expect(mockContainer.adminAccessLogClickHouseManager.getLogAsync).toHaveBeenCalledWith('ch-id-123');
        });

        test('handles showPersonToPersonLink with bwellPersonId', async () => {
            mockReq.params.op = 'showPersonToPersonLink';
            mockReq.query = { bwellPersonId: 'bwell-123' };
            await handleAdminGet(fnGetContainer, mockReq, mockRes);
            expect(mockContainer.adminPersonPatientLinkManager.showPersonToPersonLinkAsync).toHaveBeenCalledWith({
                bwellPersonId: 'bwell-123'
            });
        });

        test('handles showPersonToPersonLink without bwellPersonId', async () => {
            mockReq.params.op = 'showPersonToPersonLink';
            mockReq.query = {};
            await handleAdminGet(fnGetContainer, mockReq, mockRes);
            expect(mockRes.json).toHaveBeenCalledWith(
                expect.objectContaining({ message: expect.stringContaining('No bwellPersonId') })
            );
        });

        test('handles indexes operation', async () => {
            mockReq.params.op = 'indexes';
            mockReq.query = {};
            await handleAdminGet(fnGetContainer, mockReq, mockRes);
            expect(mockContainer.indexManager.compareCurrentIndexesWithConfigurationInAllCollectionsAsync).toHaveBeenCalledWith({
                audit: false,
                filterToProblems: false
            });
        });

        test('handles indexProblems operation', async () => {
            mockReq.params.op = 'indexProblems';
            mockReq.query = {};
            await handleAdminGet(fnGetContainer, mockReq, mockRes);
            expect(mockContainer.indexManager.compareCurrentIndexesWithConfigurationInAllCollectionsAsync).toHaveBeenCalledWith({
                audit: false,
                filterToProblems: true
            });
        });

        test('handles synchronizeIndexes', async () => {
            mockReq.params.op = 'synchronizeIndexes';
            mockReq.query = {};
            await handleAdminGet(fnGetContainer, mockReq, mockRes);
            expect(mockRes.json).toHaveBeenCalledWith({ message: 'Synchronization process triggered' });
            expect(mockContainer.indexManager.synchronizeIndexesWithConfigAsync).toHaveBeenCalled();
        });

        test('handles ExportStatus', async () => {
            mockReq.params.op = 'ExportStatus';
            mockReq.params.id = 'export-123';
            await handleAdminGet(fnGetContainer, mockReq, mockRes);
            expect(mockContainer.adminExportManager.getExportStatus).toHaveBeenCalled();
        });

        test('handles getCacheKeys with resourceType and resourceId', async () => {
            mockReq.params.op = 'getCacheKeys';
            mockReq.query = { resourceType: 'Patient', resourceId: 'p-123' };
            await handleAdminGet(fnGetContainer, mockReq, mockRes);
            expect(mockContainer.fhirCacheKeyManager.getAllKeysForResource).toHaveBeenCalledWith({
                resourceType: 'Patient',
                resourceId: 'p-123'
            });
        });

        test('handles getCacheKeys without params', async () => {
            mockReq.params.op = 'getCacheKeys';
            mockReq.query = {};
            await handleAdminGet(fnGetContainer, mockReq, mockRes);
            expect(mockRes.json).toHaveBeenCalledWith(
                expect.objectContaining({ message: expect.stringContaining('No resourceId') })
            );
        });

        test('handles getCacheKeys error returns OperationOutcome', async () => {
            mockReq.params.op = 'getCacheKeys';
            mockReq.query = { resourceType: 'Patient', resourceId: 'p-err' };
            mockContainer.fhirCacheKeyManager.getAllKeysForResource.mockRejectedValue(
                Object.assign(new Error('Cache fail'), { statusCode: 404 })
            );
            await handleAdminGet(fnGetContainer, mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(404);
        });

        test('handles runPersonOneToNMatch without id returns 400', async () => {
            mockReq.params.op = 'runPersonOneToNMatch';
            mockReq.query = { resourceType: 'Patient' };
            await handleAdminGet(fnGetContainer, mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(400);
        });

        test('handles default/unknown operation', async () => {
            mockReq.params.op = 'unknownOperation';
            await handleAdminGet(fnGetContainer, mockReq, mockRes);
            expect(mockRes.json).toHaveBeenCalledWith({ message: 'Invalid Path' });
        });

        test('assigns request id from header when req.id is null', async () => {
            mockReq.id = null;
            mockReq.header = jest.fn().mockReturnValue('header-req-id');
            mockReq.params.op = 'indexes';
            await handleAdminGet(fnGetContainer, mockReq, mockRes);
            expect(mockReq.id).toBe('header-req-id');
        });

        test('generates UUID when no id or header present', async () => {
            mockReq.id = null;
            mockReq.header = jest.fn().mockReturnValue(null);
            mockReq.params.op = 'indexes';
            await handleAdminGet(fnGetContainer, mockReq, mockRes);
            expect(mockReq.id).toBe('mock-uuid-1234');
        });

        test('handles error in operation gracefully with 500', async () => {
            mockReq.params.op = 'indexes';
            mockContainer.indexManager.compareCurrentIndexesWithConfigurationInAllCollectionsAsync.mockRejectedValue(
                new Error('DB error')
            );
            await handleAdminGet(fnGetContainer, mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(500);
            expect(mockRes.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    issue: expect.arrayContaining([
                        expect.objectContaining({ diagnostics: 'Internal Server Error' })
                    ])
                })
            );
        });
    });

    describe('handleAdminPost', () => {
        test('returns 403 when no admin scopes', async () => {
            mockContainer.scopesManager.getAdminScopes.mockReturnValue([]);
            mockReq.params.op = 'createPersonToPersonLink';
            await handleAdminPost(fnGetContainer, mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(403);
        });

        test('handles createPersonToPersonLink with valid body', async () => {
            mockReq.params.op = 'createPersonToPersonLink';
            mockReq.body = { bwellPersonId: 'bwell-1', externalPersonId: 'ext-1' };
            await handleAdminPost(fnGetContainer, mockReq, mockRes);
            expect(mockContainer.adminPersonPatientLinkManager.createPersonToPersonLinkAsync).toHaveBeenCalledWith({
                req: mockReq,
                bwellPersonId: 'bwell-1',
                externalPersonId: 'ext-1'
            });
        });

        test('handles createPersonToPersonLink missing params', async () => {
            mockReq.params.op = 'createPersonToPersonLink';
            mockReq.body = { bwellPersonId: 'bwell-1' };
            await handleAdminPost(fnGetContainer, mockReq, mockRes);
            expect(mockRes.json).toHaveBeenCalledWith(
                expect.objectContaining({ message: expect.stringContaining('No bwellPersonId') })
            );
        });

        test('handles removePersonToPersonLink with valid body', async () => {
            mockReq.params.op = 'removePersonToPersonLink';
            mockReq.body = { bwellPersonId: 'bwell-1', externalPersonId: 'ext-1' };
            await handleAdminPost(fnGetContainer, mockReq, mockRes);
            expect(mockContainer.adminPersonPatientLinkManager.removePersonToPersonLinkAsync).toHaveBeenCalled();
        });

        test('handles createPersonToPatientLink with valid body', async () => {
            mockReq.params.op = 'createPersonToPatientLink';
            mockReq.body = { externalPersonId: 'ext-1', patientId: 'pat-1' };
            await handleAdminPost(fnGetContainer, mockReq, mockRes);
            expect(mockContainer.adminPersonPatientLinkManager.createPersonToPatientLinkAsync).toHaveBeenCalledWith({
                req: mockReq,
                externalPersonId: 'ext-1',
                patientId: 'pat-1'
            });
        });

        test('handles createPersonToPatientLink without patientId', async () => {
            mockReq.params.op = 'createPersonToPatientLink';
            mockReq.body = { externalPersonId: 'ext-1' };
            await handleAdminPost(fnGetContainer, mockReq, mockRes);
            expect(mockRes.json).toHaveBeenCalledWith(
                expect.objectContaining({ message: expect.stringContaining('No patientId') })
            );
        });

        test('handles removePersonToPatientLink with valid body', async () => {
            mockReq.params.op = 'removePersonToPatientLink';
            mockReq.body = { personId: 'per-1', patientId: 'pat-1' };
            await handleAdminPost(fnGetContainer, mockReq, mockRes);
            expect(mockContainer.adminPersonPatientLinkManager.removePersonToPatientLinkAsync).toHaveBeenCalledWith({
                req: mockReq,
                personId: 'per-1',
                patientId: 'pat-1'
            });
        });

        test('handles updatePatientReference with valid body', async () => {
            mockReq.params.op = 'updatePatientReference';
            mockReq.body = { patientId: 'pat-1', resourceType: 'Observation', resourceId: 'obs-1' };
            await handleAdminPost(fnGetContainer, mockReq, mockRes);
            expect(mockContainer.adminPersonPatientLinkManager.updatePatientLinkAsync).toHaveBeenCalledWith({
                req: mockReq,
                resourceType: 'Observation',
                resourceId: 'obs-1',
                patientId: 'pat-1'
            });
        });

        test('handles updatePatientReference missing params', async () => {
            mockReq.params.op = 'updatePatientReference';
            mockReq.body = { patientId: 'pat-1' };
            await handleAdminPost(fnGetContainer, mockReq, mockRes);
            expect(mockRes.json).toHaveBeenCalledWith(
                expect.objectContaining({ message: expect.stringContaining('No resourceId') })
            );
        });

        test('handles triggerExport with id', async () => {
            mockReq.params.op = 'triggerExport';
            mockReq.params.id = 'export-1';
            await handleAdminPost(fnGetContainer, mockReq, mockRes);
            expect(mockContainer.adminExportManager.triggerExportJob).toHaveBeenCalled();
        });

        test('handles triggerExport without id returns 400', async () => {
            mockReq.params.op = 'triggerExport';
            mockReq.params.id = undefined;
            await handleAdminPost(fnGetContainer, mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(400);
        });

        test('handles invalidateCache with resourceType and resourceId', async () => {
            mockReq.params.op = 'invalidateCache';
            mockReq.body = { resourceType: 'Patient', resourceId: 'p-1' };
            await handleAdminPost(fnGetContainer, mockReq, mockRes);
            expect(mockContainer.fhirCacheKeyManager.invalidateCacheKeysForResource).toHaveBeenCalledWith({
                resourceType: 'Patient',
                resourceId: 'p-1'
            });
            expect(mockRes.json).toHaveBeenCalledWith(
                expect.objectContaining({ message: expect.stringContaining('Cache invalidated') })
            );
        });

        test('handles invalidateCache with cacheKeys array', async () => {
            mockReq.params.op = 'invalidateCache';
            mockReq.body = { cacheKeys: ['key1', 'key2'] };
            await handleAdminPost(fnGetContainer, mockReq, mockRes);
            expect(mockContainer.fhirCacheKeyManager.invalidateCacheKeys).toHaveBeenCalledWith({
                cacheKeys: ['key1', 'key2']
            });
        });

        test('handles invalidateCache with no params returns 400', async () => {
            mockReq.params.op = 'invalidateCache';
            mockReq.body = {};
            await handleAdminPost(fnGetContainer, mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(400);
        });

        test('handles invalidateCache error returns OperationOutcome', async () => {
            mockReq.params.op = 'invalidateCache';
            mockReq.body = { resourceType: 'Patient', resourceId: 'p-err' };
            mockContainer.fhirCacheKeyManager.invalidateCacheKeysForResource.mockRejectedValue(
                new Error('Redis down')
            );
            await handleAdminPost(fnGetContainer, mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(500);
        });

        test('handles runMatchWithPayload', async () => {
            mockReq.params.op = 'runMatchWithPayload';
            mockReq.body = { resourceType: 'Patient', resource: {} };
            await handleAdminPost(fnGetContainer, mockReq, mockRes);
            expect(mockContainer.personMatchManager.runMatchWithPayloadAsync).toHaveBeenCalledWith({
                parameters: mockReq.body
            });
        });

        test('handles default/unknown operation in POST', async () => {
            mockReq.params.op = 'unknownPostOp';
            await handleAdminPost(fnGetContainer, mockReq, mockRes);
            expect(mockRes.json).toHaveBeenCalledWith({ message: 'Invalid Path' });
        });

        test('handles error in post operation with 500', async () => {
            mockReq.params.op = 'createPersonToPersonLink';
            mockReq.body = { bwellPersonId: 'b1', externalPersonId: 'e1' };
            mockContainer.adminPersonPatientLinkManager.createPersonToPersonLinkAsync.mockRejectedValue(
                new Error('DB error')
            );
            await handleAdminPost(fnGetContainer, mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(500);
        });
    });

    describe('handleAdminPut', () => {
        test('returns 403 when no admin scopes', async () => {
            mockContainer.scopesManager.getAdminScopes.mockReturnValue([]);
            mockReq.params.op = 'ExportStatus';
            await handleAdminPut(fnGetContainer, mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(403);
        });

        test('handles ExportStatus with id', async () => {
            mockReq.params.op = 'ExportStatus';
            mockReq.params.id = 'export-1';
            await handleAdminPut(fnGetContainer, mockReq, mockRes);
            expect(mockContainer.adminExportManager.updateExportStatus).toHaveBeenCalled();
        });

        test('handles ExportStatus without id returns 400', async () => {
            mockReq.params.op = 'ExportStatus';
            mockReq.params.id = undefined;
            await handleAdminPut(fnGetContainer, mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(400);
        });

        test('handles default operation in PUT', async () => {
            mockReq.params.op = 'unknownPutOp';
            await handleAdminPut(fnGetContainer, mockReq, mockRes);
            expect(mockRes.json).toHaveBeenCalledWith({ message: 'Invalid Path' });
        });
    });

    describe('handleAdminDelete', () => {
        test('returns 403 when no admin scopes', async () => {
            mockContainer.scopesManager.getAdminScopes.mockReturnValue([]);
            mockReq.params.op = 'deletePerson';
            await handleAdminDelete(fnGetContainer, mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(403);
        });

        test('handles deletePerson with personId', async () => {
            mockReq.params.op = 'deletePerson';
            mockReq.query = { personId: 'per-1' };
            await handleAdminDelete(fnGetContainer, mockReq, mockRes);
            expect(mockContainer.adminPersonPatientLinkManager.deletePersonAsync).toHaveBeenCalledWith({
                req: mockReq,
                requestId: mockReq.id,
                personId: 'per-1'
            });
        });

        test('handles deletePerson without personId', async () => {
            mockReq.params.op = 'deletePerson';
            mockReq.query = {};
            await handleAdminDelete(fnGetContainer, mockReq, mockRes);
            expect(mockRes.json).toHaveBeenCalledWith(
                expect.objectContaining({ message: expect.stringContaining('No personId') })
            );
        });

        test('handles deletePatientDataGraph with sync=true', async () => {
            mockReq.params.op = 'deletePatientDataGraph';
            mockReq.query = { id: 'pat-1', sync: 'true' };
            await handleAdminDelete(fnGetContainer, mockReq, mockRes);
            expect(mockContainer.adminPersonPatientDataManager.deletePatientDataGraphAsync).toHaveBeenCalled();
        });

        test('handles deletePatientDataGraph without id', async () => {
            mockReq.params.op = 'deletePatientDataGraph';
            mockReq.query = {};
            await handleAdminDelete(fnGetContainer, mockReq, mockRes);
            expect(mockRes.json).toHaveBeenCalledWith(
                expect.objectContaining({ message: expect.stringContaining('No id') })
            );
        });

        test('handles default operation in DELETE', async () => {
            mockReq.params.op = 'unknownDeleteOp';
            await handleAdminDelete(fnGetContainer, mockReq, mockRes);
            expect(mockRes.json).toHaveBeenCalledWith({ message: 'Invalid Path' });
        });

        test('handles error in delete operation with 500', async () => {
            mockReq.params.op = 'deletePerson';
            mockReq.query = { personId: 'per-1' };
            mockContainer.adminPersonPatientLinkManager.deletePersonAsync.mockRejectedValue(
                new Error('Unexpected error')
            );
            await handleAdminDelete(fnGetContainer, mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(500);
        });
    });
});
