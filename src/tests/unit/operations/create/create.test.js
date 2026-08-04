const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

jest.mock('express-http-context', () => {
    const { jest: j } = require('@jest/globals');
    return { get: j.fn(), set: j.fn() };
});

jest.mock('../../../../operations/common/logging', () => {
    const { jest: j } = require('@jest/globals');
    return { logInfo: j.fn(), logError: j.fn(), logDebug: j.fn() };
});

jest.mock('../../../../utils/uid.util', () => {
    const { jest: j } = require('@jest/globals');
    return { generateUUID: j.fn(() => 'generated-uuid-123') };
});

jest.mock('../../../../fhir/fhirResourceCreator', () => {
    const { jest: j } = require('@jest/globals');
    return {
        FhirResourceCreator: {
            createByResourceType: j.fn((json, resourceType) => ({
                ...json,
                resourceType,
                _uuid: json._uuid || `uuid-${json.id}`,
                _sourceAssigningAuthority: 'test',
                meta: json.meta || undefined,
                toJSON: () => json,
                toJSONInternal: () => json,
                clone: () => ({ ...json })
            }))
        }
    };
});

jest.mock('../../../../fhir/fhirResourceSerializer', () => {
    const { jest: j } = require('@jest/globals');
    return {
        FhirResourceSerializer: {
            serialize: j.fn((json) => ({ ...json, _serialized: true }))
        }
    };
});

jest.mock('../../../../utils/contextDataBuilder', () => {
    const { jest: j } = require('@jest/globals');
    return { buildContextDataForHybridStorage: j.fn(() => null) };
});

const { CreateOperation } = require('../../../../operations/create/create');
const { AuditLogger } = require('../../../../utils/auditLogger');
const { PostRequestProcessor } = require('../../../../utils/postRequestProcessor');
const { FhirLoggingManager } = require('../../../../operations/common/fhirLoggingManager');
const { ScopesValidator } = require('../../../../operations/security/scopesValidator');
const { ResourceValidator } = require('../../../../operations/common/resourceValidator');
const { DatabaseBulkInserter } = require('../../../../dataLayer/databaseBulkInserter');
const { ConfigManager } = require('../../../../utils/configManager');
const { DatabaseAttachmentManager } = require('../../../../dataLayer/databaseAttachmentManager');
const { Base64DataManager } = require('../../../../dataLayer/base64DataManager');
const { ParsedArgs } = require('../../../../operations/query/parsedArgs');
const { IdentifierEnrichmentProvider } = require('../../../../enrich/providers/identifierEnrichmentProvider');

function createMockInstance(ClassType) {
    return Object.create(ClassType.prototype);
}

