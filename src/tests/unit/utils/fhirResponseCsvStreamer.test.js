'use strict';

const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

// Mock dependencies
jestObj.mock('../../../utils/assertType', () => ({
    assertIsValid: jestObj.fn()
}));

jestObj.mock('../../../utils/baseResponseStreamer', () => {
    class BaseResponseStreamer {
        constructor({ response, requestId }) {
            this.response = response;
            this.requestId = requestId;
        }
    }
    return { BaseResponseStreamer };
});

jestObj.mock('../../../utils/contentTypes', () => ({
    fhirContentTypes: {
        zip: 'application/zip'
    }
}));

jestObj.mock('../../../operations/common/logging', () => ({
    logError: jestObj.fn()
}));

const mockConvert = jestObj.fn();
jestObj.mock('../../../converters/bundleToCsvConverter', () => ({
    BundleToCsvConverter: jestObj.fn().mockImplementation(() => ({
        convert: mockConvert
    }))
}));

const mockSendLargeFileChunkedAsync = jestObj.fn().mockResolvedValue(undefined);
jestObj.mock('../../../utils/buffer_to_chunk_transfer_response', () => ({
    BufferToChunkTransferResponse: jestObj.fn().mockImplementation(() => ({
        sendLargeFileChunkedAsync: mockSendLargeFileChunkedAsync
    }))
}));

const { FhirResponseCsvStreamer } = require('../../../utils/fhirResponseCsvStreamer');
const { logError } = require('../../../operations/common/logging');
const { BundleToCsvConverter } = require('../../../converters/bundleToCsvConverter');
const { BufferToChunkTransferResponse } = require('../../../utils/buffer_to_chunk_transfer_response');

