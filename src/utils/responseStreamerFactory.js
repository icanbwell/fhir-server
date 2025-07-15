// filepath: /Users/imranqureshi/git/fhir-server/src/utils/responseStreamerFactory.js
const {FhirResponseStreamer} = require('./fhirResponseStreamer');
const {FhirResponseCsvStreamer} = require('./fhirResponseCsvStreamer');
const {FhirResponseExcelStreamer} = require('./fhirResponseExcelStreamer');
const {hasCsvContentType, hasExcelContentType} = require('./contentTypes');

class ResponseStreamerFactory {
    /**
     * Chooses the appropriate response streamer based on content type
     * @param {Object} params
     * @param {import('express').Response} params.res
     * @param {string} params.requestId
     * @param {Object} params.requestInfo
     * @param {Object} params.parsedArgs
     * @returns {BaseResponseStreamer}
     */
    static create({res, requestId, requestInfo, parsedArgs}) {
        if (hasCsvContentType(requestInfo.accept) || hasCsvContentType(parsedArgs._format)) {
            return new FhirResponseCsvStreamer({response: res, requestId});
        } else if (hasExcelContentType(requestInfo.accept) || hasExcelContentType(parsedArgs._format)) {
            return new FhirResponseExcelStreamer({response: res, requestId});
        } else {
            return new FhirResponseStreamer({response: res, requestId});
        }
    }
}

module.exports = { ResponseStreamerFactory };
