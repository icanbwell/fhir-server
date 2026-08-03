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
                _uuid: json._uuid || 'gen-uuid',
                id: json.id,
                meta: json.meta || {},
                toJSON: () => json,
                toJSONInternal: () => json,
                clone: function() { return { ...this }; }
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

jest.mock('fast-json-patch', () => {
    const { jest: j } = require('@jest/globals');
    return { validate: j.fn(() => null) };
});

jest.mock('../../../../operations/patch/validators/patchInternalFieldsValidator', () => {
    const { jest: j } = require('@jest/globals');
    return { validatePatchDoesNotTargetInternalFields: j.fn() };
});

const { PatchOperation } = require('../../../../operations/patch/patch');
const { DatabaseQueryFactory } = require('../../../../dataLayer/databaseQueryFactory');
const { PostRequestProcessor } = require('../../../../utils/postRequestProcessor');
const { PreSaveManager } = require('../../../../preSaveHandlers/preSave');
const { FhirLoggingManager } = require('../../../../operations/common/fhirLoggingManager');
const { ScopesValidator } = require('../../../../operations/security/scopesValidator');
const { DatabaseBulkInserter } = require('../../../../dataLayer/databaseBulkInserter');
const { DatabaseAttachmentManager } = require('../../../../dataLayer/databaseAttachmentManager');
const { Base64DataManager } = require('../../../../dataLayer/base64DataManager');
const { ConfigManager } = require('../../../../utils/configManager');
const { SearchManager } = require('../../../../operations/search/searchManager');
const { ResourceMerger } = require('../../../../operations/common/resourceMerger');
const { ResourceValidator } = require('../../../../operations/common/resourceValidator');
const { ParsedArgs } = require('../../../../operations/query/parsedArgs');
const { IdentifierEnrichmentProvider } = require('../../../../enrich/providers/identifierEnrichmentProvider');
const { fhirContentTypes } = require('../../../../utils/contentTypes');

function createMockInstance(ClassType) {
    return Object.create(ClassType.prototype);
}

