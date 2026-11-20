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

const { handleAdminGet, handleAdminPost, handleAdminDelete, handleAdminPut } = require('../../../routeHandlers/admin');
const { BadRequestError, NotAllowedError, NotFoundError } = require('../../../utils/httpErrors');
const { logInfo, logError } = require('../../../operations/common/logging');

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
                getAdminScopes: jest.fn().mockReturnValue(['admin/*.read', 'admin/*.write']),
                parseScopes: jest.fn().mockReturnValue(['admin/*.read', 'admin/*.write', 'user/Patient.write']),
                hasAdminScopeForAction: jest.fn().mockReturnValue(true)
            },
            // Backs assertResourceWriteScopeAsync, which routes deletePatientDataGraph and
            // deletePersonDataGraph through the real scope-validation gate instead of a raw
            // scopeChecker call over the unfiltered scope string.
            scopesValidator: {
                hasValidScopesAsync: jest.fn().mockResolvedValue(true)
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
                enableAccessLogsClickHouse: false,
                enableAccessAuditEvent: true
            },
            auditLogger: {
                logErrorAuditEntryAsync: jest.fn().mockResolvedValue(undefined)
            },
            writePipelineSwitch: {
                useNewPathFor: jest.fn().mockReturnValue(false)
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
        test('returns 403 when no admin scope of any kind', async () => {
            mockContainer.scopesManager.getAdminScopes.mockReturnValue([]);
            mockReq.params.op = 'indexes';
            await handleAdminGet(fnGetContainer, mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(403);
            expect(mockRes.json).toHaveBeenCalledWith(
                { message: 'user does not have access to this admin route' }
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
        test('returns 403 when no admin scope of any kind', async () => {
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
            expect(mockRes.status).toHaveBeenCalledWith(400);
            expect(mockRes.json.mock.calls[0][0].issue[0].diagnostics).toContain('No bwellPersonId');
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
            expect(mockRes.status).toHaveBeenCalledWith(400);
            expect(mockRes.json.mock.calls[0][0].issue[0].diagnostics).toContain('No patientId');
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
            expect(mockRes.status).toHaveBeenCalledWith(400);
            expect(mockRes.json.mock.calls[0][0].issue[0].diagnostics).toContain('No resourceId');
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

    describe('handleAdminPost write operations and the admin write pipeline switch', () => {
        const writeOperations = [
            {
                operation: 'createPersonToPersonLink',
                managerMethod: 'createPersonToPersonLinkAsync',
                incompleteBody: { bwellPersonId: 'person-1' },
                missingMessage: 'No bwellPersonId: person-1 or externalPersonId: undefined passed',
                newMissingMessage: 'Missing required parameter(s): externalPersonId',
                auditResourceType: 'Person'
            },
            {
                operation: 'removePersonToPersonLink',
                managerMethod: 'removePersonToPersonLinkAsync',
                incompleteBody: { externalPersonId: 'external-1' },
                missingMessage: 'No bwellPersonId: undefined or externalPersonId: external-1 passed',
                newMissingMessage: 'Missing required parameter(s): bwellPersonId',
                auditResourceType: 'Person'
            },
            {
                operation: 'createPersonToPatientLink',
                managerMethod: 'createPersonToPatientLinkAsync',
                incompleteBody: { externalPersonId: 'external-1' },
                missingMessage: 'No patientId: undefined passed',
                newMissingMessage: 'Missing required parameter(s): patientId',
                auditResourceType: 'Person'
            },
            {
                operation: 'removePersonToPatientLink',
                managerMethod: 'removePersonToPatientLinkAsync',
                incompleteBody: { personId: 'person-1' },
                missingMessage: 'No personId: person-1 or patientId: undefined passed',
                newMissingMessage: 'Missing required parameter(s): patientId',
                auditResourceType: 'Person'
            },
            {
                operation: 'updatePatientReference',
                managerMethod: 'updatePatientLinkAsync',
                incompleteBody: { patientId: 'patient-1' },
                missingMessage:
                    'No resourceId: undefined or resourceType: undefined or patientId: patient-1 passed',
                newMissingMessage: 'Missing required parameter(s): resourceId, resourceType',
                auditResourceType: 'Observation'
            }
        ];

        const errorCases = [
            {
                name: 'not found',
                error: () => new NotFoundError('Linked resource was not found'),
                statusCode: 404,
                code: 'not-found',
                newText: 'Linked resource was not found',
                oldDiagnostics: 'Linked resource was not found'
            },
            {
                name: 'not allowed (409 with issue code forbidden)',
                error: () => new NotAllowedError('Link target is not allowed'),
                statusCode: 409,
                code: 'forbidden',
                newText: 'Link target is not allowed',
                oldDiagnostics: 'Link target is not allowed'
            },
            {
                name: 'bad request',
                error: () => new BadRequestError(new Error('Resource type is not supported')),
                statusCode: 400,
                code: 'invalid',
                newText: 'Resource type is not supported',
                oldDiagnostics: 'Resource type is not supported'
            },
            {
                name: 'internal',
                error: () => new Error('connection string in message'),
                statusCode: 500,
                code: 'internal',
                newText: 'Internal Server Error',
                oldDiagnostics: 'Internal Server Error'
            }
        ];

        const operationsWithErrorCases = writeOperations.flatMap((writeOperation) =>
            errorCases.map((errorCase) => ({ ...writeOperation, ...errorCase }))
        );

        /**
         * Turns the admin write pipeline switch on or off for the handler under test
         * @param {boolean} on
         */
        function setSwitch (on) {
            mockContainer.writePipelineSwitch.useNewPathFor.mockImplementation(
                (operation) => on && operation === 'admin'
            );
        }

        describe.each(writeOperations)('$operation', ({
            operation, managerMethod, incompleteBody, missingMessage, newMissingMessage
        }) => {
            beforeEach(() => {
                mockReq.params.op = operation;
            });

            test('with the switch on, a missing parameter answers 400 invalid naming only the missing parameters', async () => {
                setSwitch(true);
                mockReq.body = incompleteBody;
                await handleAdminPost(fnGetContainer, mockReq, mockRes);
                expect(mockRes.status).toHaveBeenCalledWith(400);
                const outcome = mockRes.json.mock.calls[0][0];
                expect(outcome.resourceType).toBe('OperationOutcome');
                expect(outcome.issue[0].code).toBe('invalid');
                expect(outcome.issue[0].details.text).toBe(newMissingMessage);
                for (const value of Object.values(incompleteBody)) {
                    expect(JSON.stringify(outcome)).not.toContain(value);
                }
                expect(mockContainer.adminPersonPatientLinkManager[managerMethod]).not.toHaveBeenCalled();
            });

            test('with the switch off, a missing parameter answers 400 in the exception format with the message as diagnostics', async () => {
                setSwitch(false);
                mockReq.body = incompleteBody;
                await handleAdminPost(fnGetContainer, mockReq, mockRes);
                expect(mockRes.status).toHaveBeenCalledWith(400);
                const outcome = mockRes.json.mock.calls[0][0];
                expect(outcome.resourceType).toBe('OperationOutcome');
                expect(outcome.issue[0].code).toBe('exception');
                expect(outcome.issue[0].diagnostics).toBe(missingMessage);
                expect(mockContainer.adminPersonPatientLinkManager[managerMethod]).not.toHaveBeenCalled();
            });

            test.each([
                { switchOn: true, expectedCode: 'forbidden' },
                { switchOn: false, expectedCode: 'exception' }
            ])(
                'the admin scope check fails before the parameter check (switch on: $switchOn)',
                async ({ switchOn, expectedCode }) => {
                    setSwitch(switchOn);
                    mockContainer.scopesManager.hasAdminScopeForAction.mockReturnValue(false);
                    mockReq.body = {};
                    await handleAdminPost(fnGetContainer, mockReq, mockRes);
                    expect(mockRes.status).toHaveBeenCalledWith(403);
                    const outcome = mockRes.json.mock.calls[0][0];
                    expect(outcome.issue[0].code).toBe(expectedCode);
                    expect(mockContainer.adminPersonPatientLinkManager[managerMethod]).not.toHaveBeenCalled();
                }
            );

            test.each([
                {
                    switchOn: true,
                    expectedBody: {
                        resourceType: 'OperationOutcome',
                        issue: [
                            expect.objectContaining({
                                severity: 'error',
                                code: 'forbidden',
                                details: { text: 'user does not have access to this admin route' }
                            })
                        ]
                    }
                },
                {
                    switchOn: false,
                    expectedBody: { message: 'user does not have access to this admin route' }
                }
            ])(
                'a caller with no admin scope at all gets 403 (switch on: $switchOn)',
                async ({ switchOn, expectedBody }) => {
                    setSwitch(switchOn);
                    mockContainer.scopesManager.getAdminScopes.mockReturnValue([]);
                    mockReq.body = {};
                    await handleAdminPost(fnGetContainer, mockReq, mockRes);
                    expect(mockRes.status).toHaveBeenCalledWith(403);
                    expect(mockRes.json).toHaveBeenCalledTimes(1);
                    expect(mockRes.json.mock.calls[0][0]).toEqual(expectedBody);
                    expect(mockContainer.adminPersonPatientLinkManager[managerMethod]).not.toHaveBeenCalled();
                }
            );
        });

        describe('error audit events and error logs', () => {
            const fullBody = {
                bwellPersonId: 'person-1',
                externalPersonId: 'external-1',
                personId: 'person-1',
                patientId: 'patient-1',
                resourceType: 'Observation',
                resourceId: 'observation-1'
            };

            beforeEach(() => {
                logInfo.mockClear();
                logError.mockClear();
                mockReq.body = { ...fullBody };
            });

            /**
             * Returns the arguments of every error audit entry the handler asked for.
             */
            const auditCalls = () =>
                mockContainer.auditLogger.logErrorAuditEntryAsync.mock.calls.map(([args]) => args);

            const failingCases = writeOperations.flatMap((writeOperation) => [
                {
                    ...writeOperation,
                    error: () => new NotFoundError('Resource not found: Person/person-1'),
                    status: 404,
                    sanitized: 'Not Found'
                },
                {
                    ...writeOperation,
                    error: () => new Error('connection string in message'),
                    status: 500,
                    sanitized: 'Internal Server Error'
                }
            ]);

            test.each(failingCases)(
                'with the switch on, a $status from $operation logs one error audit event with the status and the sanitized message',
                async ({ operation, managerMethod, error, status, sanitized, auditResourceType }) => {
                    setSwitch(true);
                    mockReq.params.op = operation;
                    mockContainer.adminPersonPatientLinkManager[managerMethod].mockRejectedValue(error());

                    await handleAdminPost(fnGetContainer, mockReq, mockRes);

                    expect(mockRes.status).toHaveBeenCalledWith(status);
                    expect(auditCalls()).toEqual([{
                        requestInfo: { requestId: 'mock-req-id' },
                        resourceType: auditResourceType,
                        errorCode: status,
                        errorMessage: sanitized,
                        extraParams: undefined
                    }]);
                }
            );

            test.each(writeOperations)(
                'with the switch on, a missing parameter of $operation logs a 400 error audit event',
                async ({ operation, incompleteBody }) => {
                    setSwitch(true);
                    mockReq.params.op = operation;
                    mockReq.body = incompleteBody;

                    await handleAdminPost(fnGetContainer, mockReq, mockRes);

                    expect(auditCalls().map(({ errorCode, errorMessage }) => [errorCode, errorMessage]))
                        .toEqual([[400, 'Bad Request']]);
                }
            );

            test.each([
                {
                    name: 'an admin scope without write',
                    arrange: () => mockContainer.scopesManager.hasAdminScopeForAction.mockReturnValue(false)
                },
                {
                    name: 'no admin scope at all',
                    arrange: () => mockContainer.scopesManager.getAdminScopes.mockReturnValue([])
                }
            ])(
                'with the switch on, a 403 for $name logs an error audit event carrying the caller scope',
                async ({ arrange }) => {
                    setSwitch(true);
                    mockReq.params.op = 'createPersonToPersonLink';
                    mockReq.authInfo = { scope: 'user/*.read admin/*.read' };
                    arrange();

                    await handleAdminPost(fnGetContainer, mockReq, mockRes);

                    expect(mockRes.status).toHaveBeenCalledWith(403);
                    expect(auditCalls()).toEqual([{
                        requestInfo: { requestId: 'mock-req-id' },
                        resourceType: 'Person',
                        errorCode: 403,
                        errorMessage: 'user does not have access to this admin route',
                        extraParams: [{ type: 'scope', valueString: 'user/*.read admin/*.read' }]
                    }]);
                }
            );

            test.each([
                {
                    name: 'resourceType is not a string',
                    resourceType: ['Observation']
                },
                {
                    name: 'resourceType is missing',
                    resourceType: undefined
                }
            ])(
                'with the switch on, an updatePatientReference error audit event has no resource type when $name',
                async ({ resourceType }) => {
                    setSwitch(true);
                    mockReq.params.op = 'updatePatientReference';
                    mockReq.body = { ...fullBody, resourceType };
                    mockContainer.adminPersonPatientLinkManager.updatePatientLinkAsync.mockRejectedValue(
                        new NotFoundError('Resource not found')
                    );

                    await handleAdminPost(fnGetContainer, mockReq, mockRes);

                    expect(auditCalls().map((args) => args.resourceType)).toEqual([null]);
                }
            );

            test.each([
                {
                    name: 'the switch is off',
                    arrange: () => {
                        setSwitch(false);
                        mockReq.params.op = 'createPersonToPersonLink';
                        mockContainer.adminPersonPatientLinkManager.createPersonToPersonLinkAsync
                            .mockRejectedValue(new NotFoundError('Resource not found'));
                    }
                },
                {
                    name: 'access audit events are off',
                    arrange: () => {
                        setSwitch(true);
                        mockContainer.configManager.enableAccessAuditEvent = false;
                        mockReq.params.op = 'createPersonToPersonLink';
                        mockContainer.adminPersonPatientLinkManager.createPersonToPersonLinkAsync
                            .mockRejectedValue(new NotFoundError('Resource not found'));
                    }
                },
                {
                    name: 'the operation is runMatchWithPayload',
                    arrange: () => {
                        setSwitch(true);
                        mockReq.params.op = 'runMatchWithPayload';
                        mockContainer.personMatchManager.runMatchWithPayloadAsync.mockRejectedValue(
                            new NotFoundError('Match target was not found')
                        );
                    }
                },
                {
                    name: 'the operation is triggerExport',
                    arrange: () => {
                        setSwitch(true);
                        mockReq.params.op = 'triggerExport';
                        mockReq.params.id = 'export-1';
                        mockContainer.adminExportManager.triggerExportJob.mockRejectedValue(
                            new NotFoundError('Match target was not found')
                        );
                    }
                },
                {
                    name: 'the write succeeds',
                    arrange: () => {
                        setSwitch(true);
                        mockReq.params.op = 'createPersonToPersonLink';
                    }
                }
            ])('no error audit event is logged when $name', async ({ arrange }) => {
                arrange();

                await handleAdminPost(fnGetContainer, mockReq, mockRes);

                expect(mockContainer.auditLogger.logErrorAuditEntryAsync).not.toHaveBeenCalled();
            });

            test.each([
                {
                    name: 'throws',
                    fail: () => {
                        throw new Error('audit logger unavailable');
                    }
                },
                {
                    name: 'rejects',
                    fail: () => Promise.reject(new Error('audit logger unavailable'))
                }
            ])('an audit logger that $name does not change the response', async ({ fail }) => {
                setSwitch(true);
                mockReq.params.op = 'createPersonToPersonLink';
                mockContainer.adminPersonPatientLinkManager.createPersonToPersonLinkAsync.mockRejectedValue(
                    new NotFoundError('Resource not found: Person/person-1')
                );
                mockContainer.auditLogger.logErrorAuditEntryAsync.mockImplementation(fail);

                await handleAdminPost(fnGetContainer, mockReq, mockRes);
                await new Promise((resolve) => setImmediate(resolve));

                expect(mockRes.status).toHaveBeenCalledWith(404);
                expect(mockRes.json).toHaveBeenCalledTimes(1);
                expect(mockRes.json.mock.calls[0][0].issue[0]).toMatchObject({
                    code: 'not-found',
                    details: { text: 'Resource not found: Person/person-1' }
                });
                expect(logError).toHaveBeenCalledWith(
                    expect.stringMatching(/admin error audit event/),
                    { error: 'audit logger unavailable' }
                );
            });

            test.each([
                {
                    name: 'a 404 with the switch on is logged at info without the stack',
                    switchOn: true,
                    error: () => new NotFoundError('Resource not found: Person/person-1'),
                    expected: { info: true, error: false }
                },
                {
                    name: 'a 400 with the switch on is logged at info without the stack',
                    switchOn: true,
                    error: () => new BadRequestError(new Error('Invalid patientId: must be a _uuid')),
                    expected: { info: true, error: false }
                },
                {
                    name: 'a 500 with the switch on is logged as an error with the stack',
                    switchOn: true,
                    error: () => new Error('connection string in message'),
                    expected: { info: false, error: true }
                },
                {
                    name: 'a 404 with the switch off is logged at info without the stack',
                    switchOn: false,
                    error: () => new NotFoundError('Resource not found: Person/person-1'),
                    expected: { info: true, error: false }
                },
                {
                    name: 'a missing-parameter 400 with the switch off is logged at info without the stack',
                    switchOn: false,
                    body: { bwellPersonId: 'person-1' },
                    error: () => new Error('the manager is not called for a missing parameter'),
                    expected: { info: true, error: false }
                },
                {
                    name: 'a 500 with the switch off is logged as an error with the stack',
                    switchOn: false,
                    error: () => new Error('connection string in message'),
                    expected: { info: false, error: true }
                }
            ])('$name', async ({ switchOn, body, error, expected }) => {
                setSwitch(switchOn);
                mockReq.params.op = 'createPersonToPersonLink';
                if (body) {
                    mockReq.body = body;
                }
                mockContainer.adminPersonPatientLinkManager.createPersonToPersonLinkAsync.mockRejectedValue(error());

                await handleAdminPost(fnGetContainer, mockReq, mockRes);

                const infoLogs = logInfo.mock.calls.filter(([message]) => message === 'Error in handleAdminPost');
                const errorLogs = logError.mock.calls.filter(([message]) => message === 'Error in handleAdminPost');
                expect({ info: infoLogs.length === 1, error: errorLogs.length === 1 }).toEqual(expected);
                for (const [, fields] of infoLogs) {
                    expect(fields).not.toHaveProperty('stack');
                }
                for (const [, fields] of errorLogs) {
                    expect(fields.stack).toEqual(expect.any(String));
                }
            });
        });

        test.each(['runMatchWithPayload', 'triggerExport', 'invalidateCache'])(
            'with the switch on, a caller with no admin scope at all gets the old 403 message for %s',
            async (operation) => {
                setSwitch(true);
                mockReq.params.op = operation;
                mockContainer.scopesManager.getAdminScopes.mockReturnValue([]);
                await handleAdminPost(fnGetContainer, mockReq, mockRes);
                expect(mockRes.status).toHaveBeenCalledWith(403);
                expect(mockRes.json).toHaveBeenCalledWith({
                    message: 'user does not have access to this admin route'
                });
            }
        );

        test.each(operationsWithErrorCases)(
            'with the switch on, $operation answers the standard OperationOutcome for a $name error',
            async ({ operation, managerMethod, error, statusCode, code, newText }) => {
                setSwitch(true);
                mockReq.params.op = operation;
                mockReq.body = {
                    bwellPersonId: 'person-1',
                    externalPersonId: 'external-1',
                    personId: 'person-1',
                    patientId: 'patient-1',
                    resourceType: 'Observation',
                    resourceId: 'observation-1'
                };
                mockContainer.adminPersonPatientLinkManager[managerMethod].mockRejectedValue(error());
                await handleAdminPost(fnGetContainer, mockReq, mockRes);
                expect(mockRes.status).toHaveBeenCalledWith(statusCode);
                const outcome = mockRes.json.mock.calls[0][0];
                expect(outcome.resourceType).toBe('OperationOutcome');
                expect(outcome.issue[0].code).toBe(code);
                expect(outcome.issue[0].details.text).toBe(newText);
                expect(JSON.stringify(outcome)).not.toContain('connection string');
            }
        );

        test.each(operationsWithErrorCases)(
            'with the switch off, $operation keeps the exception shape for a $name error',
            async ({ operation, managerMethod, error, statusCode, oldDiagnostics }) => {
                setSwitch(false);
                mockReq.params.op = operation;
                mockReq.body = {
                    bwellPersonId: 'person-1',
                    externalPersonId: 'external-1',
                    personId: 'person-1',
                    patientId: 'patient-1',
                    resourceType: 'Observation',
                    resourceId: 'observation-1'
                };
                mockContainer.adminPersonPatientLinkManager[managerMethod].mockRejectedValue(error());
                await handleAdminPost(fnGetContainer, mockReq, mockRes);
                expect(mockRes.status).toHaveBeenCalledWith(statusCode);
                const outcome = mockRes.json.mock.calls[0][0];
                expect(outcome.issue[0].code).toBe('exception');
                expect(outcome.issue[0].diagnostics).toBe(oldDiagnostics);
            }
        );

        test.each([
            {
                operation: 'runMatchWithPayload',
                arrange: () => {
                    mockReq.body = { resourceType: 'Patient', resource: {} };
                    mockContainer.personMatchManager.runMatchWithPayloadAsync.mockRejectedValue(
                        new NotFoundError('Match target was not found')
                    );
                }
            },
            {
                operation: 'triggerExport',
                arrange: () => {
                    mockReq.params.id = 'export-1';
                    mockContainer.adminExportManager.triggerExportJob.mockRejectedValue(
                        new NotFoundError('Match target was not found')
                    );
                }
            }
        ])(
            'with the switch on, the error format of $operation is unchanged',
            async ({ operation, arrange }) => {
                setSwitch(true);
                mockReq.params.op = operation;
                arrange();
                await handleAdminPost(fnGetContainer, mockReq, mockRes);
                expect(mockRes.status).toHaveBeenCalledWith(404);
                const outcome = mockRes.json.mock.calls[0][0];
                expect(outcome.issue[0].code).toBe('exception');
                expect(outcome.issue[0].diagnostics).toBe('Match target was not found');
            }
        );
    });

    describe('handleAdminPut', () => {
        test('returns 403 when no admin write scope', async () => {
            mockContainer.scopesManager.hasAdminScopeForAction.mockReturnValue(false);
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
        test('returns 403 when no admin write scope', async () => {
            mockContainer.scopesManager.hasAdminScopeForAction.mockReturnValue(false);
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
            expect(mockContainer.scopesValidator.hasValidScopesAsync).toHaveBeenCalledWith(
                expect.objectContaining({ resourceType: 'Patient', accessRequested: 'd' })
            );
        });

        test('rejects deletePatientDataGraph when the resource-type scope check fails', async () => {
            mockContainer.scopesValidator.hasValidScopesAsync.mockResolvedValueOnce(false);
            mockReq.params.op = 'deletePatientDataGraph';
            mockReq.query = { id: 'pat-1', sync: 'true' };
            await handleAdminDelete(fnGetContainer, mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(403);
            expect(mockContainer.adminPersonPatientDataManager.deletePatientDataGraphAsync).not.toHaveBeenCalled();
        });

        test('rejects deletePersonDataGraph when the resource-type scope check fails', async () => {
            mockContainer.scopesValidator.hasValidScopesAsync.mockResolvedValueOnce(false);
            mockReq.params.op = 'deletePersonDataGraph';
            mockReq.query = { id: 'person-1' };
            await handleAdminDelete(fnGetContainer, mockReq, mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(403);
            expect(mockContainer.adminPersonPatientDataManager.deletePersonDataGraphAsync).not.toHaveBeenCalled();
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

    describe('admin/*.read vs admin/*.write scope enforcement', () => {
        function setAdminScopes ({ hasRead, hasWrite }) {
            const scopes = [];
            if (hasRead) scopes.push('admin/*.read');
            if (hasWrite) scopes.push('admin/*.write');
            mockContainer.scopesManager.getAdminScopes.mockReturnValue(scopes);
            const granted = new Set([...(hasRead ? ['r', 's'] : []), ...(hasWrite ? ['c', 'u', 'd'] : [])]);
            mockContainer.scopesManager.hasAdminScopeForAction.mockImplementation(({ accessRequested }) =>
                [...accessRequested].every(letter => granted.has(letter))
            );
        }

        describe('handleAdminGet (read operations + one write operation, synchronizeIndexes)', () => {
            test('read-only scope (admin/*.read) can perform a read operation', async () => {
                setAdminScopes({ hasRead: true, hasWrite: false });
                mockReq.params.op = 'indexes';
                await handleAdminGet(fnGetContainer, mockReq, mockRes);
                expect(mockContainer.indexManager.compareCurrentIndexesWithConfigurationInAllCollectionsAsync)
                    .toHaveBeenCalled();
                expect(mockRes.status).not.toHaveBeenCalledWith(403);
            });

            test('read-only scope (admin/*.read) is rejected from the write operation synchronizeIndexes', async () => {
                setAdminScopes({ hasRead: true, hasWrite: false });
                mockReq.params.op = 'synchronizeIndexes';
                await handleAdminGet(fnGetContainer, mockReq, mockRes);
                expect(mockRes.status).toHaveBeenCalledWith(403);
                expect(mockContainer.indexManager.synchronizeIndexesWithConfigAsync).not.toHaveBeenCalled();
            });

            test('write scope (admin/*.write) can perform the write operation synchronizeIndexes', async () => {
                setAdminScopes({ hasRead: false, hasWrite: true });
                mockReq.params.op = 'synchronizeIndexes';
                await handleAdminGet(fnGetContainer, mockReq, mockRes);
                expect(mockContainer.indexManager.synchronizeIndexesWithConfigAsync).toHaveBeenCalled();
                expect(mockRes.status).not.toHaveBeenCalledWith(403);
            });

            test('write-only scope (admin/*.write, no read) is rejected from a read operation (indexes)', async () => {
                setAdminScopes({ hasRead: false, hasWrite: true });
                mockReq.params.op = 'indexes';
                await handleAdminGet(fnGetContainer, mockReq, mockRes);
                expect(mockRes.status).toHaveBeenCalledWith(403);
                expect(mockContainer.indexManager.compareCurrentIndexesWithConfigurationInAllCollectionsAsync)
                    .not.toHaveBeenCalled();
            });

            test('write-only scope (admin/*.write, no read) is rejected from every other read operation', async () => {
                setAdminScopes({ hasRead: false, hasWrite: true });
                const readOperations = [
                    'searchLogResults', 'showPersonToPersonLink', 'indexProblems',
                    'runPersonMatch', 'ExportStatus', 'getCacheKeys', 'runPersonOneToNMatch'
                ];
                for (const op of readOperations) {
                    mockRes.status.mockClear();
                    mockReq.params.op = op;
                    mockReq.query = {};
                    await handleAdminGet(fnGetContainer, mockReq, mockRes);
                    expect(mockRes.status).toHaveBeenCalledWith(403);
                }
            });

            test('a caller with no admin scope at all is rejected outright', async () => {
                setAdminScopes({ hasRead: false, hasWrite: false });
                mockReq.params.op = 'indexes';
                await handleAdminGet(fnGetContainer, mockReq, mockRes);
                expect(mockRes.status).toHaveBeenCalledWith(403);
            });
        });

        describe('handleAdminPost (write operations + one read operation, runMatchWithPayload)', () => {
            test('read-only scope (admin/*.read) can perform the read operation runMatchWithPayload', async () => {
                setAdminScopes({ hasRead: true, hasWrite: false });
                mockReq.params.op = 'runMatchWithPayload';
                mockReq.body = { resourceType: 'Patient', resource: {} };
                await handleAdminPost(fnGetContainer, mockReq, mockRes);
                expect(mockContainer.personMatchManager.runMatchWithPayloadAsync).toHaveBeenCalled();
                expect(mockRes.status).not.toHaveBeenCalledWith(403);
            });

            test('read-only scope (admin/*.read) is rejected from a write operation (createPersonToPersonLink)', async () => {
                setAdminScopes({ hasRead: true, hasWrite: false });
                mockReq.params.op = 'createPersonToPersonLink';
                mockReq.body = { bwellPersonId: 'b1', externalPersonId: 'e1' };
                await handleAdminPost(fnGetContainer, mockReq, mockRes);
                expect(mockRes.status).toHaveBeenCalledWith(403);
                expect(mockContainer.adminPersonPatientLinkManager.createPersonToPersonLinkAsync).not.toHaveBeenCalled();
            });

            test('read-only scope (admin/*.read) is rejected from every other write operation', async () => {
                setAdminScopes({ hasRead: true, hasWrite: false });
                const writeOperations = [
                    'removePersonToPersonLink', 'createPersonToPatientLink', 'removePersonToPatientLink',
                    'updatePatientReference', 'invalidateCache'
                ];
                for (const op of writeOperations) {
                    mockRes.status.mockClear();
                    mockReq.params.op = op;
                    mockReq.body = {};
                    await handleAdminPost(fnGetContainer, mockReq, mockRes);
                    expect(mockRes.status).toHaveBeenCalledWith(403);
                }
            });

            test('write scope (admin/*.write) can perform a write operation (createPersonToPersonLink)', async () => {
                setAdminScopes({ hasRead: false, hasWrite: true });
                mockReq.params.op = 'createPersonToPersonLink';
                mockReq.body = { bwellPersonId: 'b1', externalPersonId: 'e1' };
                await handleAdminPost(fnGetContainer, mockReq, mockRes);
                expect(mockContainer.adminPersonPatientLinkManager.createPersonToPersonLinkAsync).toHaveBeenCalled();
                expect(mockRes.status).not.toHaveBeenCalledWith(403);
            });

            test('write-only scope (admin/*.write, no read) is rejected from the read operation runMatchWithPayload', async () => {
                setAdminScopes({ hasRead: false, hasWrite: true });
                mockReq.params.op = 'runMatchWithPayload';
                mockReq.body = { resourceType: 'Patient', resource: {} };
                await handleAdminPost(fnGetContainer, mockReq, mockRes);
                expect(mockRes.status).toHaveBeenCalledWith(403);
                expect(mockContainer.personMatchManager.runMatchWithPayloadAsync).not.toHaveBeenCalled();
            });

            test('a caller with no admin scope at all is rejected outright', async () => {
                setAdminScopes({ hasRead: false, hasWrite: false });
                mockReq.params.op = 'createPersonToPersonLink';
                await handleAdminPost(fnGetContainer, mockReq, mockRes);
                expect(mockRes.status).toHaveBeenCalledWith(403);
            });
        });

        describe('handleAdminPut (ExportStatus update - write only)', () => {
            test('read-only scope (admin/*.read) is rejected', async () => {
                setAdminScopes({ hasRead: true, hasWrite: false });
                mockReq.params.op = 'ExportStatus';
                mockReq.params.id = 'export-1';
                await handleAdminPut(fnGetContainer, mockReq, mockRes);
                expect(mockRes.status).toHaveBeenCalledWith(403);
                expect(mockContainer.adminExportManager.updateExportStatus).not.toHaveBeenCalled();
            });

            test('write scope (admin/*.write) is allowed', async () => {
                setAdminScopes({ hasRead: false, hasWrite: true });
                mockReq.params.op = 'ExportStatus';
                mockReq.params.id = 'export-1';
                await handleAdminPut(fnGetContainer, mockReq, mockRes);
                expect(mockContainer.adminExportManager.updateExportStatus).toHaveBeenCalled();
                expect(mockRes.status).not.toHaveBeenCalledWith(403);
            });
        });

        describe('handleAdminDelete (deletePerson - needs d and s)', () => {
            test('read-only scope (admin/*.read) is rejected', async () => {
                setAdminScopes({ hasRead: true, hasWrite: false });
                mockReq.params.op = 'deletePerson';
                mockReq.query = { personId: 'per-1' };
                await handleAdminDelete(fnGetContainer, mockReq, mockRes);
                expect(mockRes.status).toHaveBeenCalledWith(403);
                expect(mockContainer.adminPersonPatientLinkManager.deletePersonAsync).not.toHaveBeenCalled();
            });

            test('write scope alone (admin/*.write) is rejected because it lacks s', async () => {
                setAdminScopes({ hasRead: false, hasWrite: true });
                mockReq.params.op = 'deletePerson';
                mockReq.query = { personId: 'per-1' };
                await handleAdminDelete(fnGetContainer, mockReq, mockRes);
                expect(mockRes.status).toHaveBeenCalledWith(403);
                expect(mockContainer.adminPersonPatientLinkManager.deletePersonAsync).not.toHaveBeenCalled();
            });

            test('read and write scopes together are allowed', async () => {
                setAdminScopes({ hasRead: true, hasWrite: true });
                mockReq.params.op = 'deletePerson';
                mockReq.query = { personId: 'per-1' };
                await handleAdminDelete(fnGetContainer, mockReq, mockRes);
                expect(mockContainer.adminPersonPatientLinkManager.deletePersonAsync).toHaveBeenCalled();
                expect(mockRes.status).not.toHaveBeenCalledWith(403);
            });
        });
    });
});
