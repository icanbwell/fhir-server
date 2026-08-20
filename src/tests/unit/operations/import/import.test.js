const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

jest.mock('../../../../operations/common/logging', () => {
    const { jest: j } = require('@jest/globals');
    return {
        logInfo: j.fn(),
        logError: j.fn(),
        logDebug: j.fn()
    };
});

const { ImportOperation } = require('../../../../operations/import/import');
const { ScopesManager } = require('../../../../operations/security/scopesManager');
const { FhirLoggingManager } = require('../../../../operations/common/fhirLoggingManager');
const { PostRequestProcessor } = require('../../../../utils/postRequestProcessor');
const { AuditLogger } = require('../../../../utils/auditLogger');
const { ConfigManager } = require('../../../../utils/configManager');
const { SecurityTagManager } = require('../../../../operations/common/securityTagManager');
const { DatabaseUpdateFactory } = require('../../../../dataLayer/databaseUpdateFactory');
const { DatabaseQueryFactory } = require('../../../../dataLayer/databaseQueryFactory');
const { PostSaveProcessor } = require('../../../../dataLayer/postSaveProcessor');
const { KafkaClientV2 } = require('../../../../utils/kafkaClientV2');

function createMockInstance(ClassType) {
    return Object.create(ClassType.prototype);
}

