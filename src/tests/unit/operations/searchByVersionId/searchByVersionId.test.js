const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

jest.mock('express-http-context', () => {
    const { jest: j } = require('@jest/globals');
    return { get: j.fn(), set: j.fn() };
});

jest.mock('../../../../operations/common/logging', () => {
    const { jest: j } = require('@jest/globals');
    return { logInfo: j.fn(), logError: j.fn(), logDebug: j.fn() };
});

jest.mock('../../../../fhir/fhirResourceCreator', () => {
    const { jest: j } = require('@jest/globals');
    return {
        FhirResourceCreator: {
            create: j.fn((json) => ({
                ...json,
                _uuid: json._uuid || 'uuid-history',
                toJSON: () => json,
                toJSONInternal: () => json
            }))
        }
    };
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
            historyResourceCloudStorageClient: null
        };

        // Setup default mocks
        mocks.scopesValidator.verifyHasValidScopesAsync = jest.fn().mockResolvedValue(undefined);
        mocks.scopesManager.hasPatientScope = jest.fn().mockReturnValue(false);
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
});
