'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../../utils/contentTypes', () => ({
    hasCsvContentType: jestObj.fn((val) => val === 'text/csv'),
    hasExcelContentType: jestObj.fn((val) => val === 'application/vnd.ms-excel')
}));

jestObj.mock('../../../../utils/responseHandler/baseResponseHandler', () => ({
    BaseResponseHandler: class BaseResponseHandler {}
}));

jestObj.mock('../../../../utils/responseHandler/csvResponseHandler', () => ({
    CsvResponseHandler: class CsvResponseHandler {
        constructor(opts) { this.type = 'csv'; this.opts = opts; }
    }
}));

jestObj.mock('../../../../utils/responseHandler/excelResponseHandler', () => ({
    ExcelResponseHandler: class ExcelResponseHandler {
        constructor(opts) { this.type = 'excel'; this.opts = opts; }
    }
}));

jestObj.mock('../../../../utils/responseHandler/jsonResponseHandler', () => ({
    JsonResponseHandler: class JsonResponseHandler {
        constructor(opts) { this.type = 'json'; this.opts = opts; }
    }
}));

const { ResponseHandlerFactory } = require('../../../../utils/responseHandler/responseHandlerFactory');

describe('ResponseHandlerFactory', () => {
    const mockRes = {};
    const requestId = 'test-request-id';

    test('returns CsvResponseHandler when requestInfo.accept is csv', () => {
        const result = ResponseHandlerFactory.create({
            res: mockRes,
            requestId,
            requestInfo: { accept: 'text/csv' },
            parsedArgs: { _format: undefined }
        });

        expect(result.type).toBe('csv');
        expect(result.opts).toEqual({ response: mockRes, requestId });
    });

    test('returns CsvResponseHandler when parsedArgs._format is csv', () => {
        const result = ResponseHandlerFactory.create({
            res: mockRes,
            requestId,
            requestInfo: { accept: 'application/json' },
            parsedArgs: { _format: 'text/csv' }
        });

        expect(result.type).toBe('csv');
    });

    test('returns ExcelResponseHandler when requestInfo.accept is excel', () => {
        const result = ResponseHandlerFactory.create({
            res: mockRes,
            requestId,
            requestInfo: { accept: 'application/vnd.ms-excel' },
            parsedArgs: { _format: undefined }
        });

        expect(result.type).toBe('excel');
        expect(result.opts).toEqual({ response: mockRes, requestId });
    });

    test('returns ExcelResponseHandler when parsedArgs._format is excel', () => {
        const result = ResponseHandlerFactory.create({
            res: mockRes,
            requestId,
            requestInfo: { accept: 'application/json' },
            parsedArgs: { _format: 'application/vnd.ms-excel' }
        });

        expect(result.type).toBe('excel');
    });

    test('returns JsonResponseHandler by default', () => {
        const result = ResponseHandlerFactory.create({
            res: mockRes,
            requestId,
            requestInfo: { accept: 'application/json' },
            parsedArgs: { _format: undefined }
        });

        expect(result.type).toBe('json');
        expect(result.opts).toEqual({ response: mockRes, requestId });
    });

    test('returns JsonResponseHandler when accept is fhir+json', () => {
        const result = ResponseHandlerFactory.create({
            res: mockRes,
            requestId,
            requestInfo: { accept: 'application/fhir+json' },
            parsedArgs: { _format: 'application/fhir+json' }
        });

        expect(result.type).toBe('json');
    });

    test('csv accept takes priority over excel format', () => {
        const result = ResponseHandlerFactory.create({
            res: mockRes,
            requestId,
            requestInfo: { accept: 'text/csv' },
            parsedArgs: { _format: 'application/vnd.ms-excel' }
        });

        expect(result.type).toBe('csv');
    });
});