describe('ImportOperation - null safety and error handling', () => {
    let importOp;
    let mocks;

    beforeEach(() => {
        mocks = {
            scopesManager: createMockInstance(ScopesManager),
            fhirLoggingManager: createMockInstance(FhirLoggingManager),
            postRequestProcessor: createMockInstance(PostRequestProcessor),
            auditLogger: createMockInstance(AuditLogger),
            configManager: createMockInstance(ConfigManager),
            securityTagManager: createMockInstance(SecurityTagManager),
            databaseUpdateFactory: createMockInstance(DatabaseUpdateFactory),
            databaseQueryFactory: createMockInstance(DatabaseQueryFactory),
            postSaveProcessor: createMockInstance(PostSaveProcessor),
            kafkaClientV2: createMockInstance(KafkaClientV2)
        };

        // ConfigManager uses getters
        Object.defineProperty(mocks.configManager, 'bulkImportMaxFilesPerRequest', {
            get: () => 100,
            configurable: true
        });
        Object.defineProperty(mocks.configManager, 'bulkImportAllowedS3Buckets', {
            get: () => ['my-bucket'],
            configurable: true
        });
        Object.defineProperty(mocks.configManager, 'kafkaV2EnableEvents', {
            get: () => false,
            configurable: true
        });
        Object.defineProperty(mocks.configManager, 'kafkaBulkImportTaskCreatedTopic', {
            get: () => 'test-topic',
            configurable: true
        });

        mocks.scopesManager.hasPatientScope = jest.fn().mockReturnValue(false);
        mocks.fhirLoggingManager.logOperationSuccessAsync = jest.fn().mockResolvedValue(undefined);
        mocks.fhirLoggingManager.logOperationFailureAsync = jest.fn().mockResolvedValue(undefined);
        mocks.postRequestProcessor.add = jest.fn();
        mocks.securityTagManager.getSecurityTagsFromScope = jest.fn().mockReturnValue(['bwell']);
        mocks.postSaveProcessor.afterSaveAsync = jest.fn().mockResolvedValue(undefined);

        importOp = new ImportOperation(mocks);
    });

    // ========== parseParametersResource ==========
    describe('parseParametersResource - null/invalid body', () => {
        test('throws BadRequestError when body is null', () => {
            expect(() => importOp.parseParametersResource(null)).toThrow(/must be a FHIR Parameters resource/);
        });

        test('throws BadRequestError when body is undefined', () => {
            expect(() => importOp.parseParametersResource(undefined)).toThrow(/must be a FHIR Parameters resource/);
        });

        test('throws BadRequestError when resourceType is not Parameters', () => {
            expect(() => importOp.parseParametersResource({
                resourceType: 'Patient',
                parameter: []
            })).toThrow(/must be a FHIR Parameters resource/);
        });

        test('throws BadRequestError when parameter is not an array', () => {
            expect(() => importOp.parseParametersResource({
                resourceType: 'Parameters',
                parameter: 'not-an-array'
            })).toThrow(/must be a FHIR Parameters resource/);
        });

        test('throws BadRequestError when id is empty string', () => {
            expect(() => importOp.parseParametersResource({
                resourceType: 'Parameters',
                id: '   ',
                parameter: [{ name: 'input', valueUri: 's3://bucket/key' }]
            })).toThrow(/Parameters.id is required/);
        });

        test('throws BadRequestError when id is null', () => {
            expect(() => importOp.parseParametersResource({
                resourceType: 'Parameters',
                id: null,
                parameter: [{ name: 'input', valueUri: 's3://bucket/key' }]
            })).toThrow(/Parameters.id is required/);
        });

        test('throws BadRequestError when no input parameters exist', () => {
            expect(() => importOp.parseParametersResource({
                resourceType: 'Parameters',
                id: 'job-1',
                parameter: [{ name: 'other', valueUri: 's3://bucket/key' }]
            })).toThrow(/At least one input parameter/);
        });

        test('throws BadRequestError when input parameter has no valueUri', () => {
            expect(() => importOp.parseParametersResource({
                resourceType: 'Parameters',
                id: 'job-1',
                parameter: [{ name: 'input' }] // no valueUri
            })).toThrow(/must have a valueUri/);
        });

        test('throws BadRequestError when too many input files', () => {
            Object.defineProperty(mocks.configManager, 'bulkImportMaxFilesPerRequest', {
                get: () => 2,
                configurable: true
            });
            // Re-create importOp to pick up the new getter
            importOp = new ImportOperation(mocks);

            const params = {
                resourceType: 'Parameters',
                id: 'job-1',
                parameter: [
                    { name: 'input', valueUri: 's3://my-bucket/file1.ndjson' },
                    { name: 'input', valueUri: 's3://my-bucket/file2.ndjson' },
                    { name: 'input', valueUri: 's3://my-bucket/file3.ndjson' }
                ]
            };
            expect(() => importOp.parseParametersResource(params)).toThrow(/Too many input files/);
        });

        test('successfully parses valid Parameters resource', () => {
            const result = importOp.parseParametersResource({
                resourceType: 'Parameters',
                id: 'job-1',
                parameter: [
                    { name: 'input', valueUri: 's3://my-bucket/file1.ndjson' }
                ]
            });
            expect(result.id).toBe('job-1');
            expect(result.inputs).toHaveLength(1);
            expect(result.inputs[0].url).toBe('s3://my-bucket/file1.ndjson');
        });
    });

    // ========== validateS3Inputs ==========
    describe('validateS3Inputs - bucket allow-list and URI validation', () => {
        test('throws when allowedBuckets is empty (fail-closed)', () => {
            Object.defineProperty(mocks.configManager, 'bulkImportAllowedS3Buckets', {
                get: () => [],
                configurable: true
            });
            importOp = new ImportOperation(mocks);

            expect(() => importOp.validateS3Inputs([
                { url: 's3://any-bucket/file.ndjson' }
            ])).toThrow(/bucket allow-list is not configured/);
        });

        test('throws for invalid S3 URI format', () => {
            expect(() => importOp.validateS3Inputs([
                { url: 'https://my-bucket.s3.amazonaws.com/file.ndjson' }
            ])).toThrow(/Invalid S3 URI/);
        });

        test('throws for s3 URI without key', () => {
            expect(() => importOp.validateS3Inputs([
                { url: 's3://my-bucket/' }
            ])).toThrow(/Invalid S3 URI/);
        });

        test('throws for bucket not in allow-list', () => {
            expect(() => importOp.validateS3Inputs([
                { url: 's3://unauthorized-bucket/file.ndjson' }
            ])).toThrow(/not in the allowed bucket list/);
        });

        test('passes for valid bucket in allow-list', () => {
            expect(() => importOp.validateS3Inputs([
                { url: 's3://my-bucket/path/to/file.ndjson' }
            ])).not.toThrow();
        });
    });

    // ========== importAsync - scope validation ==========
    describe('importAsync - patient scope rejection', () => {
        test('throws ForbiddenError when patient scope is present', async () => {
            mocks.scopesManager.hasPatientScope.mockReturnValue(true);

            const requestInfo = {
                requestId: 'req-1',
                scope: 'patient/Patient.read',
                user: 'patient-user'
            };

            await expect(
                importOp.importAsync({
                    requestInfo,
                    args: {
                        base_version: '4_0_0',
                        resource: {
                            resourceType: 'Parameters',
                            id: 'job-1',
                            parameter: [{ name: 'input', valueUri: 's3://my-bucket/file.ndjson' }]
                        }
                    }
                })
            ).rejects.toThrow(/patient scopes/);

            expect(mocks.fhirLoggingManager.logOperationFailureAsync).toHaveBeenCalled();
        });
    });

    // ========== importAsync - null requestInfo ==========
    describe('importAsync - missing requestInfo fields', () => {
        test('throws assertion error when requestId is null', async () => {
            const requestInfo = {
                requestId: null,
                scope: 'user/*.*',
                user: 'admin'
            };

            await expect(
                importOp.importAsync({
                    requestInfo,
                    args: {
                        base_version: '4_0_0',
                        resource: {
                            resourceType: 'Parameters',
                            id: 'job-1',
                            parameter: [{ name: 'input', valueUri: 's3://my-bucket/file.ndjson' }]
                        }
                    }
                })
            ).rejects.toThrow(/requestId is null/);
        });
    });

    // ========== markTaskFailedAsync - task not found ==========
    describe('markTaskFailedAsync - task not found', () => {
        test('returns gracefully when task does not exist', async () => {
            const mockDatabaseQueryManager = {
                findOneAsync: jest.fn().mockResolvedValue(null)
            };
            mocks.databaseQueryFactory.createQuery = jest.fn().mockReturnValue(mockDatabaseQueryManager);

            // Should not throw
            await expect(
                importOp.markTaskFailedAsync('nonexistent-task', 'some reason')
            ).resolves.toBeUndefined();
        });
    });

    // ========== importAsync - Kafka failure after Task creation ==========
    describe('importAsync - Kafka publish failure after Task commit', () => {
        test('marks task as failed when Kafka publish throws', async () => {
            Object.defineProperty(mocks.configManager, 'kafkaV2EnableEvents', {
                get: () => true,
                configurable: true
            });
            importOp = new ImportOperation(mocks);

            const mockDatabaseQueryManager = {
                findOneAsync: jest.fn().mockResolvedValue(null)
            };
            const mockDatabaseUpdateManager = {
                insertOneAsync: jest.fn().mockResolvedValue(undefined),
                updateOneAsync: jest.fn().mockResolvedValue(undefined)
            };
            mocks.databaseQueryFactory.createQuery = jest.fn().mockReturnValue(mockDatabaseQueryManager);
            mocks.databaseUpdateFactory.createDatabaseUpdateManager = jest.fn().mockReturnValue(mockDatabaseUpdateManager);
            mocks.kafkaClientV2.sendCloudEventMessageAsync = jest.fn().mockRejectedValue(
                new Error('Kafka connection timeout')
            );

            const requestInfo = {
                requestId: 'req-1',
                scope: 'user/*.*',
                user: 'admin'
            };

            await expect(
                importOp.importAsync({
                    requestInfo,
                    args: {
                        base_version: '4_0_0',
                        resource: {
                            resourceType: 'Parameters',
                            id: 'job-kafka-fail',
                            parameter: [{ name: 'input', valueUri: 's3://my-bucket/file.ndjson' }]
                        }
                    }
                })
            ).rejects.toThrow('Kafka connection timeout');

            // markTaskFailedAsync should have been called
            // The second createQuery call is for markTaskFailedAsync
            expect(mocks.databaseQueryFactory.createQuery).toHaveBeenCalledTimes(2);
        });
    });

    // ========== importAsync - TaskCreated event carries requester identity (BAI-432) ==========
    describe('importAsync - TaskCreated event identity fields', () => {
        test('publishes alternateUserId/isUser/remoteIpAddress from requestInfo on the TaskCreated event', async () => {
            Object.defineProperty(mocks.configManager, 'kafkaV2EnableEvents', {
                get: () => true,
                configurable: true
            });
            importOp = new ImportOperation(mocks);

            const mockDatabaseQueryManager = {
                findOneAsync: jest.fn().mockResolvedValue(null)
            };
            const mockDatabaseUpdateManager = {
                insertOneAsync: jest.fn().mockResolvedValue(undefined),
                updateOneAsync: jest.fn().mockResolvedValue(undefined)
            };
            mocks.databaseQueryFactory.createQuery = jest.fn().mockReturnValue(mockDatabaseQueryManager);
            mocks.databaseUpdateFactory.createDatabaseUpdateManager = jest.fn().mockReturnValue(mockDatabaseUpdateManager);
            mocks.kafkaClientV2.sendCloudEventMessageAsync = jest.fn().mockResolvedValue(undefined);

            const requestInfo = {
                requestId: 'req-1',
                scope: 'user/*.*',
                user: 'admin',
                alternateUserId: 'admin-alt-id',
                isUser: true,
                remoteIpAddress: '203.0.113.5'
            };

            await importOp.importAsync({
                requestInfo,
                args: {
                    base_version: '4_0_0',
                    resource: {
                        resourceType: 'Parameters',
                        id: 'job-identity',
                        parameter: [{ name: 'input', valueUri: 's3://my-bucket/file.ndjson' }]
                    }
                }
            });

            expect(mocks.kafkaClientV2.sendCloudEventMessageAsync).toHaveBeenCalledTimes(1);
            const publishedMessage = mocks.kafkaClientV2.sendCloudEventMessageAsync.mock.calls[0][0].messages[0];
            const publishedEvent = JSON.parse(publishedMessage.value);
            expect(publishedEvent.data.alternateUserId).toBe('admin-alt-id');
            expect(publishedEvent.data.isUser).toBe(true);
            expect(publishedEvent.data.remoteIpAddress).toBe('203.0.113.5');
        });
    });
});
