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
     * @param {string|null} scope
     * @param {string|null} user
     * @param {string|null} path
     * @param {date} currentDate
     * @param {Resource|Resource[]} incomingResources
     * @param {string} requestId
     * @param {string} base_version
     * @returns {Promise<{preCheckErrors: MergeResultEntry[], validatedObjects: Resource[], wasAList: boolean}>}
     */
    async validate (
        {
            scope,
            user,
            path,
            currentDate,
            incomingResources,
            requestId,
            base_version
        }
        ) {
        return { validatedObjects: incomingResources, preCheckErrors: [], wasAList: false };
    }
}

module.exports = {
    WriteAllowedByPatientScopeValidator
};
