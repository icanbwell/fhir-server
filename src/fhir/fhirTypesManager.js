const dataElementsJson = require('../fhir/generator/json/definitions.json/dataelements.json');
const dataElementMap = new Map(dataElementsJson.entry.map(i =>
        [
            i.resource.id,
            {
                code: i.resource.element[0].type ? i.resource.element[0].type[0].code : null,
                min: i.resource.element[0].min,
                max: i.resource.element[0].max
            }
        ]
    )
);

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
    getTypeForField ({resourceType, field}) {
        const resourceAndField = `${resourceType}.${field}`;
        const dataType = dataElementMap.get(resourceAndField);
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
    getDataForField ({resourceType, field}) {
        const resourceAndField = `${resourceType}.${field}`;
        const dataType = dataElementMap.get(resourceAndField);
        return dataType;
    }
}

module.exports = {
    FhirTypesManager
};
