'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../../../utils/assertType', () => ({
    assertTypeEquals: jestObj.fn(),
    assertIsValid: jestObj.fn()
}));

jestObj.mock('../../../../../utils/contentTypes', () => ({
    hasNdJsonContentType: jestObj.fn((val) => {
        if (Array.isArray(val)) return val.includes('application/fhir+ndjson');
        return val === 'application/fhir+ndjson' || val === 'ndjson';
    }),
    hasExcelContentType: jestObj.fn((val) => val === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    fhirContentTypes: {
        ndJson: 'application/fhir+ndjson',
        fhirJson: 'application/fhir+json',
        csv: 'text/csv',
        tsv: 'text/tab-separated-values',
        pipeDelimited: 'text/pipe-delimited',
        excel: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    }
}));

jestObj.mock('../../../../../operations/streaming/resourceWriters/fhirResourceNdJsonWriter', () => ({
    FhirResourceNdJsonWriter: class FhirResourceNdJsonWriter { constructor(opts) { this.type = 'ndjson'; this.opts = opts; } }
}));

jestObj.mock('../../../../../operations/streaming/resourceWriters/fhirResourceCsvWriter', () => ({
    FhirResourceCsvWriter: class FhirResourceCsvWriter { constructor(opts) { this.type = 'csv'; this.opts = opts; } }
}));

jestObj.mock('../../../../../operations/streaming/resourceWriters/fhirResourceWriter', () => ({
    FhirResourceWriter: class FhirResourceWriter { constructor(opts) { this.type = 'json'; this.opts = opts; } }
}));

jestObj.mock('../../../../../operations/streaming/resourceWriters/fhirBundleWriter', () => ({
    FhirBundleWriter: class FhirBundleWriter { constructor(opts) { this.type = 'bundle'; this.opts = opts; } }
}));

jestObj.mock('../../../../../operations/streaming/resourceWriters/fhirResourceExcelWriter', () => ({
    FhirResourceExcelWriter: class FhirResourceExcelWriter { constructor(opts) { this.type = 'excel'; this.opts = opts; } }
}));

jestObj.mock('../../../../../utils/configManager', () => ({
    ConfigManager: class ConfigManager {}
}));

const { FhirResourceWriterFactory } = require('../../../../../operations/streaming/resourceWriters/fhirResourceWriterFactory');

describe('FhirResourceWriterFactory', () => {
    const baseParams = {
        accepts: [],
        signal: { aborted: false },
        format: undefined,
        url: '/Patient',
        bundle: false,
        defaultSortId: '_lastUpdated',
        fnBundle: jestObj.fn(),
        highWaterMark: 16,
        configManager: { enableReturnBundle: false },
        response: {}
    };

    test('format=ndjson creates FhirResourceNdJsonWriter', () => {
        const factory = new FhirResourceWriterFactory({ configManager: { enableReturnBundle: false } });
        const writer = factory.createResourceWriter({ ...baseParams, format: 'ndjson' });
        expect(writer.type).toBe('ndjson');
    });

    test('format=fhirJson creates FhirResourceWriter', () => {
        const factory = new FhirResourceWriterFactory({ configManager: { enableReturnBundle: false } });
        const writer = factory.createResourceWriter({ ...baseParams, format: 'application/fhir+json' });
        expect(writer.type).toBe('json');
    });

    test('format=fhirJson with bundle=true creates FhirBundleWriter', () => {
        const factory = new FhirResourceWriterFactory({ configManager: { enableReturnBundle: false } });
        const writer = factory.createResourceWriter({ ...baseParams, format: 'application/fhir+json', bundle: true });
        expect(writer.type).toBe('bundle');
    });

    test('format=fhirJson with enableReturnBundle creates FhirBundleWriter', () => {
        const factory = new FhirResourceWriterFactory({ configManager: { enableReturnBundle: true } });
        const writer = factory.createResourceWriter({ ...baseParams, format: 'application/fhir+json' });
        expect(writer.type).toBe('bundle');
    });

    test('format=csv creates FhirResourceCsvWriter with comma delimiter', () => {
        const factory = new FhirResourceWriterFactory({ configManager: { enableReturnBundle: false } });
        const writer = factory.createResourceWriter({ ...baseParams, format: 'text/csv' });
        expect(writer.type).toBe('csv');
        expect(writer.opts.delimiter).toBe(',');
    });

    test('format=tsv creates FhirResourceCsvWriter with tab delimiter', () => {
        const factory = new FhirResourceWriterFactory({ configManager: { enableReturnBundle: false } });
        const writer = factory.createResourceWriter({ ...baseParams, format: 'text/tab-separated-values' });
        expect(writer.type).toBe('csv');
        expect(writer.opts.delimiter).toBe('\t');
    });

    test('format=pipe creates FhirResourceCsvWriter with pipe delimiter', () => {
        const factory = new FhirResourceWriterFactory({ configManager: { enableReturnBundle: false } });
        const writer = factory.createResourceWriter({ ...baseParams, format: 'text/pipe-delimited' });
        expect(writer.type).toBe('csv');
        expect(writer.opts.delimiter).toBe('|');
    });

    test('accepts ndjson falls back to NdJsonWriter when no format', () => {
        const factory = new FhirResourceWriterFactory({ configManager: { enableReturnBundle: false } });
        const writer = factory.createResourceWriter({ ...baseParams, accepts: ['application/fhir+ndjson'] });
        expect(writer.type).toBe('ndjson');
    });

    test('accepts fhirJson falls back to FhirResourceWriter when no format', () => {
        const factory = new FhirResourceWriterFactory({ configManager: { enableReturnBundle: false } });
        const writer = factory.createResourceWriter({ ...baseParams, accepts: ['application/fhir+json'] });
        expect(writer.type).toBe('json');
    });

    test('default returns FhirResourceWriter when no format or matching accepts', () => {
        const factory = new FhirResourceWriterFactory({ configManager: { enableReturnBundle: false } });
        const writer = factory.createResourceWriter({ ...baseParams, accepts: ['text/html'] });
        expect(writer.type).toBe('json');
    });

    test('default returns FhirBundleWriter when enableReturnBundle is true', () => {
        const factory = new FhirResourceWriterFactory({ configManager: { enableReturnBundle: true } });
        const writer = factory.createResourceWriter({ ...baseParams, accepts: ['text/html'] });
        expect(writer.type).toBe('bundle');
    });
});
