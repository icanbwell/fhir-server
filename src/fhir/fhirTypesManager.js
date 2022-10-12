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
     * @param {string} resourceType
     * @param {string} field
     * @return {string|null}
     */
    getTypeForField({resourceType, field}) {
        const resourceAndField = `${resourceType}.${field}`;
        const dataType = dataElementMap.get(resourceAndField);
        return dataType && dataType.code;
    }
}


module.exports = {
    FhirTypesManager
};
