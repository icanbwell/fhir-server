const { AuditLogger } = require('../../utils/auditLogger');

class MockAuditLogger extends AuditLogger {
    /**
     * logs an entry for audit
     * @param {FhirRequestInfo} requestInfo
     * @param {string} resourceType
     * @param {string} base_version
     * @param {string} operation
     * @param {Object} args
     * @param {string[]} ids
     * @return {Promise<void>}
     */
    async logAuditEntryAsync({ requestInfo, base_version, resourceType, operation, args, ids }) {
        // do nothing
    }

    /**
     * Logs an error audit entry
     * @param {Object} params
     * @param {import('./fhirRequestInfo').FhirRequestInfo} params.requestInfo
     * @param {string|null} params.resourceType
     * @param {number} params.errorCode
     * @param {string} params.errorMessage
     * @param {{type: string, valueString: string}[]} [params.extraParams]
     * @return {Promise<void>}
     */
    async logErrorAuditEntryAsync({
        requestInfo,
        resourceType,
        errorCode,
        errorMessage,
        extraParams
    }) {
        // do nothing
    }
}

module.exports = {
    MockAuditLogger
};
