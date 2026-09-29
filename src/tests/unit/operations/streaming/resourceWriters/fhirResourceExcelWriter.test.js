const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

// Mock dependencies
jestObj.mock('../../../../../utils/assertType', () => ({
    assertTypeEquals: jestObj.fn(),
    assertIsValid: jestObj.fn()
}));

jestObj.mock('../../../../../operations/common/sentry', () => ({
    captureException: jestObj.fn()
}));

jestObj.mock('../../../../../fhir/fhirResourceSerializer', () => ({
    FhirResourceSerializer: {
        serialize: jestObj.fn((obj) => obj)
    }
}));

jestObj.mock('../../../../../operations/common/logging', () => ({
    logInfo: jestObj.fn(),
    logError: jestObj.fn()
}));

jestObj.mock('../../../../../utils/convertErrorToOperationOutcome', () => ({
    convertErrorToOperationOutcome: jestObj.fn(({ error }) => ({
        toJSON: () => ({ resourceType: 'OperationOutcome', issue: [{ severity: 'error', diagnostics: error.message }] })
    }))
}));

jestObj.mock('../../../../../converters/bundleToExcelConverter', () => ({
    BundleToExcelConverter: jestObj.fn().mockImplementation(() => ({
        convertResources: jestObj.fn().mockReturnValue(Buffer.from('fake-excel-data'))
    }))
}));

jestObj.mock('../../../../../utils/uid.util', () => ({
    generateUUID: jestObj.fn().mockReturnValue('generated-uuid-123')
}));

jestObj.mock('../../../../../utils/buffer_to_chunk_transfer_response', () => ({
    BufferToChunkTransferResponse: jestObj.fn().mockImplementation(() => ({
        sendLargeFileChunkedAsync: jestObj.fn().mockResolvedValue(undefined)
    }))
}));

const { FhirResourceExcelWriter } = require('../../../../../operations/streaming/resourceWriters/fhirResourceExcelWriter');
const { ConfigManager } = require('../../../../../utils/configManager');
const { FhirResourceSerializer } = require('../../../../../fhir/fhirResourceSerializer');
const { captureException } = require('../../../../../operations/common/sentry');
const { logError } = require('../../../../../operations/common/logging');
const { BundleToExcelConverter } = require('../../../../../converters/bundleToExcelConverter');
const { BufferToChunkTransferResponse } = require('../../../../../utils/buffer_to_chunk_transfer_response');

function createMockInstance(ClassRef, methods = {}) {
    const instance = Object.create(ClassRef.prototype);
    Object.assign(instance, methods);
    return instance;
}

