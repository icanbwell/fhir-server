const { AccessLogger } = require('../../../utils/accessLogger');

class MockedAccessLogger extends AccessLogger {
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
        /** @type {FhirRequestInfo} */ requestInfo,
        args,
        resourceType,
        startTime,
        stopTime = Date.now(),
        message,
        action,
        error,
        query,
        result
    }) {
    }
}

module.exports = {
    MockedAccessLogger
};
