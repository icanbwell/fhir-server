const {assertTypeEquals} = require('../utils/assertType');
const {EverythingOperation} = require('../operations/everything/everything');
const {FhirOperationsManager} = require('../operations/fhirOperationsManager');

const base_version = '4_0_0';

class AdminPersonPatientDataManager {

    /**
     * constructor
     * @param {FhirOperationsManager} fhirOperationsManager
     * @param {EverythingOperation} everythingOperation
     */
    constructor(
        {
            fhirOperationsManager,
            everythingOperation
        }
    ) {
        /**
         * @type {FhirOperationsManager}
         */
        this.fhirOperationsManager = fhirOperationsManager;
        assertTypeEquals(fhirOperationsManager, FhirOperationsManager);
        /**
         * @type {EverythingOperation}
         */
        this.everythingOperation = everythingOperation;
        assertTypeEquals(everythingOperation, EverythingOperation);
    }

    /**
     * @description Gets the patient data graph
     * @param {import('http').IncomingMessage} req
     * @param {string} patientId
     * @return {Promise<Bundle>}
     */
    async showPatientDataGraphAsync({req, patientId}) {
        const requestInfo = this.fhirOperationsManager.getRequestInfo(req);
        requestInfo.method = 'GET';
        return await this.everythingOperation.everything(requestInfo, {
            'base_version': base_version,
            'contained': true,
            'id': patientId
        }, 'Patient');
    }

    /**
     * @description Deletes the patient data graph
     * @param {import('http').IncomingMessage} req
     * @param {string} patientId
     * @return {Promise<Bundle>}
     */
    async deletePatientDataGraphAsync({req, patientId}) {
        const requestInfo = this.fhirOperationsManager.getRequestInfo(req);
        requestInfo.method = 'DELETE';
        return await this.everythingOperation.everything(requestInfo, {
            'base_version': base_version,
            'id': patientId
        }, 'Patient');
    }

    /**
     * @description Shows the person data graph
     * @param {import('http').IncomingMessage} req
     * @param {string} personId
     * @return {Promise<Bundle>}
     */
    async showPersonDataGraphAsync({req, personId}) {
        const requestInfo = this.fhirOperationsManager.getRequestInfo(req);
        requestInfo.method = 'GET';
        return await this.everythingOperation.everything(requestInfo, {
            'base_version': base_version,
            'contained': true,
            'id': personId
        }, 'Person');
    }

    /**
     * @description deletes the person data graph
     * @param {import('http').IncomingMessage} req
     * @param {string} personId
     * @return {Promise<Bundle>}
     */
    async deletePersonDataGraphAsync({req, personId}) {
        const requestInfo = this.fhirOperationsManager.getRequestInfo(req);
        requestInfo.method = 'DELETE';
        return await this.everythingOperation.everything(requestInfo, {
            'base_version': base_version,
            'id': personId
        }, 'Person');
    }
}

module.exports = {
    AdminPersonPatientDataManager
};
