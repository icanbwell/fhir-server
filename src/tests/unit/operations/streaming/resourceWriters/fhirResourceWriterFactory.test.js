'use strict';

const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

// Mock all writer classes
jestObj.mock('../../../../../operations/streaming/resourceWriters/fhirResourceNdJsonWriter', () => ({
    FhirResourceNdJsonWriter: jestObj.fn().mockImplementation((params) => ({
        type: 'NdJsonWriter',
        ...params
    }))
}));

jestObj.mock('../../../../../operations/streaming/resourceWriters/fhirResourceCsvWriter', () => ({
    FhirResourceCsvWriter: jestObj.fn().mockImplementation((params) => ({
        type: 'CsvWriter',
        ...params
    }))
}));

jestObj.mock('../../../../../operations/streaming/resourceWriters/fhirResourceWriter', () => ({
    FhirResourceWriter: jestObj.fn().mockImplementation((params) => ({
        type: 'FhirResourceWriter',
        ...params
    }))
}));

jestObj.mock('../../../../../operations/streaming/resourceWriters/fhirBundleWriter', () => ({
    FhirBundleWriter: jestObj.fn().mockImplementation((params) => ({
        type: 'FhirBundleWriter',
        ...params
    }))
}));

jestObj.mock('../../../../../operations/streaming/resourceWriters/fhirResourceExcelWriter', () => ({
    FhirResourceExcelWriter: jestObj.fn().mockImplementation((params) => ({
        type: 'ExcelWriter',
        ...params
    }))
}));

jestObj.mock('../../../../../utils/assertType', () => ({
    assertTypeEquals: jestObj.fn()
}));

jestObj.mock('../../../../../utils/configManager', () => ({
    ConfigManager: jestObj.fn()
}));

const { FhirResourceWriterFactory } = require('../../../../../operations/streaming/resourceWriters/fhirResourceWriterFactory');
const { FhirResourceNdJsonWriter } = require('../../../../../operations/streaming/resourceWriters/fhirResourceNdJsonWriter');
const { FhirResourceCsvWriter } = require('../../../../../operations/streaming/resourceWriters/fhirResourceCsvWriter');
const { FhirResourceWriter } = require('../../../../../operations/streaming/resourceWriters/fhirResourceWriter');
const { FhirBundleWriter } = require('../../../../../operations/streaming/resourceWriters/fhirBundleWriter');
const { FhirResourceExcelWriter } = require('../../../../../operations/streaming/resourceWriters/fhirResourceExcelWriter');

