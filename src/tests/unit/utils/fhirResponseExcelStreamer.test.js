'use strict';

const { describe, test, expect, jest: jestObj, beforeEach } = require('@jest/globals');

// Mock dependencies
jestObj.mock('../../../utils/assertType', () => ({
    assertIsValid: jestObj.fn((val) => {
        if (!val) throw new Error('assertIsValid failed');
    }),
    assertTypeEquals: jestObj.fn()
}));

jestObj.mock('../../../utils/contentTypes', () => ({
    fhirContentTypes: {
        excel: 'application/vnd.ms-excel'
    }
}));

jestObj.mock('../../../converters/bundleToExcelConverter', () => ({
    BundleToExcelConverter: jestObj.fn().mockImplementation(() => ({
        convert: jestObj.fn().mockReturnValue(Buffer.from('fake-excel-data'))
    }))
}));

jestObj.mock('../../../utils/buffer_to_chunk_transfer_response', () => ({
    BufferToChunkTransferResponse: jestObj.fn().mockImplementation(() => ({
        sendLargeFileChunkedAsync: jestObj.fn().mockResolvedValue(undefined)
    }))
}));

const { FhirResponseExcelStreamer } = require('../../../utils/fhirResponseExcelStreamer');
const { BundleToExcelConverter } = require('../../../converters/bundleToExcelConverter');
const { BufferToChunkTransferResponse } = require('../../../utils/buffer_to_chunk_transfer_response');

