const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

// Mock dependencies
jestObj.mock('../../../../utils/assertType', () => ({
    assertTypeEquals: jestObj.fn(),
    assertIsValid: jestObj.fn()
}));

jestObj.mock('../../../../converters/bundleToCsvConverter', () => ({
    BundleToCsvConverter: jestObj.fn().mockImplementation(() => ({
        convert: jestObj.fn().mockReturnValue(Buffer.from('fake-zip-data'))
    }))
}));

jestObj.mock('../../../../operations/common/logging', () => ({
    logError: jestObj.fn()
}));

jestObj.mock('../../../../utils/buffer_to_chunk_transfer_response', () => ({
    BufferToChunkTransferResponse: jestObj.fn().mockImplementation(() => ({
        sendLargeFileChunkedAsync: jestObj.fn().mockResolvedValue(undefined)
    }))
}));

jestObj.mock('../../../../utils/contentTypes', () => ({
    fhirContentTypes: {
        zip: 'application/zip'
    }
}));

const { CsvResponseHandler } = require('../../../../utils/responseHandler/csvResponseHandler');
const { BundleToCsvConverter } = require('../../../../converters/bundleToCsvConverter');
const { logError } = require('../../../../operations/common/logging');
const { BufferToChunkTransferResponse } = require('../../../../utils/buffer_to_chunk_transfer_response');

