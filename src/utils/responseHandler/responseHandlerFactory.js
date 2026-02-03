const { hasCsvContentType, hasExcelContentType } = require('../contentTypes');
const { BaseResponseHandler } = require('./baseResponseHandler');
const { CsvResponseHandler } = require('./csvResponseHandler');
const { ExcelResponseHandler } = require('./excelResponseHandler');
const { JsonResponseHandler } = require('./jsonResponseHandler');

class ResponseHandlerFactory {
    /**
     * Chooses the appropriate response handler based on content type
     * @param {Object} params
     * @param {import('express').Response} params.res
     * @param {string} params.requestId
     * @param {Object} params.requestInfo
     * @param {Object} params.parsedArgs
     * @returns {BaseResponseHandler}
     */
    static create({ res, requestId, requestInfo, parsedArgs }) {
        if (hasCsvContentType(requestInfo.accept) || hasCsvContentType(parsedArgs._format)) {
            return new CsvResponseHandler({ response: res, requestId });
        } else if (hasExcelContentType(requestInfo.accept) || hasExcelContentType(parsedArgs._format)) {
            return new ExcelResponseHandler({ response: res, requestId });
        } else {
            return new JsonResponseHandler({ response: res, requestId });
        }
    }
}

module.exports = { ResponseHandlerFactory };
