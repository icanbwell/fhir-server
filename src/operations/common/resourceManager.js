const {searchParameterQueries} = require('../../searchParameters/searchParameters');

class ResourceManager {
    /**
     * Gets patient field from resource
     * @param {string} resourceType
     * @return {string|*}
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
     * get
     * @param {string} resourceType
     * @param {string} resource
     */
    static async getPatientIdFromResourceAsync(resourceType, resource) {
        const patientFieldName = this.getPatientFieldNameFromResource(resourceType);
        if (!patientFieldName) {
            return null;
        }
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
}

module.exports = {
    ResourceManager
};

