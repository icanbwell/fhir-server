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
}

module.exports = {
    MockAuditLogger
};
