'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');
const { Transform } = require('stream');
const { FhirResourceWriterBase } = require('../../../../../operations/streaming/resourceWriters/fhirResourceWriterBase');

describe('FhirResourceWriterBase', () => {
    test('is a Transform stream', () => {
        const writer = new FhirResourceWriterBase({
            objectMode: true,
            contentType: 'application/json',
            highWaterMark: 16,
            response: {}
        });

        expect(writer).toBeInstanceOf(Transform);
    });

    test('constructor sets contentType', () => {
        const writer = new FhirResourceWriterBase({
            objectMode: true,
            contentType: 'application/fhir+json',
            highWaterMark: 16,
            response: {}
        });

        expect(writer._contentType).toBe('application/fhir+json');
    });

    test('constructor sets response', () => {
        const mockResponse = { write: jestObj.fn(), end: jestObj.fn() };
        const writer = new FhirResourceWriterBase({
            objectMode: true,
            contentType: 'text/csv',
            highWaterMark: 16,
            response: mockResponse
        });

        expect(writer.response).toBe(mockResponse);
    });

    test('constructor sets objectMode', () => {
        const writer = new FhirResourceWriterBase({
            objectMode: true,
            contentType: 'application/json',
            highWaterMark: 16,
            response: {}
        });

        expect(writer.readableObjectMode).toBe(true);
        expect(writer.writableObjectMode).toBe(true);
    });

    test('getContentType returns the contentType', () => {
        const writer = new FhirResourceWriterBase({
            objectMode: true,
            contentType: 'application/fhir+ndjson',
            highWaterMark: 32,
            response: {}
        });

        expect(writer.getContentType()).toBe('application/fhir+ndjson');
    });

    test('getContentType returns different content types correctly', () => {
        const writer1 = new FhirResourceWriterBase({
            objectMode: true,
            contentType: 'text/csv',
            highWaterMark: 16,
            response: {}
        });
        const writer2 = new FhirResourceWriterBase({
            objectMode: true,
            contentType: 'application/vnd.ms-excel',
            highWaterMark: 16,
            response: {}
        });

        expect(writer1.getContentType()).toBe('text/csv');
        expect(writer2.getContentType()).toBe('application/vnd.ms-excel');
    });

    test('constructor respects highWaterMark', () => {
        const writer = new FhirResourceWriterBase({
            objectMode: true,
            contentType: 'application/json',
            highWaterMark: 64,
            response: {}
        });

        expect(writer.readableHighWaterMark).toBe(64);
        expect(writer.writableHighWaterMark).toBe(64);
    });
});
