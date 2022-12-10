const {searchParameterQueries} = require('../../searchParameters/searchParameters');
const {removeDuplicatesWithLambda} = require('../../utils/list.util');

/**
 * This class provides helper functions for dealing with resources
 */
class ResourceManager {
    /**
     */
    constructor() {
    }

    /**
     * Gets name of the patient field from resource
     * @param {string} resourceType
     * @return {string|null}
     */
    getPatientFieldNameFromResource(resourceType) {
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
    async getPatientIdFromResourceAsync(resourceType, resource) {
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
     * generates a full url for an entity
     * @param {string} protocol
     * @param {string} host
     * @param {string} base_version
     * @param {Resource} resource
     * @return {string}
     */
    getFullUrlForResource({protocol, host, base_version, resource}) {
        return `${protocol}://${host}/${base_version}/${resource.resourceType}/${resource.id}`;
    }

    /**
     * Removes duplicate resources
     * @param {Resource[]} resources
     * @return {Resource[]}
     */
    removeDuplicateResources({resources}) {
        if (resources.length === 0) {
            return resources;
        }
        return removeDuplicatesWithLambda(resources,
            (a, b) => a.resourceType === b.resourceType && a.id === b.id
        );
    }
}

module.exports = {
    ResourceManager
};

