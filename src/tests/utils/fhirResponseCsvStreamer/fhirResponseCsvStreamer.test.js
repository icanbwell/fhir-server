const {FHIRBundleConverter} = require('@imranq2/fhir-to-csv/lib/converters/fhir_bundle_converter');
const {PassThrough} = require('stream');
const {FhirResponseCsvStreamer} = require("../../../utils/fhirResponseCsvStreamer");
const { describe, beforeEach, afterEach, test, expect, it} = require('@jest/globals');
const { jest } = require('@jest/globals');

describe('FhirResponseCsvStreamer', () => {
    let responseMock;
    let streamer;

    beforeEach(() => {
        responseMock = {
            setHeader: jest.fn(),
            write: jest.fn(),
            end: jest.fn()
        };
        streamer = new FhirResponseCsvStreamer({
            response: responseMock,
            requestId: 'test-request-id'
        });
    });

    describe('startAsync', () => {
        it('should set the correct headers', async () => {
            await streamer.startAsync();

            expect(responseMock.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv');
            expect(responseMock.setHeader).toHaveBeenCalledWith('Transfer-Encoding', 'chunked');
            expect(responseMock.setHeader).toHaveBeenCalledWith('X-Request-ID', 'test-request-id');
        });
    });

    describe('setBundle', () => {
        it('should set the bundle', () => {
            const bundle = {resourceType: 'Bundle'};
            streamer.setBundle({bundle});

            expect(streamer._bundle).toBe(bundle);
        });
    });

    describe('endAsync', () => {
        it('should write CSV data to the response', async () => {
            const bundle = {resourceType: 'Bundle'};
            streamer.setBundle({bundle});

            await streamer.startAsync();

            await streamer.endAsync();

            expect(responseMock.write).toHaveBeenCalledWith('mock-csv-data');
            expect(responseMock.end).toHaveBeenCalled();
        });

        it('should not write if no bundle is set', async () => {
            await streamer.endAsync();

            expect(responseMock.write).not.toHaveBeenCalled();
            expect(responseMock.end).toHaveBeenCalled();
        });
    });
});
