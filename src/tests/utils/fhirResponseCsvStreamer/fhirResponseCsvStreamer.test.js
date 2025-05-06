const {FHIRBundleConverter} = require('@imranq2/fhir-to-csv/lib/converters/fhir_bundle_converter');
const {PassThrough} = require('stream');
const {FhirResponseCsvStreamer} = require("../../../utils/fhirResponseCsvStreamer");
const {describe, beforeEach, afterEach, test, expect, it} = require('@jest/globals');
const {jest} = require('@jest/globals');
const Bundle = require("../../../fhir/classes/4_0_0/resources/bundle");
const BundleEntry = require("../../../fhir/classes/4_0_0/backbone_elements/bundleEntry");
const moment = require("moment-timezone");

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
            /**
             * @type {Bundle}
             */
            const bundle = new Bundle({
                type: 'searchset',
                timestamp: moment.utc().format('YYYY-MM-DDThh:mm:ss.sss') + 'Z',
                entry: [
                    new BundleEntry({
                        resource: {
                            resourceType: 'Patient',
                            id: '123',
                            name: [{use: 'official', family: 'Doe', given: ['John']}]
                        }
                    }),
                    new BundleEntry({
                        resource: {
                            resourceType: 'Observation',
                            id: '456',
                            status: 'final',
                            code: {text: 'Heart Rate'},
                            subject: {reference: 'Patient/123'}
                        }
                    }),
                    new BundleEntry({
                        resource: {
                            resourceType: 'Observation',
                            id: '789',
                            status: 'final',
                            code: {text: 'Heart Rate'},
                            subject: {reference: 'Patient/123'}
                        }
                    })
                ]
            });

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
