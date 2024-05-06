const { AccessLogger } = require('../../utils/accessLogger');

class MockAccessLogger extends AccessLogger {
    /**
     * Logs a FHIR operation
     * @param {FhirRequestInfo} requestInfo
     * @param {Object} args
     * @param {string} resourceType
     * @param {number|null} startTime
     * @param {number|null|undefined} [stopTime]
     * @param {string} message
     * @param {string} action
     * @param {Error|undefined} error
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
