const {searchParameterQueries} = require('../../searchParameters/searchParameters');
const {ChangeEventProducer} = require('../../utils/changeEventProducer');
const moment = require('moment-timezone');

/**
 * This class provides helper functions for dealing with resources
 */
class ResourceManager {
    /**
     * Gets name of the patient field from resource
     * @param {string} resourceType
     * @return {string|null}
     */
    static getPatientFieldNameFromResource(resourceType) {
        if (resourceType === 'Patient') {
            return 'id';
        }
        for (const [resourceType1, resourceObj] of Object.entries(searchParameterQueries)) {
            if (resourceType1 === resourceType) {

                // see if there is a 'patient' property
                for (const [
                    /** @type {string} **/ queryParameter,
                    /** @type {import('../common/types').SearchParameterDefinition} **/ propertyObj,
                ] of Object.entries(resourceObj)) {
                    if (queryParameter === 'patient') {
                        return propertyObj.field;
                    }
                }
            }
        }
        return null;
    }

    /**
     * gets the value of patient id from this resource
     * @param {string} resourceType
     * @param {Resource} resource
     * @return {Promise<string|null>}
     */
    static async getPatientIdFromResourceAsync(resourceType, resource) {
        /**
         * @type {string|null}
         */
        const patientFieldName = this.getPatientFieldNameFromResource(resourceType);
        if (!patientFieldName) {
            return null;
        }
        /**
         * @type {string}
         */
        const patientReference = resource[`${patientFieldName}`];
        if (!patientReference) {
            return null;
        }
        if (patientReference.reference) {
            return patientReference.reference.replace('Patient/', '');
        } else {
            return patientReference;
        }
    }

    /**
     * Fires events when a resource is changed
     * @param {string} requestId
     * @param {string} eventType.  Can be C = create or U = update
     * @param {string} resourceType
     * @param {Resource} doc
     * @return {Promise<void>}
     */
    static async fireEventsAsync(requestId, eventType, resourceType, doc) {
        /**
         * @type {string|null}
         */
        const patientId = await ResourceManager.getPatientIdFromResourceAsync(resourceType, doc);
        /**
         * @type {ChangeEventProducer}
         */
        const changeEventProducer = new ChangeEventProducer();
        /**
         * @type {string}
         */
        const currentDate = moment.utc().format('YYYY-MM-DD');
        if (eventType === 'C' && resourceType === 'Patient') {
            await changeEventProducer.onPatientCreateAsync(requestId, patientId, currentDate);
        } else {
            await changeEventProducer.onPatientChangeAsync(requestId, patientId, currentDate);
        }
    }
}

module.exports = {
    ResourceManager
};

