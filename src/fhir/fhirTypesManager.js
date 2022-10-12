const dataElementsJson = require('../fhir/generator/json/definitions.json/dataelements.json');
const {getFirstElementOrNull} = require('../utils/list.util');

class FhirTypesManager {
    /**
     * gets type of field in resource
     * @param {string} resourceType
     * @param {string} field
     * @return {string|null}
     */
    getTypeForField({resourceType, field}) {

        /**
         * @type {Object[]}
         */
        const dataElements = dataElementsJson.entry;
        const dataElementEntry = getFirstElementOrNull(
            dataElements.filter(d => d.resource.id === `${resourceType}.${field}`).map(d => d.resource)
        );
        if (dataElementEntry) {
            const dataTypeElement = getFirstElementOrNull(dataElementEntry.element);
            /**
             * @type {{code: string}|null}
             */
            const dataType = getFirstElementOrNull(dataTypeElement.type);
            return dataType.code;
        }

        return null;
    }
}


module.exports = {
    FhirTypesManager
};
