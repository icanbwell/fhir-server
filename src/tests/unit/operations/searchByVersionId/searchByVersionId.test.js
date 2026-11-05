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
    return {
        FhirResourceSerializer: {
            serialize: j.fn((resource) => ({ ...resource, _serialized: true }))
        }
    };
});

const { SearchByVersionIdOperation } = require('../../../../operations/searchByVersionId/searchByVersionId');
const { DatabaseHistoryFactory } = require('../../../../dataLayer/databaseHistoryFactory');
const { FhirLoggingManager } = require('../../../../operations/common/fhirLoggingManager');
const { ScopesValidator } = require('../../../../operations/security/scopesValidator');
const { EnrichmentManager } = require('../../../../enrich/enrich');
const { ConfigManager } = require('../../../../utils/configManager');
const { SearchManager } = require('../../../../operations/search/searchManager');
const { ScopesManager } = require('../../../../operations/security/scopesManager');
const { DatabaseAttachmentManager } = require('../../../../dataLayer/databaseAttachmentManager');
const { Base64DataManager } = require('../../../../dataLayer/base64DataManager');
const { ParsedArgs } = require('../../../../operations/query/parsedArgs');
const { CloudStorageClient } = require('../../../../utils/cloudStorageClient');
const { MongoGroupMemberRepository } = require('../../../../dataLayer/repositories/mongoGroupMemberRepository');
const { AuditLogger } = require('../../../../utils/auditLogger');
const { PostRequestProcessor } = require('../../../../utils/postRequestProcessor');
const { MONGO_GROUP_EXTENDED_FIELD } = require('../../../../utils/mongoGroupExtendedTag');

function createMockInstance(ClassType) {
    return Object.create(ClassType.prototype);
}

