const { GetMasterPatientUsageDataRunner } = require('./getMasterPatientUsageDataRunner');

class GetProxyPatientUsageDataRunner extends GetMasterPatientUsageDataRunner {
    /**
     * Gets master patient uuids into masterPatientUuids set
     * @returns {Promise<void>}
     */
    async getMasterPatientUuids () {
        // No need to implement
    }

    /**
     * Checks if the reference has proxyPatient reference
     * @typedef {Object} HasUsageProps
     * @property {import('../../fhir/classes/4_0_0/complex_types/reference')} reference
     *
     * @param {HasUsageProps}
     * @returns {Boolean}
     */
    hasUsage ({ reference }) {
        // skip invalid references
        if (!reference.reference) {
            return false;
        }
        return reference.reference.startsWith('Patient/person.');
    }
}

module.exports = { GetProxyPatientUsageDataRunner };