describe('PatchOperation', () => {
    let patchOp;
    let mocks;
    let mockParsedArgs;

    beforeEach(() => {
        mocks = {
            databaseQueryFactory: createMockInstance(DatabaseQueryFactory),
            postRequestProcessor: createMockInstance(PostRequestProcessor),
            preSaveManager: createMockInstance(PreSaveManager),
            fhirLoggingManager: createMockInstance(FhirLoggingManager),
            scopesValidator: createMockInstance(ScopesValidator),
            databaseBulkInserter: createMockInstance(DatabaseBulkInserter),
            databaseAttachmentManager: createMockInstance(DatabaseAttachmentManager),
            base64DataManager: createMockInstance(Base64DataManager),
            configManager: createMockInstance(ConfigManager),
            searchManager: createMockInstance(SearchManager),
            resourceMerger: createMockInstance(ResourceMerger),
            resourceValidator: createMockInstance(ResourceValidator),
            postSaveHandlerFactory: createMockInstance(
                require('../../../../dataLayer/postSaveHandlers/postSaveHandlerFactory').PostSaveHandlerFactory
            ),
            identifierEnrichmentProvider: createMockInstance(IdentifierEnrichmentProvider)
        };

        // Setup mocks
        mocks.scopesValidator.verifyHasValidScopesAsync = jest.fn().mockResolvedValue(undefined);
        mocks.scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes = jest.fn().mockResolvedValue(undefined);
        mocks.searchManager.constructQueryAsync = jest.fn().mockResolvedValue({ query: { _sourceId: 'obs-1' } });
        mocks.resourceValidator.validateResourceAsync = jest.fn().mockResolvedValue(null);
        mocks.resourceValidator.validateResourceMetaSync = jest.fn().mockReturnValue(null);

        const foundResource = {
            id: 'obs-1',
            _uuid: 'uuid-obs-1',
            _sourceAssigningAuthority: 'bwell',
            resourceType: 'Observation',
            status: 'final',
            meta: { versionId: '1', lastUpdated: new Date(), security: [], source: 'urn:test' },
            toJSON: () => ({ id: 'obs-1', resourceType: 'Observation', status: 'final', meta: { versionId: '1' } }),
            toJSONInternal: () => ({ id: 'obs-1', resourceType: 'Observation', status: 'final', meta: { versionId: '1' } }),
            clone: function() { return { ...this, toJSON: this.toJSON, toJSONInternal: this.toJSONInternal, clone: this.clone }; }
        };

        mocks.databaseQueryFactory.createQuery = jest.fn().mockReturnValue({
            findAsync: jest.fn().mockResolvedValue({
                toObjectArrayAsync: jest.fn().mockResolvedValue([foundResource])
            })
        });

        mocks.databaseAttachmentManager.transformAttachments = jest.fn((doc) => Promise.resolve(doc));
        mocks.base64DataManager.transformAsync = jest.fn((doc) => Promise.resolve(doc));
        mocks.preSaveManager.preSaveAsync = jest.fn(({ resource }) => Promise.resolve(resource));
        mocks.resourceMerger.applyPatch = jest.fn(({ currentResource }) => ({
            ...currentResource.toJSON(),
            status: 'amended'
        }));
        mocks.resourceMerger.overWriteNonWritableFields = jest.fn();
        mocks.resourceMerger.compareObjects = jest.fn().mockReturnValue([{ op: 'replace', path: '/status', value: 'amended' }]);
        mocks.resourceMerger.updateMeta = jest.fn();
        mocks.databaseBulkInserter.replaceOneAsync = jest.fn().mockResolvedValue(undefined);
        mocks.databaseBulkInserter.executeAsync = jest.fn().mockResolvedValue([{
            created: false, updated: true, id: 'obs-1', uuid: 'uuid-obs-1',
            resourceType: 'Observation', sourceAssigningAuthority: 'bwell'
        }]);
        mocks.fhirLoggingManager.logOperationSuccessAsync = jest.fn().mockResolvedValue(undefined);
        mocks.fhirLoggingManager.logOperationFailureAsync = jest.fn().mockResolvedValue(undefined);
        mocks.postRequestProcessor.add = jest.fn();
        mocks.postSaveHandlerFactory.getHandlers = jest.fn().mockReturnValue([]);
        mocks.identifierEnrichmentProvider.enrichIdentifierList = jest.fn();

        Object.defineProperty(mocks.configManager, 'useAccessIndex', { get: () => false });

        mockParsedArgs = createMockInstance(ParsedArgs);
        mockParsedArgs.base_version = '4_0_0';
        mockParsedArgs.id = 'obs-1';
        mockParsedArgs._useAccessIndex = false;
        mockParsedArgs.getRawArgs = jest.fn().mockReturnValue({});

        patchOp = new PatchOperation(mocks);
    });

    // ========== patchAsync (the single large method) ==========
    describe('patchAsync', () => {
        test('throws BadRequestError when Content-Type is not json-patch', async () => {
            const requestInfo = {
                requestId: 'req-1',
                body: [{ op: 'replace', path: '/status', value: 'amended' }],
                contentTypeFromHeader: { type: 'application/json' },
                user: 'admin',
                scope: 'user/*.write',
                isUser: false,
                personIdFromJwtToken: null,
                path: '/Observation/obs-1'
            };

            await expect(
                patchOp.patchAsync({
                    requestInfo,
                    parsedArgs: mockParsedArgs,
                    resourceType: 'Observation'
                })
            ).rejects.toThrow(/Content-Type/);
        });

        test('throws NotFoundError when resource not found', async () => {
            mocks.databaseQueryFactory.createQuery.mockReturnValue({
                findAsync: jest.fn().mockResolvedValue({
                    toObjectArrayAsync: jest.fn().mockResolvedValue([])
                })
            });

            const requestInfo = {
                requestId: 'req-1',
                body: [{ op: 'replace', path: '/status', value: 'amended' }],
                contentTypeFromHeader: { type: fhirContentTypes.jsonPatch },
                user: 'admin',
                scope: 'user/*.write',
                isUser: false,
                personIdFromJwtToken: null,
                path: '/Observation/obs-1'
            };

            await expect(
                patchOp.patchAsync({
                    requestInfo,
                    parsedArgs: mockParsedArgs,
                    resourceType: 'Observation'
                })
            ).rejects.toThrow(/not found/i);
        });

        test('applies patch and returns updated resource', async () => {
            const requestInfo = {
                requestId: 'req-1',
                body: [{ op: 'replace', path: '/status', value: 'amended' }],
                contentTypeFromHeader: { type: fhirContentTypes.jsonPatch },
                user: 'admin',
                scope: 'user/*.write',
                isUser: false,
                personIdFromJwtToken: null,
                path: '/Observation/obs-1'
            };

            const result = await patchOp.patchAsync({
                requestInfo,
                parsedArgs: mockParsedArgs,
                resourceType: 'Observation'
            });

            expect(result.updated).toBe(true);
            expect(result.created).toBe(false);
            expect(mocks.databaseBulkInserter.replaceOneAsync).toHaveBeenCalled();
        });

        test('throws BadRequestError when multiple resources found', async () => {
            mocks.databaseQueryFactory.createQuery.mockReturnValue({
                findAsync: jest.fn().mockResolvedValue({
                    toObjectArrayAsync: jest.fn().mockResolvedValue([
                        { id: 'obs-1', _uuid: 'u1', meta: { security: [{ system: 'https://www.icanbwell.com/sourceAssigningAuthority', code: 'a' }] } },
                        { id: 'obs-1', _uuid: 'u2', meta: { security: [{ system: 'https://www.icanbwell.com/sourceAssigningAuthority', code: 'b' }] } }
                    ])
                })
            });

            const requestInfo = {
                requestId: 'req-1',
                body: [{ op: 'replace', path: '/status', value: 'amended' }],
                contentTypeFromHeader: { type: fhirContentTypes.jsonPatch },
                user: 'admin',
                scope: 'user/*.write',
                isUser: false,
                personIdFromJwtToken: null,
                path: '/Observation/obs-1'
            };

            await expect(
                patchOp.patchAsync({
                    requestInfo,
                    parsedArgs: mockParsedArgs,
                    resourceType: 'Observation'
                })
            ).rejects.toThrow(/Multiple resources found/);
        });

        test('handles no-op when compareObjects returns empty array', async () => {
            mocks.resourceMerger.compareObjects.mockReturnValue([]);

            const requestInfo = {
                requestId: 'req-1',
                body: [{ op: 'replace', path: '/status', value: 'final' }],
                contentTypeFromHeader: { type: fhirContentTypes.jsonPatch },
                user: 'admin',
                scope: 'user/*.write',
                isUser: false,
                personIdFromJwtToken: null,
                path: '/Observation/obs-1'
            };

            const result = await patchOp.patchAsync({
                requestInfo,
                parsedArgs: mockParsedArgs,
                resourceType: 'Observation'
            });

            expect(mocks.databaseBulkInserter.replaceOneAsync).not.toHaveBeenCalled();
            expect(result.updated).toBe(true);
        });
    });
});
