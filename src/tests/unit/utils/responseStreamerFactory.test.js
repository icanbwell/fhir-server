'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../utils/contentTypes', () => ({
    hasCsvContentType: jestObj.fn((val) => val === 'text/csv'),
    hasExcelContentType: jestObj.fn((val) => val === 'application/vnd.ms-excel')
}));

jestObj.mock('../../../utils/fhirResponseStreamer', () => ({
    FhirResponseStreamer: class FhirResponseStreamer {
        constructor(opts) { this.type = 'json'; this.opts = opts; }
    }
}));

jestObj.mock('../../../utils/fhirResponseCsvStreamer', () => ({
    FhirResponseCsvStreamer: class FhirResponseCsvStreamer {
        constructor(opts) { this.type = 'csv'; this.opts = opts; }
    }
}));

jestObj.mock('../../../utils/fhirResponseExcelStreamer', () => ({
    FhirResponseExcelStreamer: class FhirResponseExcelStreamer {
        constructor(opts) { this.type = 'excel'; this.opts = opts; }
    }
}));

const { ResponseStreamerFactory } = require('../../../utils/responseStreamerFactory');

describe('ResponseStreamerFactory', () => {
    const mockRes = {};
    const requestId = 'test-request-id';

    test('returns FhirResponseCsvStreamer when requestInfo.accept is csv', () => {
        const result = ResponseStreamerFactory.create({
            res: mockRes,
            requestId,
            requestInfo: { accept: 'text/csv' },
            parsedArgs: { _format: undefined }
        });

        expect(result.type).toBe('csv');
        expect(result.opts).toEqual({ response: mockRes, requestId });
    });

    test('returns FhirResponseCsvStreamer when parsedArgs._format is csv', () => {
        const result = ResponseStreamerFactory.create({
            res: mockRes,
            requestId,
            requestInfo: { accept: 'application/json' },
            parsedArgs: { _format: 'text/csv' }
        });

        expect(result.type).toBe('csv');
    });

    test('returns FhirResponseExcelStreamer when requestInfo.accept is excel', () => {
        const result = ResponseStreamerFactory.create({
            res: mockRes,
            requestId,
            requestInfo: { accept: 'application/vnd.ms-excel' },
            parsedArgs: { _format: undefined }
        });

        expect(result.type).toBe('excel');
        expect(result.opts).toEqual({ response: mockRes, requestId });
    });

    test('returns FhirResponseExcelStreamer when parsedArgs._format is excel', () => {
        const result = ResponseStreamerFactory.create({
            res: mockRes,
            requestId,
            requestInfo: { accept: 'application/json' },
            parsedArgs: { _format: 'application/vnd.ms-excel' }
        });

        expect(result.type).toBe('excel');
    });

    test('returns FhirResponseStreamer by default', () => {
        const result = ResponseStreamerFactory.create({
            res: mockRes,
            requestId,
            requestInfo: { accept: 'application/json' },
            parsedArgs: { _format: undefined }
        });

        expect(result.type).toBe('json');
        expect(result.opts).toEqual({ response: mockRes, requestId });
    });

    test('returns FhirResponseStreamer when neither csv nor excel', () => {
        const result = ResponseStreamerFactory.create({
            res: mockRes,
            requestId,
            requestInfo: { accept: 'application/fhir+json' },
            parsedArgs: { _format: 'application/fhir+json' }
        });

        expect(result.type).toBe('json');
    });

    test('csv accept takes priority over excel format', () => {
        const result = ResponseStreamerFactory.create({
            res: mockRes,
            requestId,
            requestInfo: { accept: 'text/csv' },
            parsedArgs: { _format: 'application/vnd.ms-excel' }
        });

        expect(result.type).toBe('csv');
    });
});