describe('CreateOperation', () => {
    let createOp;
    let mocks;
    let mockParsedArgs;

    beforeEach(() => {
        mocks = {
            auditLogger: createMockInstance(AuditLogger),
            postRequestProcessor: createMockInstance(PostRequestProcessor),
            fhirLoggingManager: createMockInstance(FhirLoggingManager),
            scopesValidator: createMockInstance(ScopesValidator),
            resourceValidator: createMockInstance(ResourceValidator),
            databaseBulkInserter: createMockInstance(DatabaseBulkInserter),
            configManager: createMockInstance(ConfigManager),
            databaseAttachmentManager: createMockInstance(DatabaseAttachmentManager),
            base64DataManager: createMockInstance(Base64DataManager),
            identifierEnrichmentProvider: createMockInstance(IdentifierEnrichmentProvider)
        };

        // Setup default mocks
        mocks.scopesValidator.verifyHasValidScopesAsync = jest.fn().mockResolvedValue(undefined);
        mocks.scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes = jest.fn().mockResolvedValue(undefined);
        mocks.resourceValidator.validateResourceAsync = jest.fn().mockResolvedValue(null);
        mocks.resourceValidator.validateResourceMetaSync = jest.fn().mockReturnValue(null);
        mocks.resourceValidator.validateResourceSizeSync = jest.fn().mockReturnValue(null);
        mocks.databaseBulkInserter.insertOneAsync = jest.fn().mockResolvedValue(undefined);
        mocks.databaseBulkInserter.executeAsync = jest.fn().mockResolvedValue([{
            created: true, updated: false, id: 'generated-uuid-123', uuid: 'generated-uuid-123',
            resourceType: 'Patient', sourceAssigningAuthority: 'test'
        }]);
        mocks.databaseAttachmentManager.transformAttachments = jest.fn((doc) => Promise.resolve(doc));
        mocks.base64DataManager.transformAsync = jest.fn((doc) => Promise.resolve(doc));
        mocks.fhirLoggingManager.logOperationSuccessAsync = jest.fn().mockResolvedValue(undefined);
        mocks.fhirLoggingManager.logOperationFailureAsync = jest.fn().mockResolvedValue(undefined);
        mocks.postRequestProcessor.add = jest.fn();
        mocks.auditLogger.logAuditEntryAsync = jest.fn().mockResolvedValue(undefined);
        mocks.identifierEnrichmentProvider.enrichIdentifierList = jest.fn();

        mockParsedArgs = createMockInstance(ParsedArgs);
        mockParsedArgs.base_version = '4_0_0';
        mockParsedArgs.getRawArgs = jest.fn().mockReturnValue({});

        createOp = new CreateOperation(mocks);
    });

    describe('createAsync', () => {
        test('throws when requestInfo is undefined', async () => {
            await expect(
                createOp.createAsync({
                    requestInfo: undefined,
                    parsedArgs: mockParsedArgs,
                    path: '/Patient',
                    resourceType: 'Patient'
                })
            ).rejects.toThrow();
        });

        test('throws when resourceType is undefined', async () => {
            await expect(
                createOp.createAsync({
                    requestInfo: { user: 'admin', body: {}, requestId: 'r1' },
                    parsedArgs: mockParsedArgs,
                    path: '/Patient',
                    resourceType: undefined
                })
            ).rejects.toThrow();
        });

        test('throws BadRequestError when body is an array', async () => {
            const requestInfo = {
                user: 'admin',
                body: [{ resourceType: 'Patient' }],
                requestId: 'r1'
            };

            await expect(
                createOp.createAsync({
                    requestInfo,
                    parsedArgs: mockParsedArgs,
                    path: '/Patient',
                    resourceType: 'Patient'
                })
            ).rejects.toThrow(/Only single resource can be sent to create/);
        });

        /**
         * BUG: When body is null/undefined, line 160 attempts resource_incoming.id = generateUUID()
         * which throws TypeError: Cannot set properties of null/undefined.
         * The code only guards against arrays (line 149) but not null/undefined body.
         */
        test('BUG: crashes with TypeError when body is null', async () => {
            const requestInfo = {
                user: 'admin',
                body: null,
                requestId: 'r1'
            };

            // This should ideally throw a BadRequestError, but instead throws TypeError
            await expect(
                createOp.createAsync({
                    requestInfo,
                    parsedArgs: mockParsedArgs,
                    path: '/Patient',
                    resourceType: 'Patient'
                })
            ).rejects.toThrow(TypeError);
        });

        /**
         * BUG: When body is undefined, line 160 attempts resource_incoming.id = generateUUID()
         * which throws TypeError.
         */
        test('BUG: crashes with TypeError when body is undefined', async () => {
            const requestInfo = {
                user: 'admin',
                body: undefined,
                requestId: 'r1'
            };

            await expect(
                createOp.createAsync({
                    requestInfo,
                    parsedArgs: mockParsedArgs,
                    path: '/Patient',
                    resourceType: 'Patient'
                })
            ).rejects.toThrow(TypeError);
        });

        /**
         * BUG: When FhirResourceCreator returns a resource with no meta property,
         * line 220 (resource.meta.versionId = '1') throws TypeError.
         */
        test('BUG: crashes with TypeError when resource has no meta property', async () => {
            const { FhirResourceCreator } = require('../../../../fhir/fhirResourceCreator');
            FhirResourceCreator.createByResourceType.mockImplementation((json, resourceType) => ({
                ...json,
                resourceType,
                id: json.id,
                _uuid: `uuid-${json.id}`,
                _sourceAssigningAuthority: 'test',
                // meta is intentionally missing/undefined
                meta: undefined,
                toJSON: () => json,
                toJSONInternal: () => json
            }));

            const requestInfo = {
                user: 'admin',
                body: { resourceType: 'Patient', name: [{ family: 'Test' }] },
                requestId: 'r1'
            };

            await expect(
                createOp.createAsync({
                    requestInfo,
                    parsedArgs: mockParsedArgs,
                    path: '/Patient',
                    resourceType: 'Patient'
                })
            ).rejects.toThrow(TypeError);
        });

        test('successfully creates a resource with valid input', async () => {
            const { FhirResourceCreator } = require('../../../../fhir/fhirResourceCreator');
            FhirResourceCreator.createByResourceType.mockImplementation((json, resourceType) => ({
                ...json,
                resourceType,
                id: json.id,
                _uuid: `uuid-${json.id}`,
                _sourceAssigningAuthority: 'test',
                meta: json.meta || { security: [] },
                toJSON: () => json,
                toJSONInternal: () => json
            }));

            const requestInfo = {
                user: 'admin',
                body: { resourceType: 'Patient', meta: { security: [] } },
                requestId: 'r1'
            };

            const result = await createOp.createAsync({
                requestInfo,
                parsedArgs: mockParsedArgs,
                path: '/Patient',
                resourceType: 'Patient'
            });

            expect(result).toBeDefined();
            expect(result._serialized).toBe(true);
            expect(mocks.databaseBulkInserter.insertOneAsync).toHaveBeenCalled();
            expect(mocks.databaseBulkInserter.executeAsync).toHaveBeenCalled();
        });

        // DCON-4806: a client-supplied _file_id (or any other internal underscore field,
        // e.g. _uuid) must be stripped from the raw payload before the Resource is even
        // constructed, so it never reaches DatabaseAttachmentManager.transformAttachments --
        // which would otherwise persist a client-supplied _file_id verbatim (no data was
        // actually uploaded) and later serve back whatever GridFS content that id happens
        // to point to.
        test('strips a client-supplied _file_id before Resource construction and transformAttachments', async () => {
            const { FhirResourceCreator } = require('../../../../fhir/fhirResourceCreator');
            FhirResourceCreator.createByResourceType.mockImplementation((json, resourceType) => ({
                ...json,
                resourceType,
                id: json.id,
                _uuid: `uuid-${json.id}`,
                _sourceAssigningAuthority: 'test',
                meta: json.meta || { security: [] },
                toJSON: () => json,
                toJSONInternal: () => json
            }));

            const requestInfo = {
                user: 'admin',
                body: {
                    resourceType: 'Patient',
                    meta: { security: [] },
                    _uuid: 'client-supplied-uuid',
                    photo: [{ _file_id: 'attacker-chosen-gridfs-id', contentType: 'image/png' }]
                },
                requestId: 'r1'
            };

            // createByResourceType is a module-level mock shared across all tests in this
            // file (jest.unit.config.js has no clearMocks) -- clear its call history so
            // mock.calls[0] below reflects only this test's invocation.
            FhirResourceCreator.createByResourceType.mockClear();

            await createOp.createAsync({
                requestInfo,
                parsedArgs: mockParsedArgs,
                path: '/Patient',
                resourceType: 'Patient'
            });

            // the raw payload handed to FhirResourceCreator must already be stripped
            const jsonPassedToResourceCreator = FhirResourceCreator.createByResourceType.mock.calls[0][0];
            expect(jsonPassedToResourceCreator._uuid).toBeUndefined();
            expect(jsonPassedToResourceCreator.photo[0]._file_id).toBeUndefined();

            const resourcePassedToAttachmentManager = mocks.databaseAttachmentManager.transformAttachments.mock.calls[0][0];
            expect(resourcePassedToAttachmentManager.photo[0]._file_id).toBeUndefined();
        });

        test('throws BadRequestError when mergeResults is empty', async () => {
            const { FhirResourceCreator } = require('../../../../fhir/fhirResourceCreator');
            FhirResourceCreator.createByResourceType.mockImplementation((json, resourceType) => ({
                ...json,
                resourceType,
                id: json.id,
                _uuid: `uuid-${json.id}`,
                _sourceAssigningAuthority: 'test',
                meta: json.meta || { security: [] },
                toJSON: () => json,
                toJSONInternal: () => json
            }));

            mocks.databaseBulkInserter.executeAsync.mockResolvedValue([]);

            const requestInfo = {
                user: 'admin',
                body: { resourceType: 'Patient', meta: { security: [] } },
                requestId: 'r1'
            };

            await expect(
                createOp.createAsync({
                    requestInfo,
                    parsedArgs: mockParsedArgs,
                    path: '/Patient',
                    resourceType: 'Patient'
                })
            ).rejects.toThrow(/No merge result/);
        });

        test('does not add audit log for AuditEvent resources', async () => {
            const { FhirResourceCreator } = require('../../../../fhir/fhirResourceCreator');
            FhirResourceCreator.createByResourceType.mockImplementation((json, resourceType) => ({
                ...json,
                resourceType,
                id: json.id,
                _uuid: `uuid-${json.id}`,
                _sourceAssigningAuthority: 'test',
                meta: json.meta || { security: [] },
                toJSON: () => json,
                toJSONInternal: () => json
            }));

            const requestInfo = {
                user: 'admin',
                body: { resourceType: 'AuditEvent', meta: { security: [] } },
                requestId: 'r1'
            };

            await createOp.createAsync({
                requestInfo,
                parsedArgs: mockParsedArgs,
                path: '/AuditEvent',
                resourceType: 'AuditEvent'
            });

            expect(mocks.postRequestProcessor.add).not.toHaveBeenCalled();
        });

        test('adds audit log for non-AuditEvent resources', async () => {
            const { FhirResourceCreator } = require('../../../../fhir/fhirResourceCreator');
            FhirResourceCreator.createByResourceType.mockImplementation((json, resourceType) => ({
                ...json,
                resourceType,
                id: json.id,
                _uuid: `uuid-${json.id}`,
                _sourceAssigningAuthority: 'test',
                meta: json.meta || { security: [] },
                toJSON: () => json,
                toJSONInternal: () => json
            }));

            const requestInfo = {
                user: 'admin',
                body: { resourceType: 'Patient', meta: { security: [] } },
                requestId: 'r1'
            };

            await createOp.createAsync({
                requestInfo,
                parsedArgs: mockParsedArgs,
                path: '/Patient',
                resourceType: 'Patient'
            });

            expect(mocks.postRequestProcessor.add).toHaveBeenCalled();
        });
    });
});
