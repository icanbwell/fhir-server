/**
 * Unit tests for bulkDataExport.js
 *
 * This script orchestrates bulk data export by parsing CLI args,
 * setting up a container, registering BulkDataExportRunner, and calling processAsync.
 *
 * Covers:
 * - Correct parameter extraction from command line
 * - Error handling when exportStatusId is missing
 * - Container registration with correct dependencies
 * - Process exits on success and failure
 * - Default values for optional parameters
 */
const { describe, test, expect, beforeEach, afterEach, jest: jestObj } = require('@jest/globals');

// Mock BulkDataExportRunner
const mockProcessAsync = jestObj.fn().mockResolvedValue(undefined);
const MockBulkDataExportRunner = jestObj.fn().mockImplementation((args) => ({
    processAsync: mockProcessAsync,
    _args: args
}));

jestObj.mock('../../../../operations/export/script/bulkDataExportRunner', () => ({
    BulkDataExportRunner: MockBulkDataExportRunner
}));

// Mock S3Client
const MockS3Client = jestObj.fn().mockImplementation((args) => ({
    _args: args
}));
jestObj.mock('../../../../utils/s3Client', () => ({
    S3Client: MockS3Client
}));

// Mock createContainer
const mockContainer = {
    databaseQueryFactory: { id: 'databaseQueryFactory' },
    databaseExportManager: { id: 'databaseExportManager' },
    patientFilterManager: { id: 'patientFilterManager' },
    databaseAttachmentManager: { id: 'databaseAttachmentManager' },
    base64DataManager: { id: 'base64DataManager' },
    r4SearchQueryCreator: { id: 'r4SearchQueryCreator' },
    patientQueryCreator: { id: 'patientQueryCreator' },
    enrichmentManager: { id: 'enrichmentManager' },
    resourceLocatorFactory: { id: 'resourceLocatorFactory' },
    r4ArgsParser: { id: 'r4ArgsParser' },
    searchManager: { id: 'searchManager' },
    postSaveProcessor: { id: 'postSaveProcessor' },
    bulkExportEventProducer: { id: 'bulkExportEventProducer' },
    register: jestObj.fn(),
    bulkDataExportRunner: null
};

// Track registrations
mockContainer.register = jestObj.fn().mockImplementation((name, factory) => {
    mockContainer[name] = factory(mockContainer);
});

jestObj.mock('../../../../createContainer', () => ({
    createContainer: jestObj.fn(() => mockContainer)
}));

// Mock CommandLineParser
let mockParsedParams = {};
jestObj.mock('../../../../admin/scripts/commandLineParser', () => ({
    CommandLineParser: {
        parseCommandLine: jestObj.fn(() => mockParsedParams)
    }
}));

// Mock logging
jestObj.mock('../../../../operations/common/logging', () => ({
    logInfo: jestObj.fn(),
    logError: jestObj.fn()
}));

const { logInfo, logError } = require('../../../../operations/common/logging');