describe('FhirResponseExcelStreamer', () => {
    let mockResponse;
    let streamer;

    beforeEach(() => {
        jestObj.clearAllMocks();

        mockResponse = {
            setHeader: jestObj.fn(),
            status: jestObj.fn().mockReturnThis(),
            end: jestObj.fn()
        };

        streamer = new FhirResponseExcelStreamer({
            response: mockResponse,
            requestId: 'req-123'
        });
    });

    describe('constructor', () => {
        test('stores response reference', () => {
            expect(streamer.response).toBe(mockResponse);
        });

        test('stores requestId', () => {
            expect(streamer.requestId).toBe('req-123');
        });

        test('initializes _first to true', () => {
            expect(streamer._first).toBe(true);
        });

        test('initializes _count to 0', () => {
            expect(streamer._count).toBe(0);
        });

        test('initializes _bundle to undefined', () => {
            expect(streamer._bundle).toBeUndefined();
        });

        test('initializes _bundle_entries to empty array', () => {
            expect(streamer._bundle_entries).toEqual([]);
        });
    });

    describe('startAsync', () => {
        test('sets Content-Type header to excel', async () => {
            await streamer.startAsync();

            expect(mockResponse.setHeader).toHaveBeenCalledWith(
                'Content-Type',
                'application/vnd.ms-excel'
            );
        });

        test('sets X-Request-ID header', async () => {
            await streamer.startAsync();

            expect(mockResponse.setHeader).toHaveBeenCalledWith(
                'X-Request-ID',
                'req-123'
            );
        });
    });

    describe('writeBundleEntryAsync', () => {
        test('accumulates bundle entries', async () => {
            const entry1 = { resource: { id: '1' } };
            const entry2 = { resource: { id: '2' } };

            await streamer.writeBundleEntryAsync({ bundleEntry: entry1 });
            await streamer.writeBundleEntryAsync({ bundleEntry: entry2 });

            expect(streamer._bundle_entries).toHaveLength(2);
            expect(streamer._bundle_entries[0]).toBe(entry1);
            expect(streamer._bundle_entries[1]).toBe(entry2);
        });

        test('first entry is stored correctly', async () => {
            const entry = { resource: { resourceType: 'Patient', id: 'p1' } };

            await streamer.writeBundleEntryAsync({ bundleEntry: entry });

            expect(streamer._bundle_entries).toEqual([entry]);
        });
    });

    describe('setBundle', () => {
        test('sets the bundle', () => {
            const bundle = { id: 'bundle-1', entry: [] };

            streamer.setBundle({ bundle });

            expect(streamer._bundle).toBe(bundle);
        });
    });

    describe('endAsync', () => {
        test('returns 404 when bundle is undefined', async () => {
            await streamer.endAsync();

            expect(mockResponse.status).toHaveBeenCalledWith(404);
            expect(mockResponse.end).toHaveBeenCalled();
        });

        test('returns 404 when bundle entries are empty', async () => {
            streamer.setBundle({ bundle: { id: 'b1', entry: [] } });

            await streamer.endAsync();

            expect(mockResponse.status).toHaveBeenCalledWith(404);
            expect(mockResponse.end).toHaveBeenCalled();
        });

        test('sets Content-Disposition header with bundle id as filename', async () => {
            streamer.setBundle({ bundle: { id: 'my-bundle', entry: [] } });
            await streamer.writeBundleEntryAsync({ bundleEntry: { resource: { id: '1' } } });

            await streamer.endAsync();

            expect(mockResponse.setHeader).toHaveBeenCalledWith(
                'Content-Disposition',
                'attachment; filename="my-bundle.xlsx"'
            );
        });

        test('uses requestId for filename when bundle.id is falsy', async () => {
            streamer.setBundle({ bundle: { id: null, entry: [] } });
            await streamer.writeBundleEntryAsync({ bundleEntry: { resource: { id: '1' } } });

            await streamer.endAsync();

            expect(mockResponse.setHeader).toHaveBeenCalledWith(
                'Content-Disposition',
                'attachment; filename="req-123.xlsx"'
            );
        });

        test('sets Access-Control-Expose-Headers', async () => {
            streamer.setBundle({ bundle: { id: 'b1', entry: [] } });
            await streamer.writeBundleEntryAsync({ bundleEntry: { resource: { id: '1' } } });

            await streamer.endAsync();

            expect(mockResponse.setHeader).toHaveBeenCalledWith(
                'Access-Control-Expose-Headers',
                'Content-Disposition'
            );
        });

        test('calls BundleToExcelConverter.convert with the bundle', async () => {
            const bundle = { id: 'b1', entry: [] };
            streamer.setBundle({ bundle });
            await streamer.writeBundleEntryAsync({ bundleEntry: { resource: { id: '1' } } });

            await streamer.endAsync();

            const converterInstance = BundleToExcelConverter.mock.results[0].value;
            expect(converterInstance.convert).toHaveBeenCalledWith({ bundle });
        });

        test('sends buffer using BufferToChunkTransferResponse', async () => {
            streamer.setBundle({ bundle: { id: 'b1', entry: [] } });
            await streamer.writeBundleEntryAsync({ bundleEntry: { resource: { id: '1' } } });

            await streamer.endAsync();

            const transferInstance = BufferToChunkTransferResponse.mock.results[0].value;
            expect(transferInstance.sendLargeFileChunkedAsync).toHaveBeenCalledWith({
                response: mockResponse,
                buffer: expect.any(Buffer),
                chunkSize: 64 * 1024
            });
        });

        test('returns 500 when converter throws', async () => {
            BundleToExcelConverter.mockImplementation(() => ({
                convert: jestObj.fn().mockImplementation(() => { throw new Error('convert failed'); })
            }));

            streamer.setBundle({ bundle: { id: 'b1', entry: [] } });
            await streamer.writeBundleEntryAsync({ bundleEntry: { resource: { id: '1' } } });

            await streamer.endAsync();

            expect(mockResponse.status).toHaveBeenCalledWith(500);
            expect(mockResponse.end).toHaveBeenCalled();
        });

        test('returns 500 when generated buffer is empty', async () => {
            BundleToExcelConverter.mockImplementation(() => ({
                convert: jestObj.fn().mockReturnValue(Buffer.alloc(0))
            }));

            streamer.setBundle({ bundle: { id: 'b1', entry: [] } });
            await streamer.writeBundleEntryAsync({ bundleEntry: { resource: { id: '1' } } });

            await streamer.endAsync();

            expect(mockResponse.status).toHaveBeenCalledWith(500);
            expect(mockResponse.end).toHaveBeenCalled();
        });

        test('assigns accumulated entries to bundle.entry before converting', async () => {
            const bundle = { id: 'b1', entry: [] };
            streamer.setBundle({ bundle });
            const entry1 = { resource: { id: '1' } };
            const entry2 = { resource: { id: '2' } };
            await streamer.writeBundleEntryAsync({ bundleEntry: entry1 });
            await streamer.writeBundleEntryAsync({ bundleEntry: entry2 });

            await streamer.endAsync();

            // The bundle should have had entries assigned before convert was called
            expect(bundle.entry).toEqual([entry1, entry2]);
        });
    });
});