describe('FhirResourceExcelWriter', () => {
    let writer;
    let mockConfigManager;
    let mockResponse;
    let mockSignal;

    beforeEach(() => {
        jestObj.clearAllMocks();

        mockConfigManager = createMockInstance(ConfigManager, {});
        Object.defineProperty(mockConfigManager, 'logStreamSteps', {
            get: () => false,
            configurable: true
        });

        mockResponse = {
            statusCode: 200,
            setHeader: jestObj.fn(),
            end: jestObj.fn(),
            req: { id: 'test-request-id-123' }
        };

        mockSignal = { aborted: false };

        writer = new FhirResourceExcelWriter({
            signal: mockSignal,
            contentType: 'application/vnd.ms-excel',
            highWaterMark: 100,
            configManager: mockConfigManager,
            response: mockResponse
        });
    });

    describe('constructor', () => {
        test('should initialize with correct properties', () => {
            expect(writer._signal).toBe(mockSignal);
            expect(writer.configManager).toBe(mockConfigManager);
            expect(writer.json_resources).toEqual([]);
            expect(writer.requestId).toBe('test-request-id-123');
        });

        test('should set contentType via base class', () => {
            expect(writer.getContentType()).toBe('application/vnd.ms-excel');
        });
    });

    describe('_transform', () => {
        test('should accumulate resources in json_resources array', (done) => {
            const chunk = { id: 'patient-1', resourceType: 'Patient' };

            writer._transform(chunk, 'utf8', () => {
                expect(writer.json_resources).toHaveLength(1);
                expect(writer.json_resources[0]).toBe(chunk);
                done();
            });
        });

        test('should call FhirResourceSerializer.serialize on the chunk', (done) => {
            const chunk = { id: 'patient-1', resourceType: 'Patient' };

            writer._transform(chunk, 'utf8', () => {
                expect(FhirResourceSerializer.serialize).toHaveBeenCalledWith(chunk);
                done();
            });
        });

        test('should do nothing when signal is aborted', (done) => {
            mockSignal.aborted = true;
            const chunk = { id: 'patient-1', resourceType: 'Patient' };

            writer._transform(chunk, 'utf8', () => {
                expect(writer.json_resources).toHaveLength(0);
                expect(FhirResourceSerializer.serialize).not.toHaveBeenCalled();
                done();
            });
        });

        test('should skip null chunks', (done) => {
            writer._transform(null, 'utf8', () => {
                expect(writer.json_resources).toHaveLength(0);
                done();
            });
        });

        test('should skip undefined chunks', (done) => {
            writer._transform(undefined, 'utf8', () => {
                expect(writer.json_resources).toHaveLength(0);
                done();
            });
        });

        test('should accumulate multiple resources', (done) => {
            const chunk1 = { id: 'p1', resourceType: 'Patient' };
            const chunk2 = { id: 'p2', resourceType: 'Patient' };

            writer._transform(chunk1, 'utf8', () => {
                writer._transform(chunk2, 'utf8', () => {
                    expect(writer.json_resources).toHaveLength(2);
                    expect(writer.json_resources[0]).toBe(chunk1);
                    expect(writer.json_resources[1]).toBe(chunk2);
                    done();
                });
            });
        });

        test('should catch serialization errors and log them', (done) => {
            FhirResourceSerializer.serialize.mockImplementationOnce(() => {
                throw new Error('Serialization failed');
            });

            const chunk = { id: 'patient-1', resourceType: 'Patient' };
            writer.push = jestObj.fn();

            writer._transform(chunk, 'utf8', (err) => {
                expect(err).toBeUndefined();
                expect(logError).toHaveBeenCalled();
                expect(captureException).toHaveBeenCalled();
                done();
            });
        });

        test('should not add chunk to json_resources when serialization throws', (done) => {
            FhirResourceSerializer.serialize.mockImplementationOnce(() => {
                throw new Error('Serialization failed');
            });

            const chunk = { id: 'patient-1', resourceType: 'Patient' };
            writer.push = jestObj.fn();

            writer._transform(chunk, 'utf8', () => {
                // The chunk was NOT added to json_resources because the error was thrown
                // before the push to json_resources
                expect(writer.json_resources).toHaveLength(0);
                done();
            });
        });

        test('should set response statusCode to 500 on error via writeOperationOutcome', (done) => {
            FhirResourceSerializer.serialize.mockImplementationOnce(() => {
                throw new Error('Serialization failed');
            });

            const chunk = { id: 'patient-1', resourceType: 'Patient' };
            writer.push = jestObj.fn();

            writer._transform(chunk, 'utf8', () => {
                expect(mockResponse.statusCode).toBe(500);
                done();
            });
        });

        test('should log info when logStreamSteps is enabled', (done) => {
            Object.defineProperty(mockConfigManager, 'logStreamSteps', {
                get: () => true,
                configurable: true
            });

            const { logInfo } = require('../../../../../operations/common/logging');
            const chunk = { id: 'patient-1', resourceType: 'Patient' };

            writer._transform(chunk, 'utf8', () => {
                expect(logInfo).toHaveBeenCalledWith(
                    expect.stringContaining('FhirResourceExcelWriter: _transform patient-1'),
                    expect.anything()
                );
                done();
            });
        });
    });

    describe('_flush', () => {
        test('should set content-type and content-disposition headers when resources exist', (done) => {
            writer.json_resources = [{ id: 'p1', resourceType: 'Patient' }];

            writer._flush(() => {
                expect(mockResponse.setHeader).toHaveBeenCalledWith('Content-Type', 'application/vnd.ms-excel');
                expect(mockResponse.setHeader).toHaveBeenCalledWith('X-Request-ID', 'test-request-id-123');
                expect(mockResponse.setHeader).toHaveBeenCalledWith(
                    'Content-Disposition',
                    'attachment; filename="test-request-id-123.xlsx"'
                );
                expect(mockResponse.setHeader).toHaveBeenCalledWith('Access-Control-Expose-Headers', 'Content-Disposition');
                done();
            });
        });

        test('should call BundleToExcelConverter.convertResources with accumulated resources', (done) => {
            const resources = [
                { id: 'p1', resourceType: 'Patient' },
                { id: 'p2', resourceType: 'Patient' }
            ];
            writer.json_resources = resources;

            writer._flush(() => {
                const converterInstance = BundleToExcelConverter.mock.results[0].value;
                expect(converterInstance.convertResources).toHaveBeenCalledWith({ resources });
                done();
            });
        });

        test('should send buffer via BufferToChunkTransferResponse', (done) => {
            writer.json_resources = [{ id: 'p1', resourceType: 'Patient' }];

            writer._flush(() => {
                const transferInstance = BufferToChunkTransferResponse.mock.results[0].value;
                expect(transferInstance.sendLargeFileChunkedAsync).toHaveBeenCalledWith({
                    response: mockResponse,
                    buffer: expect.any(Buffer),
                    chunkSize: 64 * 1024
                });
                done();
            });
        });

        test('should set status 204 when no resources were accumulated', (done) => {
            writer.json_resources = [];

            writer._flush(() => {
                expect(mockResponse.statusCode).toBe(204);
                expect(mockResponse.setHeader).toHaveBeenCalledWith('Content-Type', 'application/vnd.ms-excel');
                expect(mockResponse.setHeader).toHaveBeenCalledWith('X-Request-ID', 'test-request-id-123');
                done();
            });
        });

        test('should use generateUUID for filename when requestId is falsy', (done) => {
            writer.requestId = null;
            writer.json_resources = [{ id: 'p1', resourceType: 'Patient' }];

            writer._flush(() => {
                expect(mockResponse.setHeader).toHaveBeenCalledWith(
                    'Content-Disposition',
                    'attachment; filename="generated-uuid-123.xlsx"'
                );
                done();
            });
        });

        test('should handle sendLargeFileChunkedAsync failure', (done) => {
            const mockError = new Error('Transfer failed');
            BufferToChunkTransferResponse.mockImplementationOnce(() => ({
                sendLargeFileChunkedAsync: jestObj.fn().mockRejectedValue(mockError)
            }));

            writer.json_resources = [{ id: 'p1', resourceType: 'Patient' }];

            writer._flush((err) => {
                expect(err).toBe(mockError);
                expect(mockResponse.statusCode).toBe(500);
                expect(mockResponse.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json');
                expect(mockResponse.end).toHaveBeenCalledWith(
                    expect.stringContaining('Failed to send file')
                );
                done();
            });
        });

        test('should log when logStreamSteps is enabled during flush', (done) => {
            Object.defineProperty(mockConfigManager, 'logStreamSteps', {
                get: () => true,
                configurable: true
            });
            const { logInfo } = require('../../../../../operations/common/logging');
            writer.json_resources = [];

            writer._flush(() => {
                expect(logInfo).toHaveBeenCalledWith('FhirResourceExcelWriter: _flush', {});
                done();
            });
        });
    });

    describe('writeOperationOutcome', () => {
        test('should set statusCode to 500 and push JSON', () => {
            writer.push = jestObj.fn();
            const operationOutcome = {
                toJSON: () => ({ resourceType: 'OperationOutcome', issue: [] })
            };

            writer.writeOperationOutcome({ operationOutcome, encoding: 'utf8' });

            expect(mockResponse.statusCode).toBe(500);
            expect(writer.push).toHaveBeenCalledWith(
                expect.stringContaining('OperationOutcome'),
                'utf8'
            );
        });

        test('should append newline to the pushed output', () => {
            writer.push = jestObj.fn();
            const operationOutcome = {
                toJSON: () => ({ resourceType: 'OperationOutcome' })
            };

            writer.writeOperationOutcome({ operationOutcome });

            const pushArg = writer.push.mock.calls[0][0];
            expect(pushArg).toMatch(/\n$/);
        });
    });

    describe('getContentType', () => {
        test('should return the content type passed in constructor', () => {
            expect(writer.getContentType()).toBe('application/vnd.ms-excel');
        });
    });
});
