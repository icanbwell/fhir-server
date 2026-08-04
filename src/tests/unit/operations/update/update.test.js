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
            createByResourceType: j.fn((json, resourceType) => ({
                ...json,
                resourceType,
                _uuid: json._uuid || `generated-uuid-${json.id}`,
                toJSON: () => json,
                toJSONInternal: () => json,
                clone: () => ({ ...json })
            }))
        }
    };
});

jest.mock('../../../../fhir/fhirResourceSerializer', () => {
    const { jest: j } = require('@jest/globals');
    return { FhirResourceSerializer: { serialize: j.fn((json) => json) } };
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
const { DatabaseBulkInserter } = require('../../../../dataLayer/databaseBulkInserter');
const { ResourceMerger } = require('../../../../operations/common/resourceMerger');
const { ConfigManager } = require('../../../../utils/configManager');
const { DatabaseAttachmentManager } = require('../../../../dataLayer/databaseAttachmentManager');
const { Base64DataManager } = require('../../../../dataLayer/base64DataManager');
const { SearchManager } = require('../../../../operations/search/searchManager');
const { ParsedArgs } = require('../../../../operations/query/parsedArgs');
const { IdentifierEnrichmentProvider } = require('../../../../enrich/providers/identifierEnrichmentProvider');

function createMockInstance(ClassType) {
    return Object.create(ClassType.prototype);
}

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
            databaseBulkInserter: createMockInstance(DatabaseBulkInserter),
            resourceMerger: createMockInstance(ResourceMerger),
            configManager: createMockInstance(ConfigManager),
            databaseAttachmentManager: createMockInstance(DatabaseAttachmentManager),
            base64DataManager: createMockInstance(Base64DataManager),
            searchManager: createMockInstance(SearchManager),
            postSaveHandlerFactory: createMockInstance(
                require('../../../../dataLayer/postSaveHandlers/postSaveHandlerFactory').PostSaveHandlerFactory
            ),
            identifierEnrichmentProvider: createMockInstance(IdentifierEnrichmentProvider)
        };

        // Setup mocks
        mocks.scopesValidator.verifyHasValidScopesAsync = jest.fn().mockResolvedValue(undefined);
        mocks.scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes = jest.fn().mockResolvedValue(undefined);
        mocks.scopesValidator.isAccessTagChangeAllowedByAccessScopes = jest.fn();
        mocks.resourceValidator.validateResourceAsync = jest.fn().mockResolvedValue(null);
        mocks.resourceValidator.validateResourceMetaSync = jest.fn().mockReturnValue(null);
        mocks.searchManager.constructQueryAsync = jest.fn().mockResolvedValue({ query: { _sourceId: 'test-id' } });
        mocks.databaseQueryFactory.createQuery = jest.fn().mockReturnValue({
            findAsync: jest.fn().mockResolvedValue({
                toObjectArrayAsync: jest.fn().mockResolvedValue([])
            })
        });
        mocks.databaseBulkInserter.insertOneAsync = jest.fn().mockResolvedValue(undefined);
        mocks.databaseBulkInserter.replaceOneAsync = jest.fn().mockResolvedValue(undefined);
        mocks.databaseBulkInserter.executeAsync = jest.fn().mockResolvedValue([{
            created: true, updated: false, id: 'test-id', uuid: 'uuid-1',
            resourceType: 'Patient', sourceAssigningAuthority: 'bwell'
        }]);
        mocks.resourceMerger.mergeResourceAsync = jest.fn().mockResolvedValue({
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

        Object.defineProperty(mocks.configManager, 'useAccessIndex', { get: () => false });

        mockParsedArgs = createMockInstance(ParsedArgs);
        mockParsedArgs.base_version = '4_0_0';
        mockParsedArgs.id = 'test-id';
        mockParsedArgs._useAccessIndex = false;
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
                body: { id: 'test-id', resourceType: 'Patient', meta: { source: 'urn:test' } },
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
            expect(mocks.databaseBulkInserter.insertOneAsync).toHaveBeenCalled();
        });

        test('updates existing resource when found', async () => {
            const existingResource = {
                id: 'test-id',
                _uuid: 'uuid-1',
                _sourceAssigningAuthority: 'bwell',
                resourceType: 'Patient',
                meta: { versionId: '1', lastUpdated: new Date(), security: [], source: 'urn:test' },
                toJSON: () => ({}),
                toJSONInternal: () => ({}),
                clone: function() { return { ...this }; }
            };

            mocks.databaseQueryFactory.createQuery.mockReturnValue({
                findAsync: jest.fn().mockResolvedValue({
                    toObjectArrayAsync: jest.fn().mockResolvedValue([existingResource])
                })
            });
            mocks.resourceMerger.mergeResourceAsync.mockResolvedValue({
                updatedResource: {
                    ...existingResource,
                    meta: { ...existingResource.meta, versionId: '2' },
                    toJSON: () => ({}),
                    toJSONInternal: () => ({})
                },
                patches: [{ op: 'replace', path: '/name' }]
            });
            mocks.databaseBulkInserter.executeAsync.mockResolvedValue([{
                created: false, updated: true, id: 'test-id', uuid: 'uuid-1',
                resourceType: 'Patient', sourceAssigningAuthority: 'bwell'
            }]);

            const requestInfo = {
                user: 'admin',
                scope: 'user/*.write',
                path: '/Patient/test-id',
                body: { id: 'test-id', resourceType: 'Patient', name: [{ family: 'Smith' }] },
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
            expect(mocks.databaseBulkInserter.replaceOneAsync).toHaveBeenCalled();
        });

        test('throws BadRequestError when multiple resources found', async () => {
            const resources = [
                { id: 'test-id', _uuid: 'uuid-1', meta: { security: [{ system: 'https://www.icanbwell.com/sourceAssigningAuthority', code: 'src1' }] } },
                { id: 'test-id', _uuid: 'uuid-2', meta: { security: [{ system: 'https://www.icanbwell.com/sourceAssigningAuthority', code: 'src2' }] } }
            ];
            mocks.databaseQueryFactory.createQuery.mockReturnValue({
                findAsync: jest.fn().mockResolvedValue({
                    toObjectArrayAsync: jest.fn().mockResolvedValue(resources)
                })
            });

            const requestInfo = {
                user: 'admin',
                scope: 'user/*.write',
                path: '/Patient/test-id',
                body: { id: 'test-id', resourceType: 'Patient' },
                requestId: 'req-1',
                isUser: false,
                personIdFromJwtToken: null,
                headers: {}
            };

            await expect(
                updateOp.updateAsync({
                    requestInfo,
                    parsedArgs: mockParsedArgs,
                    resourceType: 'Patient'
                })
            ).rejects.toThrow(/Multiple resources found/);
        });

        test('throws PreconditionFailedError on If-Match version mismatch', async () => {
            const existingResource = {
                id: 'test-id',
                _uuid: 'uuid-1',
                resourceType: 'Patient',
                meta: { versionId: '2', lastUpdated: new Date(), security: [] },
                toJSON: () => ({}),
                toJSONInternal: () => ({})
            };
            mocks.databaseQueryFactory.createQuery.mockReturnValue({
                findAsync: jest.fn().mockResolvedValue({
                    toObjectArrayAsync: jest.fn().mockResolvedValue([existingResource])
                })
            });

            const requestInfo = {
                user: 'admin',
                scope: 'user/*.write',
                path: '/Patient/test-id',
                body: { id: 'test-id', resourceType: 'Patient' },
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
                meta: { versionId: '1', lastUpdated: new Date(), security: [], source: 'urn:test' },
                toJSON: () => ({}),
                toJSONInternal: () => ({})
            };
            mocks.databaseQueryFactory.createQuery.mockReturnValue({
                findAsync: jest.fn().mockResolvedValue({
                    toObjectArrayAsync: jest.fn().mockResolvedValue([existingResource])
                })
            });
            mocks.resourceMerger.mergeResourceAsync.mockResolvedValue({
                updatedResource: null,
                patches: []
            });

            const requestInfo = {
                user: 'admin',
                scope: 'user/*.write',
                path: '/Patient/test-id',
                body: { id: 'test-id', resourceType: 'Patient' },
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
            expect(mocks.databaseBulkInserter.replaceOneAsync).not.toHaveBeenCalled();
        });
    });
});
