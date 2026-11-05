const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

jest.mock('express-http-context', () => {
    const { jest: j } = require('@jest/globals');
    return { get: j.fn(), set: j.fn() };
});

jest.mock('../../../../operations/common/logging', () => {
    const { jest: j } = require('@jest/globals');
    return { logInfo: j.fn(), logError: j.fn(), logDebug: j.fn() };
});

jest.mock('../../../../fhir/fhirResourceSerializer', () => {
    const { jest: j } = require('@jest/globals');
    return { FhirResourceSerializer: { serialize: j.fn((json) => json) } };
});

jest.mock('../../../../utils/validator.util', () => {
    const { jest: j } = require('@jest/globals');
    return {
        ...j.requireActual('../../../../utils/validator.util'),
        validateResource: j.fn(() => null)
    };
});

jest.mock('../../../../utils/contextDataBuilder', () => {
    const { jest: j } = require('@jest/globals');
    return { buildContextDataForHybridStorage: j.fn(() => null) };
});

const { UpdateOperation } = require('../../../../operations/update/update');
const { DatabaseQueryFactory } = require('../../../../dataLayer/databaseQueryFactory');
const { AuditLogger } = require('../../../../utils/auditLogger');
const { PostRequestProcessor } = require('../../../../utils/postRequestProcessor');
const { FhirLoggingManager } = require('../../../../operations/common/fhirLoggingManager');
const { ScopesValidator } = require('../../../../operations/security/scopesValidator');
const { ResourceValidator } = require('../../../../operations/common/resourceValidator');
const { FastDatabaseBulkInserter } = require('../../../../dataLayer/fastDatabaseBulkInserter');
const { ResourceMerger } = require('../../../../operations/common/resourceMerger');
const { ConfigManager } = require('../../../../utils/configManager');
const { DatabaseAttachmentManager } = require('../../../../dataLayer/databaseAttachmentManager');
const { Base64DataManager } = require('../../../../dataLayer/base64DataManager');
const { ParsedArgs } = require('../../../../operations/query/parsedArgs');
const { SourceAssigningAuthorityColumnHandler } = require('../../../../preSaveHandlers/handlers/sourceAssigningAuthorityColumnHandler');
const { UuidColumnHandler } = require('../../../../preSaveHandlers/handlers/uuidColumnHandler');
const { SecurityTagSystem } = require('../../../../utils/securityTagSystem');
const { generateUUIDv5 } = require('../../../../utils/uid.util');
const { IdentifierEnrichmentProvider } = require('../../../../enrich/providers/identifierEnrichmentProvider');
const { GroupExtendedTagEnrichmentProvider } = require('../../../../enrich/providers/groupExtendedTagEnrichmentProvider');
const BaseSerializer = require('../../../../fhir/writeSerializers/4_0_0/customSerializers/baseSerializer');

BaseSerializer.setConfigManager({ preSaveCodingIdUpdateResources: [] });

function createMockInstance(ClassType) {
    return Object.create(ClassType.prototype);
}

const ownerSecurity = [{ system: SecurityTagSystem.owner, code: 'bwell' }];

