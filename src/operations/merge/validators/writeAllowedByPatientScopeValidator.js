const { BaseValidator } = require('./baseValidator');
const { assertTypeEquals } = require('../../../utils/assertType');
const { PatientScopeManager } = require('../../common/patientScopeManager');

class WriteAllowedByPatientScopeValidator extends BaseValidator {
    /**
     * Checks whether write is allowed for given resources based on patient scope
     * @param {PatientScopeManager} patientScopeManager
     */
    constructor ({
        patientScopeManager
                }) {
        super();

        this.patientScopeManager = patientScopeManager;
        assertTypeEquals(patientScopeManager, PatientScopeManager);
    }

    /**
     * @param {FhirRequestInfo} requestInfo
     * @param {date} currentDate
     * @param {string} currentOperationName
     * @param {Resource|Resource[]} incomingResources
     * @param {string} base_version
     * @returns {Promise<{preCheckErrors: MergeResultEntry[], validatedObjects: Resource[], wasAList: boolean}>}
     */
    async validate ({ requestInfo, currentDate, currentOperationName, incomingResources, base_version }) {
        return { validatedObjects: incomingResources, preCheckErrors: [], wasAList: false };
    }
}

module.exports = {
    WriteAllowedByPatientScopeValidator
};