describe('bulkDataExport script', () => {
    let processExitSpy;

    beforeEach(() => {
        jestObj.clearAllMocks();

        // Re-establish mock implementations after clearAllMocks
        mockProcessAsync.mockResolvedValue(undefined);
        MockBulkDataExportRunner.mockImplementation((args) => ({
            processAsync: mockProcessAsync,
            _args: args
        }));
        MockS3Client.mockImplementation((args) => ({ _args: args }));
        mockContainer.register.mockImplementation((name, factory) => {
            mockContainer[name] = factory(mockContainer);
        });

        // Don't throw on process.exit - just record the call
        processExitSpy = jestObj.spyOn(process, 'exit').mockImplementation(() => {});

        mockParsedParams = {
            exportStatusId: 'test-export-id-123',
            patientReferenceBatchSize: 100,
            fetchResourceBatchSize: 2000,
            uploadPartSize: 50,
            bulkExportS3BucketName: 'my-bucket',
            awsRegion: 'us-west-2',
            requestId: 'req-abc-123'
        };
    });

    afterEach(() => {
        processExitSpy.mockRestore();
    });

    async function runMain() {
        jestObj.isolateModules(() => {
            require('../../../../operations/export/script/bulkDataExport');
        });

        // Allow async operations to complete
        for (let i = 0; i < 10; i++) {
            await new Promise(resolve => setImmediate(resolve));
        }
    }

    describe('successful execution', () => {
        test('parses exportStatusId from command line and passes to runner', async () => {
            await runMain();

            expect(MockBulkDataExportRunner).toHaveBeenCalledWith(
                expect.objectContaining({
                    exportStatusId: 'test-export-id-123'
                })
            );
        });

        test('passes patientReferenceBatchSize from command line', async () => {
            await runMain();

            expect(MockBulkDataExportRunner).toHaveBeenCalledWith(
                expect.objectContaining({
                    patientReferenceBatchSize: 100
                })
            );
        });

        test('passes fetchResourceBatchSize from command line', async () => {
            await runMain();

            expect(MockBulkDataExportRunner).toHaveBeenCalledWith(
                expect.objectContaining({
                    fetchResourceBatchSize: 2000
                })
            );
        });

        test('converts uploadPartSize to bytes (MB)', async () => {
            await runMain();

            // 50 * 1024 * 1024 = 52428800
            expect(MockBulkDataExportRunner).toHaveBeenCalledWith(
                expect.objectContaining({
                    uploadPartSize: 50 * 1024 * 1024
                })
            );
        });

        test('creates S3Client with bucket name and region', async () => {
            await runMain();

            expect(MockS3Client).toHaveBeenCalledWith({
                bucketName: 'my-bucket',
                region: 'us-west-2'
            });
        });

        test('passes requestId to runner', async () => {
            await runMain();

            expect(MockBulkDataExportRunner).toHaveBeenCalledWith(
                expect.objectContaining({
                    requestId: 'req-abc-123'
                })
            );
        });

        test('calls processAsync on the runner', async () => {
            await runMain();

            expect(mockProcessAsync).toHaveBeenCalled();
        });

        test('exits with code 0 on success', async () => {
            await runMain();

            expect(processExitSpy).toHaveBeenCalledWith(0);
        });

        test('logs startup message with exportStatusId', async () => {
            await runMain();

            expect(logInfo).toHaveBeenCalledWith(
                expect.stringContaining('Running Bulk data export script'),
                { exportStatusId: 'test-export-id-123' }
            );
        });

        test('registers bulkDataExportRunner in the container', async () => {
            await runMain();

            expect(mockContainer.register).toHaveBeenCalledWith(
                'bulkDataExportRunner',
                expect.any(Function)
            );
        });
    });

    describe('default parameter values', () => {
        test('defaults patientReferenceBatchSize to BULK_BUFFER_SIZE env var', async () => {
            mockParsedParams.patientReferenceBatchSize = undefined;
            process.env.BULK_BUFFER_SIZE = '75';

            await runMain();

            expect(MockBulkDataExportRunner).toHaveBeenCalledWith(
                expect.objectContaining({
                    patientReferenceBatchSize: '75'
                })
            );

            delete process.env.BULK_BUFFER_SIZE;
        });

        test('defaults patientReferenceBatchSize to 50 when no env var', async () => {
            mockParsedParams.patientReferenceBatchSize = undefined;
            delete process.env.BULK_BUFFER_SIZE;

            await runMain();

            expect(MockBulkDataExportRunner).toHaveBeenCalledWith(
                expect.objectContaining({
                    patientReferenceBatchSize: 50
                })
            );
        });

        test('defaults fetchResourceBatchSize to 1000', async () => {
            mockParsedParams.fetchResourceBatchSize = undefined;

            await runMain();

            expect(MockBulkDataExportRunner).toHaveBeenCalledWith(
                expect.objectContaining({
                    fetchResourceBatchSize: 1000
                })
            );
        });

        test('defaults uploadPartSize to 100MB when not specified', async () => {
            mockParsedParams.uploadPartSize = undefined;

            await runMain();

            expect(MockBulkDataExportRunner).toHaveBeenCalledWith(
                expect.objectContaining({
                    uploadPartSize: 1024 * 1024 * 100
                })
            );
        });
    });

    describe('error handling', () => {
        test('exits with code 1 when exportStatusId is empty string', async () => {
            mockParsedParams.exportStatusId = '';

            await runMain();

            expect(processExitSpy).toHaveBeenCalledWith(1);
            expect(logError).toHaveBeenCalled();
        });

        test('exits with code 1 when processAsync throws', async () => {
            mockProcessAsync.mockRejectedValue(new Error('Export failed'));

            await runMain();

            expect(processExitSpy).toHaveBeenCalledWith(1);
            expect(logError).toHaveBeenCalled();
        });
    });

    describe('container dependencies', () => {
        test('passes all required container dependencies to BulkDataExportRunner', async () => {
            await runMain();

            const constructorCall = MockBulkDataExportRunner.mock.calls[0][0];
            expect(constructorCall.databaseQueryFactory).toEqual({ id: 'databaseQueryFactory' });
            expect(constructorCall.databaseExportManager).toEqual({ id: 'databaseExportManager' });
            expect(constructorCall.patientFilterManager).toEqual({ id: 'patientFilterManager' });
            expect(constructorCall.databaseAttachmentManager).toEqual({ id: 'databaseAttachmentManager' });
            expect(constructorCall.base64DataManager).toEqual({ id: 'base64DataManager' });
            expect(constructorCall.r4SearchQueryCreator).toEqual({ id: 'r4SearchQueryCreator' });
            expect(constructorCall.patientQueryCreator).toEqual({ id: 'patientQueryCreator' });
            expect(constructorCall.enrichmentManager).toEqual({ id: 'enrichmentManager' });
            expect(constructorCall.resourceLocatorFactory).toEqual({ id: 'resourceLocatorFactory' });
            expect(constructorCall.r4ArgsParser).toEqual({ id: 'r4ArgsParser' });
            expect(constructorCall.searchManager).toEqual({ id: 'searchManager' });
            expect(constructorCall.postSaveProcessor).toEqual({ id: 'postSaveProcessor' });
            expect(constructorCall.bulkExportEventProducer).toEqual({ id: 'bulkExportEventProducer' });
        });
    });
});