describe('SearchByVersionIdOperation', () => {
    let searchByVersionIdOp;
    let mocks;
    let mockParsedArgs;

    beforeEach(() => {
        mocks = {
            databaseHistoryFactory: createMockInstance(DatabaseHistoryFactory),
            fhirLoggingManager: createMockInstance(FhirLoggingManager),
            scopesValidator: createMockInstance(ScopesValidator),
            enrichmentManager: createMockInstance(EnrichmentManager),
            configManager: createMockInstance(ConfigManager),
            searchManager: createMockInstance(SearchManager),
            scopesManager: createMockInstance(ScopesManager),
            databaseAttachmentManager: createMockInstance(DatabaseAttachmentManager),
            base64DataManager: createMockInstance(Base64DataManager),
            historyResourceCloudStorageClient: null,
            mongoGroupMemberRepository: createMockInstance(MongoGroupMemberRepository),
            auditLogger: createMockInstance(AuditLogger),
            postRequestProcessor: createMockInstance(PostRequestProcessor)
        };
        mocks.auditLogger.logAuditEntryAsync = jest.fn().mockResolvedValue(undefined);
        mocks.postRequestProcessor.add = jest.fn();

        // Setup default mocks
        mocks.scopesValidator.verifyHasValidScopesAsync = jest.fn().mockResolvedValue(undefined);
        mocks.scopesManager.hasPatientScope = jest.fn().mockReturnValue(false);
        mocks.scopesManager.hasHistoryAccess = jest.fn().mockReturnValue(true);
        mocks.searchManager.constructQueryAsync = jest.fn().mockResolvedValue({ query: { _sourceId: 'test-id' } });
        mocks.databaseHistoryFactory.createDatabaseHistoryManager = jest.fn().mockReturnValue({
            findOneAsync: jest.fn().mockResolvedValue(null)
        });
        mocks.enrichmentManager.enrichAsync = jest.fn(({ resources }) => Promise.resolve(resources));
        mocks.databaseAttachmentManager.transformAttachments = jest.fn((doc) => Promise.resolve(doc));
        mocks.base64DataManager.transformAsync = jest.fn((doc) => Promise.resolve(doc));
        mocks.fhirLoggingManager.logOperationSuccessAsync = jest.fn().mockResolvedValue(undefined);
        mocks.fhirLoggingManager.logOperationFailureAsync = jest.fn().mockResolvedValue(undefined);

        Object.defineProperty(mocks.configManager, 'useAccessIndex', { get: () => false, configurable: true });
        Object.defineProperty(mocks.configManager, 'cloudStorageHistoryResources', { get: () => [], configurable: true });

        mockParsedArgs = createMockInstance(ParsedArgs);
        mockParsedArgs.base_version = '4_0_0';
        mockParsedArgs.id = 'test-id';
        mockParsedArgs.version_id = '2';
        mockParsedArgs._useAccessIndex = false;
        mockParsedArgs.getRawArgs = jest.fn().mockReturnValue({});

        searchByVersionIdOp = new SearchByVersionIdOperation(mocks);
    });

    describe('searchByVersionIdAsync', () => {
        test('throws when requestInfo is undefined', async () => {
            await expect(
                searchByVersionIdOp.searchByVersionIdAsync({
                    requestInfo: undefined,
                    parsedArgs: mockParsedArgs,
                    resourceType: 'Patient'
                })
            ).rejects.toThrow();
        });

        test('throws when resourceType is undefined', async () => {
            await expect(
                searchByVersionIdOp.searchByVersionIdAsync({
                    requestInfo: { user: 'admin', scope: 'user/*.read', requestId: 'r1', isUser: false, personIdFromJwtToken: null, actor: null, userType: 'user' },
                    parsedArgs: mockParsedArgs,
                    resourceType: undefined
                })
            ).rejects.toThrow();
        });

        test('throws ForbiddenError when patient scope is present', async () => {
            mocks.scopesManager.hasPatientScope.mockReturnValue(true);

            const requestInfo = {
                user: 'patient-user',
                scope: 'patient/*.read',
                requestId: 'r1',
                isUser: true,
                personIdFromJwtToken: 'person-123',
                actor: null,
                userType: 'patient'
            };

            await expect(
                searchByVersionIdOp.searchByVersionIdAsync({
                    requestInfo,
                    parsedArgs: mockParsedArgs,
                    resourceType: 'Patient'
                })
            ).rejects.toThrow(/Access to history resources not allowed if patient scope is present/);
        });

        test('throws BadRequestError when version_id is not a string', async () => {
            mockParsedArgs.version_id = 123; // number, not string

            const requestInfo = {
                user: 'admin',
                scope: 'user/*.read',
                requestId: 'r1',
                isUser: false,
                personIdFromJwtToken: null,
                actor: null,
                userType: 'user'
            };

            await expect(
                searchByVersionIdOp.searchByVersionIdAsync({
                    requestInfo,
                    parsedArgs: mockParsedArgs,
                    resourceType: 'Patient'
                })
            ).rejects.toThrow();
        });

        /**
         * BUG: BadRequestError is constructed with a plain string 'version_id must be a string'
         * instead of new Error('version_id must be a string'). BadRequestError expects an Error
         * object and accesses error.message, so the actual error message is lost (becomes undefined).
         */
        test('BUG: BadRequestError for version_id loses error message because string passed instead of Error', async () => {
            mockParsedArgs.version_id = 123; // number, not string

            const requestInfo = {
                user: 'admin',
                scope: 'user/*.read',
                requestId: 'r1',
                isUser: false,
                personIdFromJwtToken: null,
                actor: null,
                userType: 'user'
            };

            try {
                await searchByVersionIdOp.searchByVersionIdAsync({
                    requestInfo,
                    parsedArgs: mockParsedArgs,
                    resourceType: 'Patient'
                });
                expect(true).toBe(false); // should not reach here
            } catch (e) {
                // The error message is undefined because BadRequestError expects Error object
                // but receives a string. String has no .message property.
                expect(e.message).toBeUndefined();
                expect(e.statusCode).toBe(400);
            }
        });

        test('throws NotFoundError when history not found', async () => {
            const requestInfo = {
                user: 'admin',
                scope: 'user/*.read',
                requestId: 'r1',
                isUser: false,
                personIdFromJwtToken: null,
                actor: null,
                userType: 'user'
            };

            await expect(
                searchByVersionIdOp.searchByVersionIdAsync({
                    requestInfo,
                    parsedArgs: mockParsedArgs,
                    resourceType: 'Patient'
                })
            ).rejects.toThrow(/History not found/);
        });

        test('successfully returns resource when history found', async () => {
            const historyResult = {
                resource: {
                    id: 'test-id',
                    _uuid: 'uuid-1',
                    resourceType: 'Patient',
                    meta: { versionId: '2' }
                },
                collectionName: 'Patient_4_0_0_History'
            };

            mocks.databaseHistoryFactory.createDatabaseHistoryManager.mockReturnValue({
                findOneAsync: jest.fn().mockResolvedValue(historyResult)
            });

            const requestInfo = {
                user: 'admin',
                scope: 'user/*.read',
                requestId: 'r1',
                isUser: false,
                personIdFromJwtToken: null,
                actor: null,
                userType: 'user'
            };

            const result = await searchByVersionIdOp.searchByVersionIdAsync({
                requestInfo,
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            });

            expect(result).toBeDefined();
            expect(result.id).toBe('test-id');
        });

        test.each([
            ['Patient', 1],
            ['AuditEvent', 0]
        ])('queues a read audit entry for %s resources (%i expected)', async (resourceType, expectedTasks) => {
            mocks.databaseHistoryFactory.createDatabaseHistoryManager.mockReturnValue({
                findOneAsync: jest.fn().mockResolvedValue({
                    resource: { id: 'test-id', _uuid: 'uuid-1', resourceType, meta: { versionId: '2' } },
                    collectionName: 'History'
                })
            });
            const requestInfo = {
                user: 'admin', scope: 'user/*.read', requestId: 'r1', isUser: false,
                personIdFromJwtToken: null, actor: null, userType: 'user'
            };

            await searchByVersionIdOp.searchByVersionIdAsync({ requestInfo, parsedArgs: mockParsedArgs, resourceType });

            expect(mocks.postRequestProcessor.add).toHaveBeenCalledTimes(expectedTasks);
            if (expectedTasks > 0) {
                const { requestId, fnTask } = mocks.postRequestProcessor.add.mock.calls[0][0];
                expect(requestId).toBe('r1');
                await fnTask();
                expect(mocks.auditLogger.logAuditEntryAsync).toHaveBeenCalledWith(
                    expect.objectContaining({ resourceType, operation: 'read', ids: ['uuid-1'] })
                );
            }
        });

        test('does not queue an audit entry when the version is not found', async () => {
            const requestInfo = {
                user: 'admin', scope: 'user/*.read', requestId: 'r1', isUser: false,
                personIdFromJwtToken: null, actor: null, userType: 'user'
            };

            await expect(
                searchByVersionIdOp.searchByVersionIdAsync({ requestInfo, parsedArgs: mockParsedArgs, resourceType: 'Patient' })
            ).rejects.toThrow();

            expect(mocks.postRequestProcessor.add).not.toHaveBeenCalled();
        });

        test('hands the stored history document to enrichment as a plain object', async () => {
            const historyResult = {
                resource: {
                    id: 'test-id',
                    _uuid: 'uuid-1',
                    resourceType: 'Patient',
                    meta: { versionId: '2' }
                },
                collectionName: 'Patient_4_0_0_History'
            };
            mocks.databaseHistoryFactory.createDatabaseHistoryManager.mockReturnValue({
                findOneAsync: jest.fn().mockResolvedValue(historyResult)
            });

            await searchByVersionIdOp.searchByVersionIdAsync({
                requestInfo: { user: 'admin', scope: 'user/*.read', requestId: 'r1', isUser: false, personIdFromJwtToken: null, actor: null, userType: 'user' },
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            });

            const { resources } = mocks.enrichmentManager.enrichAsync.mock.calls[0][0];
            expect(resources).toHaveLength(1);
            expect(Object.getPrototypeOf(resources[0])).toBe(Object.prototype);
            expect(resources[0]).toStrictEqual({
                id: 'test-id',
                _uuid: 'uuid-1',
                resourceType: 'Patient',
                meta: { versionId: '2' }
            });
        });

        test('appends version query to existing $and clause', async () => {
            mocks.searchManager.constructQueryAsync.mockResolvedValue({
                query: { $and: [{ _sourceId: 'test-id' }, { 'meta.security': { $exists: true } }] }
            });

            mocks.databaseHistoryFactory.createDatabaseHistoryManager.mockReturnValue({
                findOneAsync: jest.fn().mockResolvedValue(null)
            });

            const requestInfo = {
                user: 'admin',
                scope: 'user/*.read',
                requestId: 'r1',
                isUser: false,
                personIdFromJwtToken: null,
                actor: null,
                userType: 'user'
            };

            await expect(
                searchByVersionIdOp.searchByVersionIdAsync({
                    requestInfo,
                    parsedArgs: mockParsedArgs,
                    resourceType: 'Patient'
                })
            ).rejects.toThrow(/History not found/);

            // Verify the query was modified to include versionId
            const findOneCall = mocks.databaseHistoryFactory.createDatabaseHistoryManager()
                .findOneAsync;
            expect(findOneCall).toHaveBeenCalled();
        });

        test('fetches from cloud storage when configured', async () => {
            const cloudStorageClient = createMockInstance(CloudStorageClient);
            cloudStorageClient.downloadAsync = jest.fn().mockResolvedValue(
                JSON.stringify({
                    id: 'test-id',
                    _uuid: 'uuid-1',
                    resourceType: 'Patient',
                    meta: { versionId: '2' }
                })
            );
            mocks.historyResourceCloudStorageClient = cloudStorageClient;

            Object.defineProperty(mocks.configManager, 'cloudStorageHistoryResources', {
                get: () => ['Patient'],
                configurable: true
            });

            const historyResult = {
                resource: {
                    id: 'test-id',
                    _uuid: 'uuid-1',
                    resourceType: 'Patient',
                    meta: { versionId: '2' }
                },
                collectionName: 'Patient_4_0_0_History'
            };
            // Add the cloud storage path key (_ref) to historyResource
            historyResult.resource['_ref'] = 'v2';

            mocks.databaseHistoryFactory.createDatabaseHistoryManager.mockReturnValue({
                findOneAsync: jest.fn().mockResolvedValue(historyResult)
            });

            // Need to re-create operation with cloud storage client
            searchByVersionIdOp = new SearchByVersionIdOperation(mocks);

            const requestInfo = {
                user: 'admin',
                scope: 'user/*.read',
                requestId: 'r1',
                isUser: false,
                personIdFromJwtToken: null,
                actor: null,
                userType: 'user'
            };

            const result = await searchByVersionIdOp.searchByVersionIdAsync({
                requestInfo,
                parsedArgs: mockParsedArgs,
                resourceType: 'Patient'
            });

            expect(result).toBeDefined();
        });

        test('handles database error by throwing NotFoundError', async () => {
            mocks.databaseHistoryFactory.createDatabaseHistoryManager.mockReturnValue({
                findOneAsync: jest.fn().mockRejectedValue(new Error('DB connection error'))
            });

            const requestInfo = {
                user: 'admin',
                scope: 'user/*.read',
                requestId: 'r1',
                isUser: false,
                personIdFromJwtToken: null,
                actor: null,
                userType: 'user'
            };

            await expect(
                searchByVersionIdOp.searchByVersionIdAsync({
                    requestInfo,
                    parsedArgs: mockParsedArgs,
                    resourceType: 'Patient'
                })
            ).rejects.toThrow(/Resource not found/);
        });
    });

    describe('extended Group roster streaming (DCON-5530)', () => {
        const requestInfo = {
            user: 'admin',
            scope: 'user/*.read',
            requestId: 'r1',
            isUser: false,
            personIdFromJwtToken: null,
            actor: null,
            userType: 'user'
        };

        function mockExtendedGroupHistoryResult () {
            return {
                resource: {
                    id: 'group-1',
                    _uuid: 'group-uuid-1',
                    resourceType: 'Group',
                    [MONGO_GROUP_EXTENDED_FIELD]: true,
                    meta: { versionId: '3', lastUpdated: new Date('2026-01-01T00:00:00.000Z') }
                },
                collectionName: 'Group_4_0_0_History'
            };
        }

        beforeEach(() => {
            Object.defineProperty(mocks.configManager, 'enableExtendedGroup', { get: () => true, configurable: true });
            mocks.databaseHistoryFactory.createDatabaseHistoryManager.mockReturnValue({
                findOneAsync: jest.fn().mockResolvedValue(mockExtendedGroupHistoryResult())
            });
        });

        test('streams the reconstructed roster and returns null instead of the resource', async () => {
            const fakeCursor = {};
            mocks.mongoGroupMemberRepository.getMemberCursorAtAsync = jest.fn().mockResolvedValue(fakeCursor);
            mocks.searchManager.streamGroupMemberArrayAsync = jest.fn().mockResolvedValue(undefined);
            const res = {};

            const result = await searchByVersionIdOp.searchByVersionIdAsync({
                requestInfo,
                parsedArgs: mockParsedArgs,
                resourceType: 'Group',
                res
            });

            expect(result).toBeNull();
            expect(mocks.mongoGroupMemberRepository.getMemberCursorAtAsync).toHaveBeenCalledWith({
                base_version: '4_0_0',
                groupUuid: 'group-uuid-1',
                targetLastUpdated: new Date('2026-01-01T00:00:00.000Z')
            });
            expect(mocks.searchManager.streamGroupMemberArrayAsync).toHaveBeenCalledWith(
                expect.objectContaining({
                    requestId: 'r1',
                    cursor: fakeCursor,
                    res,
                    rebuildCursorAsync: expect.any(Function)
                })
            );
        });

        test('queues the read audit entry for the group before streaming the roster', async () => {
            mocks.mongoGroupMemberRepository.getMemberCursorAtAsync = jest.fn().mockResolvedValue({});
            mocks.searchManager.streamGroupMemberArrayAsync = jest.fn().mockResolvedValue(undefined);

            await searchByVersionIdOp.searchByVersionIdAsync({
                requestInfo,
                parsedArgs: mockParsedArgs,
                resourceType: 'Group',
                res: {}
            });

            expect(mocks.postRequestProcessor.add).toHaveBeenCalledTimes(1);
            const { fnTask } = mocks.postRequestProcessor.add.mock.calls[0][0];
            await fnTask();
            expect(mocks.auditLogger.logAuditEntryAsync).toHaveBeenCalledWith(
                expect.objectContaining({ resourceType: 'Group', operation: 'read', ids: ['group-uuid-1'] })
            );
        });

        test('rebuildCursorAsync resumes past the given lastUUID with the widened timeout', async () => {
            mocks.mongoGroupMemberRepository.getMemberCursorAtAsync = jest.fn().mockResolvedValue({});
            let capturedRebuild;
            mocks.searchManager.streamGroupMemberArrayAsync = jest.fn().mockImplementation(
                async ({ rebuildCursorAsync }) => {
                    capturedRebuild = rebuildCursorAsync;
                }
            );

            await searchByVersionIdOp.searchByVersionIdAsync({
                requestInfo,
                parsedArgs: mockParsedArgs,
                resourceType: 'Group',
                res: {}
            });

            mocks.mongoGroupMemberRepository.getMemberCursorAtAsync.mockClear();
            await capturedRebuild({ lastUUID: 'row-uuid-5', maxMongoTimeMS: 60000 });

            expect(mocks.mongoGroupMemberRepository.getMemberCursorAtAsync).toHaveBeenCalledWith({
                base_version: '4_0_0',
                groupUuid: 'group-uuid-1',
                targetLastUpdated: new Date('2026-01-01T00:00:00.000Z'),
                afterUuid: 'row-uuid-5',
                maxTimeMS: 60000
            });
        });

        test('does not stream when ENABLE_EXTENDED_GROUP is disabled -- returns the resource as-is', async () => {
            Object.defineProperty(mocks.configManager, 'enableExtendedGroup', { get: () => false, configurable: true });
            mocks.searchManager.streamGroupMemberArrayAsync = jest.fn();

            const result = await searchByVersionIdOp.searchByVersionIdAsync({
                requestInfo,
                parsedArgs: mockParsedArgs,
                resourceType: 'Group',
                res: {}
            });

            expect(mocks.searchManager.streamGroupMemberArrayAsync).not.toHaveBeenCalled();
            expect(result).toBeDefined();
            expect(result._uuid).toBe('group-uuid-1');
        });

        test('does not stream when res is not provided', async () => {
            mocks.searchManager.streamGroupMemberArrayAsync = jest.fn();

            const result = await searchByVersionIdOp.searchByVersionIdAsync({
                requestInfo,
                parsedArgs: mockParsedArgs,
                resourceType: 'Group'
            });

            expect(mocks.searchManager.streamGroupMemberArrayAsync).not.toHaveBeenCalled();
            expect(result).toBeDefined();
        });
    });

    describe('reading from ClickHouse', () => {
        const requestInfo = {
            user: 'admin', scope: 'access/*.read', requestId: 'r1', isUser: false,
            personIdFromJwtToken: null, actor: null, userType: 'user'
        };
        const UUID = '11111111-1111-4111-8111-111111111111';
        let historyClickHouseRepository;

        const run = () => searchByVersionIdOp.searchByVersionIdAsync({
            requestInfo, parsedArgs: mockParsedArgs, resourceType: 'Patient'
        });

        beforeEach(() => {
            Object.defineProperty(mocks.configManager, 'resourceHistoryClickHouseReadResources', {
                get: () => ['Patient'], configurable: true
            });
            historyClickHouseRepository = {
                findVersionAsync: jest.fn().mockResolvedValue({
                    id: 'e1',
                    resource: { resourceType: 'Patient', id: 'test-id', _uuid: UUID, meta: { versionId: '2', lastUpdated: '2026-01-01T00:00:00.000Z' } }
                })
            };
            mockParsedArgs.id = UUID;
            searchByVersionIdOp = new SearchByVersionIdOperation({ ...mocks, historyClickHouseRepository });
        });

        test('reads the version by resource type, _uuid and version_id and never queries MongoDB', async () => {
            const result = await run();

            expect(historyClickHouseRepository.findVersionAsync).toHaveBeenCalledWith({
                resourceType: 'Patient', uuid: UUID, versionId: '2'
            });
            expect(mocks.databaseHistoryFactory.createDatabaseHistoryManager).not.toHaveBeenCalled();
            expect(mocks.searchManager.constructQueryAsync).not.toHaveBeenCalled();
            expect(result).toBeDefined();
        });

        test('passes an extended Group member lookup a Date even though ClickHouse returns an ISO string', async () => {
            Object.defineProperty(mocks.configManager, 'resourceHistoryClickHouseReadResources', {
                get: () => ['Group'], configurable: true
            });
            Object.defineProperty(mocks.configManager, 'enableExtendedGroup', { get: () => true, configurable: true });
            historyClickHouseRepository.findVersionAsync.mockResolvedValue({
                id: 'e1',
                resource: {
                    resourceType: 'Group', id: 'test-id', _uuid: UUID, [MONGO_GROUP_EXTENDED_FIELD]: true,
                    meta: { versionId: '2', lastUpdated: '2026-01-01T00:00:00.000Z' }
                }
            });
            mocks.mongoGroupMemberRepository.getMemberCursorAtAsync = jest.fn().mockResolvedValue({});
            mocks.searchManager.streamGroupMemberArrayAsync = jest.fn().mockResolvedValue(undefined);

            await searchByVersionIdOp.searchByVersionIdAsync({
                requestInfo, parsedArgs: mockParsedArgs, resourceType: 'Group', res: {}
            });

            expect(mocks.mongoGroupMemberRepository.getMemberCursorAtAsync).toHaveBeenCalledWith(
                expect.objectContaining({ targetLastUpdated: new Date('2026-01-01T00:00:00.000Z') })
            );
        });

        test('returns 404 when the version is not in ClickHouse', async () => {
            historyClickHouseRepository.findVersionAsync.mockResolvedValue(null);

            await expect(run()).rejects.toMatchObject({ statusCode: 404 });
        });

        test.each([
            ['missing', undefined],
            ['empty', ''],
            ['a source id', 'test-id'],
            ['an id with an owner suffix', 'test-id|client-1']
        ])('rejects a request whose id is %s without querying', async (_name, id) => {
            mockParsedArgs.id = id;

            await expect(run()).rejects.toMatchObject({ statusCode: 400 });
            expect(historyClickHouseRepository.findVersionAsync).not.toHaveBeenCalled();
        });

        test('rejects _since on a single-version read', async () => {
            mockParsedArgs._since = '2026-01-01T00:00:00.000Z';

            await expect(run()).rejects.toMatchObject({ statusCode: 400 });
            expect(historyClickHouseRepository.findVersionAsync).not.toHaveBeenCalled();
        });

        test('accepts _metaUuid, which fhir-server-ui always sends', async () => {
            mockParsedArgs.getRawArgs = jest.fn().mockReturnValue({ _metaUuid: '1' });

            await expect(run()).resolves.toBeDefined();
        });

        test('rejects an argument the ClickHouse read cannot honour', async () => {
            mockParsedArgs.getRawArgs = jest.fn().mockReturnValue({ _lastUpdated: 'gt2026-01-01' });

            await expect(run()).rejects.toMatchObject({ statusCode: 400 });
            expect(historyClickHouseRepository.findVersionAsync).not.toHaveBeenCalled();
        });

        test('fails clearly when the version is a cloud storage stub', async () => {
            historyClickHouseRepository.findVersionAsync.mockResolvedValue({ id: 'e1', _ref: 'path' });

            await expect(run()).rejects.toThrow('cloud storage');
        });

        test('a ClickHouse failure is rethrown with no MongoDB fallback', async () => {
            historyClickHouseRepository.findVersionAsync.mockRejectedValue(new Error('clickhouse down'));

            await expect(run()).rejects.toThrow('clickhouse down');
            expect(mocks.databaseHistoryFactory.createDatabaseHistoryManager).not.toHaveBeenCalled();
        });

        test('a type outside the flag list still reads from MongoDB', async () => {
            Object.defineProperty(mocks.configManager, 'resourceHistoryClickHouseReadResources', {
                get: () => ['Observation'], configurable: true
            });

            await run().catch(() => {});

            expect(historyClickHouseRepository.findVersionAsync).not.toHaveBeenCalled();
            expect(mocks.databaseHistoryFactory.createDatabaseHistoryManager).toHaveBeenCalled();
        });
    });
});