describe('CsvResponseHandler', () => {
    let handler;
    let mockResponse;

    beforeEach(() => {
        jestObj.clearAllMocks();

        mockResponse = {
            setHeader: jestObj.fn(),
            status: jestObj.fn().mockReturnThis(),
            end: jestObj.fn()
        };

        handler = new CsvResponseHandler({
            response: mockResponse,
            requestId: 'req-123'
        });
    });

    describe('sanitizeFilename', () => {
        test('should return string unchanged when no special characters', () => {
            expect(handler.sanitizeFilename('simple-name')).toBe('simple-name');
        });

        test('should replace double quotes with underscore', () => {
            expect(handler.sanitizeFilename('file"name')).toBe('file_name');
        });

        test('should replace carriage return with underscore', () => {
            expect(handler.sanitizeFilename('file\rname')).toBe('file_name');
        });

        test('should replace newline with underscore', () => {
            expect(handler.sanitizeFilename('file\nname')).toBe('file_name');
        });

        test('should replace null byte with underscore', () => {
            expect(handler.sanitizeFilename('file\x00name')).toBe('file_name');
        });

        test('should replace all control characters with underscore', () => {
            expect(handler.sanitizeFilename('a\x01b\x1fc')).toBe('a_b_c');
        });

        test('should handle numeric input by converting to string', () => {
            expect(handler.sanitizeFilename(12345)).toBe('12345');
        });

        test('should handle multiple special characters', () => {
            expect(handler.sanitizeFilename('a"b\nc\rd\x00e')).toBe('a_b_c_d_e');
        });
    });

    describe('sendResponseAsync', () => {
        test('should set correct headers for a bundle with entries', async () => {
            const bundle = {
                id: 'bundle-1',
                entry: [{ resource: { id: 'p1', resourceType: 'Patient' } }]
            };

            await handler.sendResponseAsync(bundle, 'hit');

            expect(mockResponse.setHeader).toHaveBeenCalledWith('Content-Type', 'application/zip');
            expect(mockResponse.setHeader).toHaveBeenCalledWith('X-Request-ID', 'req-123');
            expect(mockResponse.setHeader).toHaveBeenCalledWith(
                'Content-Disposition',
                'attachment; filename="bundle-1.zip"'
            );
            expect(mockResponse.setHeader).toHaveBeenCalledWith('Access-Control-Expose-Headers', 'Content-Disposition');
        });

        test('should use requestId for filename when bundle.id is missing', async () => {
            const bundle = {
                entry: [{ resource: { id: 'p1', resourceType: 'Patient' } }]
            };

            await handler.sendResponseAsync(bundle, 'miss');

            expect(mockResponse.setHeader).toHaveBeenCalledWith(
                'Content-Disposition',
                'attachment; filename="req-123.zip"'
            );
        });

        test('should call BundleToCsvConverter.convert with the bundle', async () => {
            const bundle = {
                id: 'bundle-1',
                entry: [{ resource: { id: 'p1', resourceType: 'Patient' } }]
            };

            await handler.sendResponseAsync(bundle, 'hit');

            const converterInstance = BundleToCsvConverter.mock.results[0].value;
            expect(converterInstance.convert).toHaveBeenCalledWith({ bundle });
        });

        test('should send buffer via BufferToChunkTransferResponse', async () => {
            const bundle = {
                id: 'bundle-1',
                entry: [{ resource: { id: 'p1', resourceType: 'Patient' } }]
            };

            await handler.sendResponseAsync(bundle, 'hit');

            const transferInstance = BufferToChunkTransferResponse.mock.results[0].value;
            expect(transferInstance.sendLargeFileChunkedAsync).toHaveBeenCalledWith({
                response: mockResponse,
                buffer: expect.any(Buffer),
                chunkSize: 64 * 1024
            });
        });

        test('should return 404 when bundle is undefined', async () => {
            await handler.sendResponseAsync(undefined, 'miss');

            expect(mockResponse.status).toHaveBeenCalledWith(404);
            expect(mockResponse.end).toHaveBeenCalled();
        });

        test('should return 404 when bundle has no entry', async () => {
            await handler.sendResponseAsync({ id: 'b1' }, 'miss');

            expect(mockResponse.status).toHaveBeenCalledWith(404);
            expect(mockResponse.end).toHaveBeenCalled();
        });

        test('should return 404 when bundle has empty entry array', async () => {
            await handler.sendResponseAsync({ id: 'b1', entry: [] }, 'miss');

            expect(mockResponse.status).toHaveBeenCalledWith(404);
            expect(mockResponse.end).toHaveBeenCalled();
        });

        test('should return 500 when converter throws an error', async () => {
            BundleToCsvConverter.mockImplementationOnce(() => ({
                convert: jestObj.fn(() => { throw new Error('Conversion failed'); })
            }));

            const bundle = {
                id: 'bundle-1',
                entry: [{ resource: { id: 'p1', resourceType: 'Patient' } }]
            };

            await handler.sendResponseAsync(bundle, 'hit');

            expect(mockResponse.status).toHaveBeenCalledWith(500);
            expect(mockResponse.end).toHaveBeenCalled();
            expect(logError).toHaveBeenCalled();
        });

        test('should return 500 when sendLargeFileChunkedAsync rejects', async () => {
            BufferToChunkTransferResponse.mockImplementationOnce(() => ({
                sendLargeFileChunkedAsync: jestObj.fn().mockRejectedValue(new Error('Transfer error'))
            }));

            const bundle = {
                id: 'bundle-1',
                entry: [{ resource: { id: 'p1', resourceType: 'Patient' } }]
            };

            await handler.sendResponseAsync(bundle, 'hit');

            expect(mockResponse.status).toHaveBeenCalledWith(500);
            expect(mockResponse.end).toHaveBeenCalled();
            expect(logError).toHaveBeenCalled();
        });

        test('should throw error when generated buffer is empty', async () => {
            BundleToCsvConverter.mockImplementationOnce(() => ({
                convert: jestObj.fn().mockReturnValue(Buffer.alloc(0))
            }));

            const bundle = {
                id: 'bundle-1',
                entry: [{ resource: { id: 'p1', resourceType: 'Patient' } }]
            };

            await handler.sendResponseAsync(bundle, 'hit');

            expect(mockResponse.status).toHaveBeenCalledWith(500);
            expect(mockResponse.end).toHaveBeenCalled();
            expect(logError).toHaveBeenCalledWith(
                'Error generating FHIR CSV export:',
                expect.any(Error)
            );
        });

        test('should sanitize filename to prevent header injection', async () => {
            const bundle = {
                id: 'evil\r\nHeader-Injection: true',
                entry: [{ resource: { id: 'p1', resourceType: 'Patient' } }]
            };

            await handler.sendResponseAsync(bundle, 'hit');

            expect(mockResponse.setHeader).toHaveBeenCalledWith(
                'Content-Disposition',
                'attachment; filename="evil__Header-Injection: true.zip"'
            );
        });
    });
});
