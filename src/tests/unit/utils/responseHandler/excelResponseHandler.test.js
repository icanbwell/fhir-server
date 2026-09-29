const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

// Mock dependencies
jestObj.mock('../../../../utils/assertType', () => ({
    assertTypeEquals: jestObj.fn(),
    assertIsValid: jestObj.fn()
}));

jestObj.mock('../../../../converters/bundleToExcelConverter', () => ({
    BundleToExcelConverter: jestObj.fn().mockImplementation(() => ({
        convert: jestObj.fn().mockReturnValue(Buffer.from('fake-excel-data'))
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
        excel: 'application/vnd.ms-excel'
    }
}));

const { ExcelResponseHandler } = require('../../../../utils/responseHandler/excelResponseHandler');
const { BundleToExcelConverter } = require('../../../../converters/bundleToExcelConverter');
const { logError } = require('../../../../operations/common/logging');
const { BufferToChunkTransferResponse } = require('../../../../utils/buffer_to_chunk_transfer_response');

describe('ExcelResponseHandler', () => {
    let handler;
    let mockResponse;

    beforeEach(() => {
        jestObj.clearAllMocks();

        mockResponse = {
            setHeader: jestObj.fn(),
            status: jestObj.fn().mockReturnThis(),
            end: jestObj.fn()
        };

        handler = new ExcelResponseHandler({
            response: mockResponse,
            requestId: 'req-456'
        });
    });

    describe('sanitizeFilename', () => {
        test('should return string unchanged when no special characters', () => {
            expect(handler.sanitizeFilename('normal-file')).toBe('normal-file');
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

        test('should replace all control characters (0x01-0x1f) with underscore', () => {
            expect(handler.sanitizeFilename('\x01\x02\x1e\x1f')).toBe('____');
        });

        test('should convert non-string input to string', () => {
            expect(handler.sanitizeFilename(99999)).toBe('99999');
        });
    });

    describe('sendResponseAsync', () => {
        test('should set correct headers for a bundle with entries', async () => {
            const bundle = {
                id: 'bundle-excel-1',
                entry: [{ resource: { id: 'obs1', resourceType: 'Observation' } }]
            };

            await handler.sendResponseAsync(bundle, 'hit');

            expect(mockResponse.setHeader).toHaveBeenCalledWith('Content-Type', 'application/vnd.ms-excel');
            expect(mockResponse.setHeader).toHaveBeenCalledWith('X-Request-ID', 'req-456');
            expect(mockResponse.setHeader).toHaveBeenCalledWith(
                'Content-Disposition',
                'attachment; filename="bundle-excel-1.xlsx"'
            );
            expect(mockResponse.setHeader).toHaveBeenCalledWith('Access-Control-Expose-Headers', 'Content-Disposition');
        });

        test('should use requestId for filename when bundle.id is missing', async () => {
            const bundle = {
                entry: [{ resource: { id: 'obs1', resourceType: 'Observation' } }]
            };

            await handler.sendResponseAsync(bundle, 'miss');

            expect(mockResponse.setHeader).toHaveBeenCalledWith(
                'Content-Disposition',
                'attachment; filename="req-456.xlsx"'
            );
        });

        test('should call BundleToExcelConverter.convert with the bundle', async () => {
            const bundle = {
                id: 'bundle-1',
                entry: [{ resource: { id: 'obs1', resourceType: 'Observation' } }]
            };

            await handler.sendResponseAsync(bundle, 'hit');

            const converterInstance = BundleToExcelConverter.mock.results[0].value;
            expect(converterInstance.convert).toHaveBeenCalledWith({ bundle });
        });

        test('should send buffer via BufferToChunkTransferResponse with 64KB chunk size', async () => {
            const bundle = {
                id: 'bundle-1',
                entry: [{ resource: { id: 'obs1', resourceType: 'Observation' } }]
            };

            await handler.sendResponseAsync(bundle, 'hit');

            const transferInstance = BufferToChunkTransferResponse.mock.results[0].value;
            expect(transferInstance.sendLargeFileChunkedAsync).toHaveBeenCalledWith({
                response: mockResponse,
                buffer: expect.any(Buffer),
                chunkSize: 64 * 1024
            });
        });

        test('should return 404 when bundle is null', async () => {
            await handler.sendResponseAsync(null, 'miss');

            expect(mockResponse.status).toHaveBeenCalledWith(404);
            expect(mockResponse.end).toHaveBeenCalled();
        });

        test('should return 404 when bundle is undefined', async () => {
            await handler.sendResponseAsync(undefined, 'miss');

            expect(mockResponse.status).toHaveBeenCalledWith(404);
            expect(mockResponse.end).toHaveBeenCalled();
        });

        test('should return 404 when bundle.entry is not an array', async () => {
            await handler.sendResponseAsync({ id: 'b1', entry: 'not-array' }, 'miss');

            expect(mockResponse.status).toHaveBeenCalledWith(404);
            expect(mockResponse.end).toHaveBeenCalled();
        });

        test('should return 404 when bundle.entry is empty array', async () => {
            await handler.sendResponseAsync({ id: 'b1', entry: [] }, 'miss');

            expect(mockResponse.status).toHaveBeenCalledWith(404);
            expect(mockResponse.end).toHaveBeenCalled();
        });

        test('should return 404 when bundle has no entry property', async () => {
            await handler.sendResponseAsync({ id: 'b1' }, 'miss');

            expect(mockResponse.status).toHaveBeenCalledWith(404);
            expect(mockResponse.end).toHaveBeenCalled();
        });

        test('should return 500 when converter throws an error', async () => {
            BundleToExcelConverter.mockImplementationOnce(() => ({
                convert: jestObj.fn(() => { throw new Error('Excel conversion failed'); })
            }));

            const bundle = {
                id: 'bundle-1',
                entry: [{ resource: { id: 'obs1', resourceType: 'Observation' } }]
            };

            await handler.sendResponseAsync(bundle, 'hit');

            expect(mockResponse.status).toHaveBeenCalledWith(500);
            expect(mockResponse.end).toHaveBeenCalled();
            expect(logError).toHaveBeenCalledWith(
                'Error generating FHIR Excel export:',
                expect.any(Error)
            );
        });

        test('should return 500 when sendLargeFileChunkedAsync rejects', async () => {
            BufferToChunkTransferResponse.mockImplementationOnce(() => ({
                sendLargeFileChunkedAsync: jestObj.fn().mockRejectedValue(new Error('Network error'))
            }));

            const bundle = {
                id: 'bundle-1',
                entry: [{ resource: { id: 'obs1', resourceType: 'Observation' } }]
            };

            await handler.sendResponseAsync(bundle, 'hit');

            expect(mockResponse.status).toHaveBeenCalledWith(500);
            expect(mockResponse.end).toHaveBeenCalled();
            expect(logError).toHaveBeenCalled();
        });

        test('should throw error when generated Excel buffer is empty', async () => {
            BundleToExcelConverter.mockImplementationOnce(() => ({
                convert: jestObj.fn().mockReturnValue(Buffer.alloc(0))
            }));

            const bundle = {
                id: 'bundle-1',
                entry: [{ resource: { id: 'obs1', resourceType: 'Observation' } }]
            };

            await handler.sendResponseAsync(bundle, 'hit');

            expect(mockResponse.status).toHaveBeenCalledWith(500);
            expect(mockResponse.end).toHaveBeenCalled();
            expect(logError).toHaveBeenCalledWith(
                'Error generating FHIR Excel export:',
                expect.objectContaining({ message: 'Generated Excel buffer is empty' })
            );
        });

        test('should sanitize filename containing header injection characters', async () => {
            const bundle = {
                id: 'malicious\r\nX-Injected: true',
                entry: [{ resource: { id: 'obs1', resourceType: 'Observation' } }]
            };

            await handler.sendResponseAsync(bundle, 'hit');

            expect(mockResponse.setHeader).toHaveBeenCalledWith(
                'Content-Disposition',
                'attachment; filename="malicious__X-Injected: true.xlsx"'
            );
        });

        test('should sanitize filename containing quotes', async () => {
            const bundle = {
                id: 'file"with"quotes',
                entry: [{ resource: { id: 'obs1', resourceType: 'Observation' } }]
            };

            await handler.sendResponseAsync(bundle, 'hit');

            expect(mockResponse.setHeader).toHaveBeenCalledWith(
                'Content-Disposition',
                'attachment; filename="file_with_quotes.xlsx"'
            );
        });
    });
});
