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

jest.mock('../../../../fhir/fhirResourceSerializer', () => {
    const { jest: j } = require('@jest/globals');
    return {
        FhirResourceSerializer: {
            serialize: j.fn((json) => ({ ...json, _serialized: true }))
        }
    };
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

const { CreateOperation } = require('../../../../operations/create/create');
const { AuditLogger } = require('../../../../utils/auditLogger');
const { PostRequestProcessor } = require('../../../../utils/postRequestProcessor');
const { FhirLoggingManager } = require('../../../../operations/common/fhirLoggingManager');
const { ScopesValidator } = require('../../../../operations/security/scopesValidator');
const { ResourceValidator } = require('../../../../operations/common/resourceValidator');
const { FastDatabaseBulkInserter } = require('../../../../dataLayer/fastDatabaseBulkInserter');
const { ConfigManager } = require('../../../../utils/configManager');
const { DatabaseAttachmentManager } = require('../../../../dataLayer/databaseAttachmentManager');
const { Base64DataManager } = require('../../../../dataLayer/base64DataManager');
const { ParsedArgs } = require('../../../../operations/query/parsedArgs');
const { IdentifierEnrichmentProvider } = require('../../../../enrich/providers/identifierEnrichmentProvider');
const BaseSerializer = require('../../../../fhir/writeSerializers/4_0_0/customSerializers/baseSerializer');

BaseSerializer.setConfigManager({ preSaveCodingIdUpdateResources: [] });

function createMockInstance(ClassType) {
    return Object.create(ClassType.prototype);
}

const validMeta = () => ({
    source: 'client',
    security: [
        { system: 'https://www.icanbwell.com/access', code: 'client' },
        { system: 'https://www.icanbwell.com/owner', code: 'client' }
    ]
});

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
            fastDatabaseBulkInserter: createMockInstance(FastDatabaseBulkInserter),
            configManager: createMockInstance(ConfigManager),
            databaseAttachmentManager: createMockInstance(DatabaseAttachmentManager),
            base64DataManager: createMockInstance(Base64DataManager),
            identifierEnrichmentProvider: createMockInstance(IdentifierEnrichmentProvider)
        };

        mocks.scopesValidator.verifyHasValidScopesAsync = jest.fn().mockResolvedValue(undefined);
        mocks.scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes = jest.fn().mockResolvedValue(undefined);
        mocks.scopesValidator.isAccessTagChangeAllowedByAccessScopes = jest.fn();
        mocks.resourceValidator.validateResourceAsync = jest.fn().mockResolvedValue(null);
        mocks.resourceValidator.validateResourceMetaSync = jest.fn().mockReturnValue(null);
        mocks.resourceValidator.validateResourceSizeSync = jest.fn().mockReturnValue(null);
        mocks.fastDatabaseBulkInserter.insertOneAsync = jest.fn().mockResolvedValue(undefined);
        mocks.fastDatabaseBulkInserter.executeAsync = jest.fn().mockResolvedValue([{
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

        test.each([
            ['null', null],
            ['undefined', undefined]
        ])('BUG: crashes with TypeError when body is %s', async (_label, body) => {
            const requestInfo = {
                user: 'admin',
                body,
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

        test('BUG: crashes with TypeError when resource has no meta property', async () => {
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
            const requestInfo = {
                user: 'admin',
                body: { resourceType: 'Patient', meta: validMeta() },
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
            expect(mocks.fastDatabaseBulkInserter.insertOneAsync).toHaveBeenCalled();
            expect(mocks.fastDatabaseBulkInserter.executeAsync).toHaveBeenCalled();
        });

        test('strips a client-supplied _file_id and _uuid before validation and transformAttachments', async () => {
            const requestInfo = {
                user: 'admin',
                body: {
                    resourceType: 'Patient',
                    meta: validMeta(),
                    _uuid: 'client-supplied-uuid',
                    photo: [{ _file_id: 'attacker-chosen-gridfs-id', contentType: 'image/png' }]
                },
                requestId: 'r1'
            };

            let payloadAtValidation;
            mocks.resourceValidator.validateResourceAsync = jest.fn(async ({ resourceToValidate }) => {
                payloadAtValidation = JSON.parse(JSON.stringify(resourceToValidate));
                return null;
            });

            await createOp.createAsync({
                requestInfo,
                parsedArgs: mockParsedArgs,
                path: '/Patient',
                resourceType: 'Patient'
            });

            expect(payloadAtValidation._uuid).toBeUndefined();
            expect(payloadAtValidation.photo[0]._file_id).toBeUndefined();

            const resourcePassedToAttachmentManager = mocks.databaseAttachmentManager.transformAttachments.mock.calls[0][0];
            expect(resourcePassedToAttachmentManager.photo[0]._file_id).toBeUndefined();
        });

        test('throws BadRequestError when mergeResults is empty', async () => {
            mocks.fastDatabaseBulkInserter.executeAsync.mockResolvedValue([]);

            const requestInfo = {
                user: 'admin',
                body: { resourceType: 'Patient', meta: validMeta() },
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

        test.each([
            ['does not add audit log for AuditEvent resources', 'AuditEvent', false],
            ['adds audit log for non-AuditEvent resources', 'Patient', true]
        ])('%s', async (_label, resourceType, expectAuditLog) => {
            const requestInfo = {
                user: 'admin',
                body: { resourceType, meta: validMeta() },
                requestId: 'r1'
            };

            await createOp.createAsync({
                requestInfo,
                parsedArgs: mockParsedArgs,
                path: `/${resourceType}`,
                resourceType
            });

            expect(mocks.postRequestProcessor.add).toHaveBeenCalledTimes(expectAuditLog ? 1 : 0);
        });
    });
});
