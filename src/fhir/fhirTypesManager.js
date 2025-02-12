const dataElementsJson = require('../fhir/generator/json/fhir-generated.field-types.json');
const dataElementMap = new Map(Object.entries(dataElementsJson));
const customDataElementsMap = new Map([
    [
        'ExportStatus.status',
        {
            code: 'code'
        }
    ]
]);

const combinedDataElementsMap = new Map([...dataElementMap, ...customDataElementsMap]);

class FhirTypesManager {
    /**
     * gets type of field in resource
     * @typedef {Object} GetTypeForFieldProps
     * @property {string} resourceType
     * @property {string} field
     *
     * @param {GetTypeForFieldProps}
     * @return {string|null}
     */
    getTypeForField ({ resourceType, field }) {
        const resourceAndField = `${resourceType}.${field}`;
        const dataType = combinedDataElementsMap.get(resourceAndField);
        return dataType && dataType.code;
    }

    /**
     * get data of field in resource
     * @typedef {Object} GetDataForFieldProps
     * @property {string} resourceType
     * @property {string} field
     *
     * @param {GetDataForFieldProps}
     * @returns {{code: string, min: number, max: string}}
     */
    getDataForField ({ resourceType, field }) {
        const resourceAndField = `${resourceType}.${field}`;
        const dataType = dataElementMap.get(resourceAndField);
        return dataType;
    }
}

module.exports = {
    FhirTypesManager
};
