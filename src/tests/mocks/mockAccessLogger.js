const { AccessLogger } = require('../../utils/accessLogger');

class MockAccessLogger extends AccessLogger {
    /**
     * Logs a FHIR operation
     * @param {FhirRequestInfo} requestInfo
     * @param {number|null} startTime
     * @param {number|null|undefined} [stopTime]
     * @param {string|undefined} [query]
     * @param {string|undefined} [result]
     */
    async logAccessLogAsync ({
        req,
        statusCode,
        startTime,
        stopTime = Date.now(),
        query,
        result
    }) {
        // do nothing
    }
}

module.exports = {
    MockAccessLogger
};