describe('FhirResponseCsvStreamer', () => {
    let streamer;
    let mockResponse;

    beforeEach(() => {
        jestObj.clearAllMocks();

        mockResponse = {
            setHeader: jestObj.fn(),
            write: jestObj.fn().mockResolvedValue(true),
            end: jestObj.fn().mockResolvedValue(true),
            status: jestObj.fn().mockReturnThis()
        };

        mockConvert.mockReturnValue(Buffer.from('fake-zip-data'));

        streamer = new FhirResponseCsvStreamer({
            response: mockResponse,
            requestId: 'req-csv-123'
        });
    });

    describe('constructor', () => {
        test('sets _first to true', () => {
            expect(streamer._first).toBe(true);
        });

        test('sets _count to 0', () => {
            expect(streamer._count).toBe(0);
        });

        test('sets _bundle to undefined', () => {
            expect(streamer._bundle).toBeUndefined();
        });

        test('initializes _bundle_entries as empty array', () => {
            expect(streamer._bundle_entries).toEqual([]);
        });

        test('stores response', () => {
            expect(streamer.response).toBe(mockResponse);
        });

        test('stores requestId', () => {
            expect(streamer.requestId).toBe('req-csv-123');
        });
    });

    describe('startAsync', () => {
        test('sets Content-Type to application/zip', async () => {
            await streamer.startAsync();
            expect(mockResponse.setHeader).toHaveBeenCalledWith('Content-Type', 'application/zip');
        });

        test('sets X-Request-ID header', async () => {
            await streamer.startAsync();
            expect(mockResponse.setHeader).toHaveBeenCalledWith('X-Request-ID', 'req-csv-123');
        });
    });

    describe('writeBundleEntryAsync', () => {
        test('pushes bundle entry to _bundle_entries array', async () => {
            const bundleEntry = { resource: { id: 'p1', resourceType: 'Patient' } };
            await streamer.writeBundleEntryAsync({ bundleEntry });
            expect(streamer._bundle_entries).toHaveLength(1);
            expect(streamer._bundle_entries[0]).toBe(bundleEntry);
        });

        test('accumulates multiple bundle entries', async () => {
            const entry1 = { resource: { id: 'p1', resourceType: 'Patient' } };
            const entry2 = { resource: { id: 'p2', resourceType: 'Patient' } };
            await streamer.writeBundleEntryAsync({ bundleEntry: entry1 });
            await streamer.writeBundleEntryAsync({ bundleEntry: entry2 });
            expect(streamer._bundle_entries).toHaveLength(2);
        });
    });

    describe('setBundle', () => {
        test('stores the bundle', () => {
            const bundle = { id: 'bundle-1', type: 'searchset', resourceType: 'Bundle' };
            streamer.setBundle({ bundle });
            expect(streamer._bundle).toBe(bundle);
        });

        test('overwrites previously set bundle', () => {
            const bundle1 = { id: 'bundle-1' };
            const bundle2 = { id: 'bundle-2' };
            streamer.setBundle({ bundle: bundle1 });
            streamer.setBundle({ bundle: bundle2 });
            expect(streamer._bundle).toBe(bundle2);
        });
    });

    describe('endAsync', () => {
        describe('when bundle has entries', () => {
            beforeEach(() => {
                streamer.setBundle({
                    bundle: { id: 'test-bundle', entry: [{ resource: { id: 'p1' } }] }
                });
            });

            test('sets Content-Disposition header with bundle id', async () => {
                await streamer.endAsync();
                expect(mockResponse.setHeader).toHaveBeenCalledWith(
                    'Content-Disposition',
                    'attachment; filename="test-bundle.zip"'
                );
            });

            test('sets Access-Control-Expose-Headers', async () => {
                await streamer.endAsync();
                expect(mockResponse.setHeader).toHaveBeenCalledWith(
                    'Access-Control-Expose-Headers',
                    'Content-Disposition'
                );
            });

            test('creates BundleToCsvConverter and calls convert', async () => {
                await streamer.endAsync();
                expect(BundleToCsvConverter).toHaveBeenCalledTimes(1);
                expect(mockConvert).toHaveBeenCalledWith({
                    bundle: expect.objectContaining({ id: 'test-bundle' })
                });
            });

            test('sends buffer via BufferToChunkTransferResponse', async () => {
                await streamer.endAsync();
                expect(mockSendLargeFileChunkedAsync).toHaveBeenCalledWith({
                    response: mockResponse,
                    buffer: expect.any(Buffer),
                    chunkSize: 64 * 1024
                });
            });
        });

        describe('when bundle_entries are accumulated via writeBundleEntryAsync', () => {
            test('uses accumulated _bundle_entries as bundle.entry', async () => {
                const entry1 = { resource: { id: 'p1', resourceType: 'Patient' } };
                const entry2 = { resource: { id: 'p2', resourceType: 'Patient' } };
                streamer.setBundle({ bundle: { id: 'accumulated-bundle' } });
                await streamer.writeBundleEntryAsync({ bundleEntry: entry1 });
                await streamer.writeBundleEntryAsync({ bundleEntry: entry2 });

                await streamer.endAsync();

                expect(mockConvert).toHaveBeenCalledWith({
                    bundle: expect.objectContaining({
                        id: 'accumulated-bundle',
                        entry: [entry1, entry2]
                    })
                });
            });
        });

        describe('when bundle has no entry and no accumulated entries', () => {
            test('returns 404 when bundle is undefined', async () => {
                await streamer.endAsync();
                expect(mockResponse.status).toHaveBeenCalledWith(404);
                expect(mockResponse.end).toHaveBeenCalled();
            });

            test('returns 404 when bundle has no entry property and no accumulated entries', async () => {
                streamer.setBundle({ bundle: { id: 'empty-bundle' } });
                await streamer.endAsync();
                expect(mockResponse.status).toHaveBeenCalledWith(404);
                expect(mockResponse.end).toHaveBeenCalled();
            });
        });

        describe('filename generation', () => {
            test('uses bundle.id for filename when present', async () => {
                streamer.setBundle({
                    bundle: { id: 'my-bundle-id', entry: [{ resource: { id: 'p1' } }] }
                });
                await streamer.endAsync();
                expect(mockResponse.setHeader).toHaveBeenCalledWith(
                    'Content-Disposition',
                    'attachment; filename="my-bundle-id.zip"'
                );
            });

            test('uses requestId for filename when bundle.id is falsy', async () => {
                streamer.setBundle({
                    bundle: { id: null, entry: [{ resource: { id: 'p1' } }] }
                });
                await streamer.endAsync();
                expect(mockResponse.setHeader).toHaveBeenCalledWith(
                    'Content-Disposition',
                    'attachment; filename="req-csv-123.zip"'
                );
            });

            test('uses requestId for filename when bundle.id is empty string', async () => {
                streamer.setBundle({
                    bundle: { id: '', entry: [{ resource: { id: 'p1' } }] }
                });
                await streamer.endAsync();
                expect(mockResponse.setHeader).toHaveBeenCalledWith(
                    'Content-Disposition',
                    'attachment; filename="req-csv-123.zip"'
                );
            });
        });

        describe('error handling', () => {
            test('returns 500 when converter throws', async () => {
                mockConvert.mockImplementationOnce(() => {
                    throw new Error('Conversion failed');
                });
                streamer.setBundle({
                    bundle: { id: 'error-bundle', entry: [{ resource: { id: 'p1' } }] }
                });

                await streamer.endAsync();

                expect(mockResponse.status).toHaveBeenCalledWith(500);
                expect(mockResponse.end).toHaveBeenCalled();
            });

            test('logs error when converter throws', async () => {
                const error = new Error('Conversion failed');
                mockConvert.mockImplementationOnce(() => {
                    throw error;
                });
                streamer.setBundle({
                    bundle: { id: 'error-bundle', entry: [{ resource: { id: 'p1' } }] }
                });

                await streamer.endAsync();

                expect(logError).toHaveBeenCalledWith(
                    'Error generating FHIR CSV export:',
                    error
                );
            });

            test('returns 500 when buffer is empty', async () => {
                mockConvert.mockReturnValueOnce(Buffer.alloc(0));
                streamer.setBundle({
                    bundle: { id: 'empty-buffer-bundle', entry: [{ resource: { id: 'p1' } }] }
                });

                await streamer.endAsync();

                expect(mockResponse.status).toHaveBeenCalledWith(500);
                expect(mockResponse.end).toHaveBeenCalled();
            });

            test('logs error when buffer is empty', async () => {
                mockConvert.mockReturnValueOnce(Buffer.alloc(0));
                streamer.setBundle({
                    bundle: { id: 'empty-buffer-bundle', entry: [{ resource: { id: 'p1' } }] }
                });

                await streamer.endAsync();

                expect(logError).toHaveBeenCalledWith(
                    'Error generating FHIR CSV export:',
                    expect.objectContaining({ message: 'Generated zip buffer is empty' })
                );
            });

            test('returns 500 when sendLargeFileChunkedAsync rejects', async () => {
                mockSendLargeFileChunkedAsync.mockRejectedValueOnce(new Error('Stream error'));
                streamer.setBundle({
                    bundle: { id: 'stream-error-bundle', entry: [{ resource: { id: 'p1' } }] }
                });

                await streamer.endAsync();

                expect(mockResponse.status).toHaveBeenCalledWith(500);
                expect(mockResponse.end).toHaveBeenCalled();
            });
        });
    });
});