describe('UpdateOperation', () => {
    let updateOp;
    let mocks;
    let mockParsedArgs;

    beforeEach(() => {
        mocks = {
            databaseQueryFactory: createMockInstance(DatabaseQueryFactory),
            auditLogger: createMockInstance(AuditLogger),
            postRequestProcessor: createMockInstance(PostRequestProcessor),
            fhirLoggingManager: createMockInstance(FhirLoggingManager),
            scopesValidator: createMockInstance(ScopesValidator),
            resourceValidator: createMockInstance(ResourceValidator),
            fastDatabaseBulkInserter: createMockInstance(FastDatabaseBulkInserter),
            resourceMerger: createMockInstance(ResourceMerger),
            configManager: createMockInstance(ConfigManager),
            databaseAttachmentManager: createMockInstance(DatabaseAttachmentManager),
            base64DataManager: createMockInstance(Base64DataManager),
            postSaveHandlerFactory: createMockInstance(
                require('../../../../dataLayer/postSaveHandlers/postSaveHandlerFactory').PostSaveHandlerFactory
            ),
            identifierEnrichmentProvider: createMockInstance(IdentifierEnrichmentProvider),
            groupExtendedTagEnrichmentProvider: createMockInstance(GroupExtendedTagEnrichmentProvider)
        };

        // Setup mocks
        mocks.scopesValidator.verifyHasValidScopesAsync = jest.fn().mockResolvedValue(undefined);
        mocks.scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes = jest.fn().mockResolvedValue(undefined);
        mocks.scopesValidator.isAccessTagChangeAllowedByAccessScopes = jest.fn();
        mocks.resourceValidator.validateResourceAsync = jest.fn().mockResolvedValue(null);
        mocks.resourceValidator.validateResourceMetaSync = jest.fn().mockReturnValue(null);
        mocks.resourceValidator.validateResourceHasAuthorityTagSync = jest.fn().mockReturnValue(null);
        mocks.databaseQueryFactory.createQuery = jest.fn().mockReturnValue({
            findAsync: jest.fn().mockResolvedValue({
                toArrayAsync: jest.fn().mockResolvedValue([])
            })
        });
        mocks.fastDatabaseBulkInserter.insertOneAsync = jest.fn().mockResolvedValue(undefined);
        mocks.fastDatabaseBulkInserter.replaceOneAsync = jest.fn().mockResolvedValue(undefined);
        mocks.fastDatabaseBulkInserter.executeAsync = jest.fn().mockResolvedValue([{
            created: true, updated: false, id: 'test-id', uuid: 'uuid-1',
            resourceType: 'Patient', sourceAssigningAuthority: 'bwell'
        }]);
        mocks.resourceMerger.fastMergeResourceAsync = jest.fn().mockResolvedValue({
            updatedResource: null, patches: []
        });
        mocks.databaseAttachmentManager.transformAttachments = jest.fn((doc) => Promise.resolve(doc));
        mocks.base64DataManager.transformAsync = jest.fn((doc) => Promise.resolve(doc));
        mocks.fhirLoggingManager.logOperationSuccessAsync = jest.fn().mockResolvedValue(undefined);
        mocks.fhirLoggingManager.logOperationFailureAsync = jest.fn().mockResolvedValue(undefined);
        mocks.postRequestProcessor.add = jest.fn();
        mocks.auditLogger.logAuditEntryAsync = jest.fn().mockResolvedValue(undefined);
        mocks.postSaveHandlerFactory.getHandlers = jest.fn().mockReturnValue([]);
        mocks.identifierEnrichmentProvider.enrichIdentifierList = jest.fn();
        mocks.groupExtendedTagEnrichmentProvider.enrichAsync = jest.fn(({ resources }) => Promise.resolve(resources));

        Object.defineProperty(mocks.configManager, 'useAccessIndex', { get: () => false });
        Object.defineProperty(mocks.configManager, 'preSaveCodingIdUpdateResources', { get: () => [] });
        mocks.sourceAssigningAuthorityColumnHandler = new SourceAssigningAuthorityColumnHandler({ configManager: mocks.configManager });
        mocks.uuidColumnHandler = new UuidColumnHandler();

        mockParsedArgs = createMockInstance(ParsedArgs);
        mockParsedArgs.base_version = '4_0_0';
        mockParsedArgs.id = 'test-id';
        mockParsedArgs._useAccessIndex = false;
        mockParsedArgs.getOriginal = jest.fn().mockReturnValue(undefined);
        mockParsedArgs.getRawArgs = jest.fn().mockReturnValue({});

        updateOp = new UpdateOperation(mocks);
    });

    // ========== updateAsync (the single large method) ==========
    describe('updateAsync', () => {
        test('throws when requestInfo is undefined', async () => {
            await expect(
                updateOp.updateAsync({
                    requestInfo: undefined,
                    parsedArgs: mockParsedArgs,
                    resourceType: 'Patient'
                })
            ).rejects.toThrow();
        });

        test('throws when resourceType is undefined', async () => {
            await expect(
                updateOp.updateAsync({
                    requestInfo: { user: 'admin', scope: 'user/*.write', path: '/Patient', body: {}, requestId: 'r1' },
                    parsedArgs: mockParsedArgs,
                    resourceType: undefined
                })
            ).rejects.toThrow();
        });

        test('creates new resource when not found in database', async () => {
            const requestInfo = {
                user: 'admin',
                scope: 'user/*.write',
                path: '/Patient/test-id',
                body: { id: 'test-id', resourceType: 'Patient', meta: { source: 'urn:test', security: ownerSecurity } },
                requestId: 'req-1',
                isUser: false,
                personIdFromJwtToken: null,
                headers: {}
            };

            const result = await updateOp.updateAsync({
                requestInfo,
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            });

            expect(result.created).toBe(true);
            expect(mocks.fastDatabaseBulkInserter.insertOneAsync).toHaveBeenCalled();
        });

        test('strips a client-supplied _file_id and _uuid before validation and transformAttachments', async () => {
            const requestInfo = {
                user: 'admin',
                scope: 'user/*.write',
                path: '/Patient/test-id',
                body: {
                    id: 'test-id',
                    resourceType: 'Patient',
                    meta: { source: 'urn:test', security: ownerSecurity },
                    _uuid: 'attacker-supplied-uuid',
                    photo: [{ _file_id: 'attacker-chosen-gridfs-id', contentType: 'image/png' }]
                },
                requestId: 'req-1',
                isUser: false,
                personIdFromJwtToken: null,
                headers: {}
            };

            let payloadAtValidation;
            mocks.resourceValidator.validateResourceAsync = jest.fn(async ({ resourceToValidate }) => {
                payloadAtValidation = JSON.parse(JSON.stringify(resourceToValidate));
                return null;
            });

            await updateOp.updateAsync({
                requestInfo,
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            });

            expect(payloadAtValidation._uuid).toBeUndefined();
            expect(payloadAtValidation.photo[0]._file_id).toBeUndefined();

            const resourcePassedToAttachmentManager = mocks.databaseAttachmentManager.transformAttachments.mock.calls[0][0];
            expect(resourcePassedToAttachmentManager.photo[0]._file_id).toBeUndefined();
            expect(resourcePassedToAttachmentManager._uuid).not.toBe('attacker-supplied-uuid');
        });

        test('updates existing resource when found', async () => {
            const existingResource = {
                id: 'test-id',
                _uuid: 'uuid-1',
                _sourceAssigningAuthority: 'bwell',
                resourceType: 'Patient',
                meta: { versionId: '1', lastUpdated: new Date(), security: [], source: 'urn:test' }
            };

            mocks.databaseQueryFactory.createQuery.mockReturnValue({
                findAsync: jest.fn().mockResolvedValue({
                    toArrayAsync: jest.fn().mockResolvedValue([existingResource])
                })
            });
            mocks.resourceMerger.fastMergeResourceAsync.mockResolvedValue({
                updatedResource: {
                    ...existingResource,
                    meta: { ...existingResource.meta, versionId: '2' }
                },
                patches: [{ op: 'replace', path: '/name' }]
            });
            mocks.fastDatabaseBulkInserter.executeAsync.mockResolvedValue([{
                created: false, updated: true, id: 'test-id', uuid: 'uuid-1',
                resourceType: 'Patient', sourceAssigningAuthority: 'bwell'
            }]);

            const requestInfo = {
                user: 'admin',
                scope: 'user/*.write',
                path: '/Patient/test-id',
                body: { id: 'test-id', resourceType: 'Patient', meta: { security: ownerSecurity }, name: [{ family: 'Smith' }] },
                requestId: 'req-1',
                isUser: false,
                personIdFromJwtToken: null,
                headers: {}
            };

            const result = await updateOp.updateAsync({
                requestInfo,
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            });

            expect(result.created).toBe(false);
            expect(mocks.fastDatabaseBulkInserter.replaceOneAsync).toHaveBeenCalled();
        });

        test('looks the existing resource up by the uuid derived from id and owner tag', async () => {
            const findAsync = jest.fn().mockResolvedValue({
                toArrayAsync: jest.fn().mockResolvedValue([])
            });
            mocks.databaseQueryFactory.createQuery.mockReturnValue({ findAsync });

            await updateOp.updateAsync({
                requestInfo: {
                    user: 'admin',
                    scope: 'user/*.write',
                    path: '/Patient/test-id',
                    body: { id: 'test-id', resourceType: 'Patient', meta: { security: ownerSecurity } },
                    requestId: 'req-1',
                    isUser: false,
                    personIdFromJwtToken: null,
                    headers: {}
                },
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            });

            expect(findAsync.mock.calls[0][0].query).toEqual({ _uuid: generateUUIDv5('test-id|bwell') });
        });

        test('looks the resource up by the uuid derived from the body owner when the id authority matches it', async () => {
            const findAsync = jest.fn().mockResolvedValue({
                toArrayAsync: jest.fn().mockResolvedValue([])
            });
            mocks.databaseQueryFactory.createQuery.mockReturnValue({ findAsync });
            mockParsedArgs.getOriginal.mockReturnValue({ queryParameterValue: { value: 'test-id|bwell' } });

            await updateOp.updateAsync({
                requestInfo: {
                    user: 'admin',
                    scope: 'user/*.write',
                    path: '/Patient/test-id',
                    body: { id: 'test-id', resourceType: 'Patient', meta: { security: ownerSecurity } },
                    requestId: 'req-1',
                    isUser: false,
                    personIdFromJwtToken: null,
                    headers: {}
                },
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            });

            expect(findAsync.mock.calls[0][0].query).toEqual({ _uuid: generateUUIDv5('test-id|bwell') });
        });

        test('throws BadRequestError without querying when the id authority differs from the body owner', async () => {
            mockParsedArgs.getOriginal.mockReturnValue({ queryParameterValue: { value: 'test-id|client' } });

            await expect(
                updateOp.updateAsync({
                    requestInfo: {
                        user: 'admin',
                        scope: 'user/*.write',
                        path: '/Patient/test-id',
                        body: { id: 'test-id', resourceType: 'Patient', meta: { security: ownerSecurity } },
                        requestId: 'req-1',
                        isUser: false,
                        personIdFromJwtToken: null,
                        headers: {}
                    },
                    parsedArgs: mockParsedArgs,
                    resourceType: 'Patient'
                })
            ).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('does not match') });
            expect(mocks.databaseQueryFactory.createQuery).not.toHaveBeenCalled();
        });

        test('throws NotValidatedError without querying when the meta tags are invalid for a non-uuid id', async () => {
            const operationOutcome = {
                resourceType: 'OperationOutcome',
                issue: [{ severity: 'error', code: 'invalid', details: { text: 'missing owner tag' } }]
            };
            mocks.resourceValidator.validateResourceHasAuthorityTagSync.mockReturnValue(operationOutcome);

            await expect(
                updateOp.updateAsync({
                    requestInfo: {
                        user: 'admin',
                        scope: 'user/*.write',
                        path: '/Patient/test-id',
                        body: { id: 'test-id', resourceType: 'Patient' },
                        requestId: 'req-1',
                        isUser: false,
                        personIdFromJwtToken: null,
                        headers: {}
                    },
                    parsedArgs: mockParsedArgs,
                    resourceType: 'Patient'
                })
            ).rejects.toMatchObject({
                message: 'Validation Failed',
                statusCode: 400,
                issue: operationOutcome.issue
            });
            expect(mocks.databaseQueryFactory.createQuery).not.toHaveBeenCalled();
        });

        test('throws PreconditionFailedError on If-Match version mismatch', async () => {
            const existingResource = {
                id: 'test-id',
                _uuid: 'uuid-1',
                resourceType: 'Patient',
                meta: { versionId: '2', lastUpdated: new Date(), security: [] }
            };
            mocks.databaseQueryFactory.createQuery.mockReturnValue({
                findAsync: jest.fn().mockResolvedValue({
                    toArrayAsync: jest.fn().mockResolvedValue([existingResource])
                })
            });

            const requestInfo = {
                user: 'admin',
                scope: 'user/*.write',
                path: '/Patient/test-id',
                body: { id: 'test-id', resourceType: 'Patient', meta: { security: ownerSecurity } },
                requestId: 'req-1',
                isUser: false,
                personIdFromJwtToken: null,
                headers: { 'if-match': 'W/"1"' }
            };

            await expect(
                updateOp.updateAsync({
                    requestInfo,
                    parsedArgs: mockParsedArgs,
                    resourceType: 'Patient'
                })
            ).rejects.toThrow(/Version conflict/);
        });

        test('returns not modified when merge produces no changes', async () => {
            const existingResource = {
                id: 'test-id',
                _uuid: 'uuid-1',
                _sourceAssigningAuthority: 'bwell',
                resourceType: 'Patient',
                meta: { versionId: '1', lastUpdated: new Date(), security: [], source: 'urn:test' }
            };
            mocks.databaseQueryFactory.createQuery.mockReturnValue({
                findAsync: jest.fn().mockResolvedValue({
                    toArrayAsync: jest.fn().mockResolvedValue([existingResource])
                })
            });
            mocks.resourceMerger.fastMergeResourceAsync.mockResolvedValue({
                updatedResource: null,
                patches: []
            });

            const requestInfo = {
                user: 'admin',
                scope: 'user/*.write',
                path: '/Patient/test-id',
                body: { id: 'test-id', resourceType: 'Patient', meta: { security: ownerSecurity } },
                requestId: 'req-1',
                isUser: false,
                personIdFromJwtToken: null,
                headers: {}
            };

            const result = await updateOp.updateAsync({
                requestInfo,
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            });

            expect(result.created).toBe(false);
            expect(result.updated).toBe(false);
            expect(mocks.fastDatabaseBulkInserter.replaceOneAsync).not.toHaveBeenCalled();
        });

        const existingResource = {
            id: 'test-id',
            _uuid: 'uuid-1',
            _sourceAssigningAuthority: 'bwell',
            resourceType: 'Patient',
            meta: { versionId: '1', lastUpdated: new Date(), security: [], source: 'urn:test' }
        };

        const buildRequestInfo = () => ({
            user: 'admin',
            scope: 'user/*.write',
            path: '/Patient/test-id',
            body: { id: 'test-id', resourceType: 'Patient', meta: { source: 'urn:test', security: ownerSecurity }, name: [{ family: 'Smith' }] },
            requestId: 'req-1',
            isUser: false,
            personIdFromJwtToken: null,
            headers: {}
        });

        const runQueuedAuditTasksAsync = async () => {
            for (const [{ fnTask }] of mocks.postRequestProcessor.add.mock.calls) {
                await fnTask();
            }
        };

        test.each([
            ['id not found -> create', false, { created: true, updated: false }, 'create'],
            ['id found -> update', true, { created: false, updated: true }, 'update']
        ])('%s', async (_name, resourceExists, mergeFlags, expectedOperation) => {
            if (resourceExists) {
                mocks.databaseQueryFactory.createQuery.mockReturnValue({
                    findAsync: jest.fn().mockResolvedValue({
                        toArrayAsync: jest.fn().mockResolvedValue([existingResource])
                    })
                });
                mocks.resourceMerger.fastMergeResourceAsync.mockResolvedValue({
                    updatedResource: {
                        ...existingResource,
                        meta: { ...existingResource.meta, versionId: '2' }
                    },
                    patches: [{ op: 'replace', path: '/name' }]
                });
            }
            mocks.fastDatabaseBulkInserter.executeAsync.mockResolvedValue([{
                ...mergeFlags, id: 'test-id', uuid: 'uuid-1',
                resourceType: 'Patient', sourceAssigningAuthority: 'bwell'
            }]);

            await updateOp.updateAsync({
                requestInfo: buildRequestInfo(),
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            });
            await runQueuedAuditTasksAsync();

            expect(mocks.auditLogger.logAuditEntryAsync).toHaveBeenCalledTimes(1);
            expect(mocks.auditLogger.logAuditEntryAsync).toHaveBeenCalledWith(
                expect.objectContaining({ operation: expectedOperation, resourceType: 'Patient' })
            );
        });

        test('no audit entry when the write is neither created nor updated (request fails)', async () => {
            mocks.fastDatabaseBulkInserter.executeAsync.mockResolvedValue([{
                created: false, updated: false, id: 'test-id', uuid: 'uuid-1',
                resourceType: 'Patient', sourceAssigningAuthority: 'bwell', issue: { code: 'exception' }
            }]);

            await expect(updateOp.updateAsync({
                requestInfo: buildRequestInfo(),
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            })).rejects.toThrow();

            expect(mocks.postRequestProcessor.add).not.toHaveBeenCalled();
            expect(mocks.auditLogger.logAuditEntryAsync).not.toHaveBeenCalled();
        });
    });
});