describe('FhirResourceWriterFactory', () => {
    let factory;
    let mockConfigManager;

    const defaultArgs = {
        accepts: [],
        signal: null,
        format: undefined,
        url: 'http://localhost/fhir/Patient',
        bundle: false,
        defaultSortId: '_id',
        fnBundle: jestObj.fn(),
        highWaterMark: 100,
        configManager: null,
        response: {}
    };

    beforeEach(() => {
        jestObj.clearAllMocks();
        mockConfigManager = {
            enableReturnBundle: false
        };
        factory = new FhirResourceWriterFactory({ configManager: mockConfigManager });
    });

    function createWriter(overrides = {}) {
        return factory.createResourceWriter({ ...defaultArgs, ...overrides });
    }

    describe('format parameter selection (highest priority)', () => {
        test('format=application/fhir+ndjson selects NdJsonWriter', () => {
            const result = createWriter({ format: 'application/fhir+ndjson' });

            expect(result.type).toBe('NdJsonWriter');
            expect(FhirResourceNdJsonWriter).toHaveBeenCalled();
        });

        test('format=application/ndjson selects NdJsonWriter', () => {
            const result = createWriter({ format: 'application/ndjson' });

            expect(result.type).toBe('NdJsonWriter');
        });

        test('format=ndjson selects NdJsonWriter', () => {
            const result = createWriter({ format: 'ndjson' });

            expect(result.type).toBe('NdJsonWriter');
        });

        test('format=application/fhir+json with enableReturnBundle=true selects BundleWriter', () => {
            mockConfigManager.enableReturnBundle = true;
            const result = createWriter({ format: 'application/fhir+json' });

            expect(result.type).toBe('FhirBundleWriter');
            expect(FhirBundleWriter).toHaveBeenCalled();
        });

        test('format=application/fhir+json with enableReturnBundle=false selects FhirResourceWriter', () => {
            mockConfigManager.enableReturnBundle = false;
            const result = createWriter({ format: 'application/fhir+json' });

            expect(result.type).toBe('FhirResourceWriter');
            expect(FhirResourceWriter).toHaveBeenCalled();
        });

        test('format=application/fhir+json with bundle=true overrides enableReturnBundle=false', () => {
            mockConfigManager.enableReturnBundle = false;
            const result = createWriter({ format: 'application/fhir+json', bundle: true });

            expect(result.type).toBe('FhirBundleWriter');
            expect(FhirBundleWriter).toHaveBeenCalled();
        });

        test('format=text/csv selects CsvWriter with comma delimiter', () => {
            const result = createWriter({ format: 'text/csv' });

            expect(result.type).toBe('CsvWriter');
            expect(FhirResourceCsvWriter).toHaveBeenCalledWith(
                expect.objectContaining({ delimiter: ',' })
            );
        });

        test('format=application/vnd.ms-excel selects ExcelWriter', () => {
            const result = createWriter({ format: 'application/vnd.ms-excel' });

            expect(result.type).toBe('ExcelWriter');
            expect(FhirResourceExcelWriter).toHaveBeenCalled();
        });

        test('format=text/tab-separated-values selects CsvWriter with tab delimiter', () => {
            const result = createWriter({ format: 'text/tab-separated-values' });

            expect(result.type).toBe('CsvWriter');
            expect(FhirResourceCsvWriter).toHaveBeenCalledWith(
                expect.objectContaining({ delimiter: '\t' })
            );
        });

        test('format=text/plain-pipe-delimited selects CsvWriter with pipe delimiter', () => {
            const result = createWriter({ format: 'text/plain-pipe-delimited' });

            expect(result.type).toBe('CsvWriter');
            expect(FhirResourceCsvWriter).toHaveBeenCalledWith(
                expect.objectContaining({ delimiter: '|' })
            );
        });

        test('format parameter takes priority over accepts header', () => {
            // format says ndjson, accepts says csv - format wins
            const result = createWriter({
                format: 'ndjson',
                accepts: ['text/csv']
            });

            expect(result.type).toBe('NdJsonWriter');
            expect(FhirResourceCsvWriter).not.toHaveBeenCalled();
        });
    });

    describe('accepts header selection (second priority)', () => {
        test('accepts includes ndjson content type selects NdJsonWriter', () => {
            const result = createWriter({
                accepts: ['application/fhir+ndjson']
            });

            expect(result.type).toBe('NdJsonWriter');
        });

        test('accepts includes application/ndjson selects NdJsonWriter', () => {
            const result = createWriter({
                accepts: ['application/ndjson']
            });

            expect(result.type).toBe('NdJsonWriter');
        });

        test('accepts includes application/fhir+json with enableReturnBundle selects BundleWriter', () => {
            mockConfigManager.enableReturnBundle = true;
            const result = createWriter({
                accepts: ['application/fhir+json']
            });

            expect(result.type).toBe('FhirBundleWriter');
        });

        test('accepts includes application/fhir+json without enableReturnBundle selects FhirResourceWriter', () => {
            mockConfigManager.enableReturnBundle = false;
            const result = createWriter({
                accepts: ['application/fhir+json']
            });

            expect(result.type).toBe('FhirResourceWriter');
        });

        test('accepts includes application/fhir+json with bundle=true selects BundleWriter', () => {
            mockConfigManager.enableReturnBundle = false;
            const result = createWriter({
                accepts: ['application/fhir+json'],
                bundle: true
            });

            expect(result.type).toBe('FhirBundleWriter');
        });

        test('accepts includes text/csv selects CsvWriter', () => {
            const result = createWriter({
                accepts: ['text/csv']
            });

            expect(result.type).toBe('CsvWriter');
            expect(FhirResourceCsvWriter).toHaveBeenCalledWith(
                expect.objectContaining({ delimiter: ',' })
            );
        });

        test('accepts includes application/vnd.ms-excel selects ExcelWriter', () => {
            const result = createWriter({
                accepts: ['application/vnd.ms-excel']
            });

            expect(result.type).toBe('ExcelWriter');
        });

        test('accepts includes text/tab-separated-values selects CsvWriter with tab', () => {
            const result = createWriter({
                accepts: ['text/tab-separated-values']
            });

            expect(result.type).toBe('CsvWriter');
            expect(FhirResourceCsvWriter).toHaveBeenCalledWith(
                expect.objectContaining({ delimiter: '\t' })
            );
        });

        test('accepts includes text/plain-pipe-delimited selects CsvWriter with pipe', () => {
            const result = createWriter({
                accepts: ['text/plain-pipe-delimited']
            });

            expect(result.type).toBe('CsvWriter');
            expect(FhirResourceCsvWriter).toHaveBeenCalledWith(
                expect.objectContaining({ delimiter: '|' })
            );
        });

        test('first matching accept wins (ndjson before csv)', () => {
            const result = createWriter({
                accepts: ['application/fhir+ndjson', 'text/csv']
            });

            expect(result.type).toBe('NdJsonWriter');
        });
    });

    describe('default writer selection (no format, no matching accepts)', () => {
        test('returns BundleWriter when enableReturnBundle is true', () => {
            mockConfigManager.enableReturnBundle = true;
            const result = createWriter({
                accepts: ['text/html']
            });

            expect(result.type).toBe('FhirBundleWriter');
        });

        test('returns BundleWriter when bundle=true even if enableReturnBundle is false', () => {
            mockConfigManager.enableReturnBundle = false;
            const result = createWriter({
                accepts: ['text/html'],
                bundle: true
            });

            expect(result.type).toBe('FhirBundleWriter');
        });

        test('returns FhirResourceWriter when enableReturnBundle=false and bundle=false', () => {
            mockConfigManager.enableReturnBundle = false;
            const result = createWriter({
                accepts: ['text/html']
            });

            expect(result.type).toBe('FhirResourceWriter');
        });

        test('returns FhirResourceWriter with empty accepts array', () => {
            mockConfigManager.enableReturnBundle = false;
            const result = createWriter({
                accepts: []
            });

            expect(result.type).toBe('FhirResourceWriter');
        });
    });

    describe('unsupported format falls through to accepts', () => {
        test('unrecognized format value falls through to accepts check', () => {
            const result = createWriter({
                format: 'application/xml',
                accepts: ['application/fhir+ndjson']
            });

            // 'application/xml' doesn't match any format check, falls through
            expect(result.type).toBe('NdJsonWriter');
        });

        test('unrecognized format with no matching accepts returns default', () => {
            mockConfigManager.enableReturnBundle = false;
            const result = createWriter({
                format: 'application/xml',
                accepts: ['text/html']
            });

            expect(result.type).toBe('FhirResourceWriter');
        });
    });

    describe('writer construction parameters', () => {
        test('NdJsonWriter receives signal, highWaterMark, configManager, response', () => {
            const signal = new AbortController().signal;
            const response = { headersSent: false };
            const configManager = { some: 'config' };

            createWriter({
                format: 'ndjson',
                signal,
                highWaterMark: 200,
                configManager,
                response
            });

            expect(FhirResourceNdJsonWriter).toHaveBeenCalledWith(
                expect.objectContaining({
                    signal,
                    highWaterMark: 200,
                    configManager,
                    response,
                    contentType: 'application/fhir+ndjson'
                })
            );
        });

        test('BundleWriter receives fnBundle, url, defaultSortId', () => {
            mockConfigManager.enableReturnBundle = true;
            const fnBundle = jestObj.fn();
            const url = 'http://example.com/fhir/Patient';

            createWriter({
                format: 'application/fhir+json',
                fnBundle,
                url,
                defaultSortId: 'customSort'
            });

            expect(FhirBundleWriter).toHaveBeenCalledWith(
                expect.objectContaining({
                    fnBundle,
                    url,
                    defaultSortId: 'customSort'
                })
            );
        });

        test('CsvWriter for CSV receives comma delimiter and csv content type', () => {
            createWriter({ format: 'text/csv' });

            expect(FhirResourceCsvWriter).toHaveBeenCalledWith(
                expect.objectContaining({
                    delimiter: ',',
                    contentType: 'text/csv'
                })
            );
        });

        test('CsvWriter for TSV receives tab delimiter and tsv content type', () => {
            createWriter({ format: 'text/tab-separated-values' });

            expect(FhirResourceCsvWriter).toHaveBeenCalledWith(
                expect.objectContaining({
                    delimiter: '\t',
                    contentType: 'text/tab-separated-values'
                })
            );
        });

        test('CsvWriter for pipe receives pipe delimiter and pipe content type', () => {
            createWriter({ format: 'text/plain-pipe-delimited' });

            expect(FhirResourceCsvWriter).toHaveBeenCalledWith(
                expect.objectContaining({
                    delimiter: '|',
                    contentType: 'text/plain-pipe-delimited'
                })
            );
        });
    });
});
