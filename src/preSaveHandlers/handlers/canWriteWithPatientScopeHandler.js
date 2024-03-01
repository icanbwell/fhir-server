const { PreSaveHandler } = require('./preSaveHandler');
const { ForbiddenError } = require('../../utils/httpErrors');
const { assertTypeEquals } = require('../../utils/assertType');
const { PatientScopeManager } = require('../../operations/common/patientScopeManager');

class CanWriteWithPatientScopeHandler extends PreSaveHandler {
    /**
     * checks whether we can write this resource based on patient scope
     * @param {PatientScopeManager} patientScopeManager
     */
    constructor (
        {
            patientScopeManager
        }
    ) {
        super();

        /** @type {PatientScopeManager} */
        this.patientScopeManager = patientScopeManager;
        assertTypeEquals(patientScopeManager, PatientScopeManager);
    }

    /**
     * fixes up any resources before they are saved
     * @param {string} base_version
     * @param {FhirRequestInfo} requestInfo
     * @param {Resource} resource
     * @returns {Promise<Resource>}
     */
    // eslint-disable-next-line no-unused-vars
    async preSaveAsync ({ base_version, requestInfo, resource }) {
        const {
            scope,
            isUser,
            method,
            patientIdsFromJwtToken,
            personIdFromJwtToken
        } = requestInfo;
        const resources = Array.isArray(requestInfo.body) ? requestInfo.body : [requestInfo.body]

        // Bypassing patient scope check when AuditEvent is created via audit logger.
        if (
            resource.resourceType === 'AuditEvent' &&
            !resources.some(r => r.resourceType === 'AuditEvent') &&
            method === 'GET'
        ) {
            return resource;
        }

        if (!(await this.patientScopeManager.canWriteResourceAsync({
            base_version,
            resource,
            scope,
            isUser,
            patientIdsFromJwtToken,
            personIdFromJwtToken
        }))) {
            throw new ForbiddenError(
                'The current patient scope and person id in the JWT token do not allow writing this resource.'
            );
        }

        return resource;
    }
}

module.exports = {
    CanWriteWithPatientScopeHandler
};
