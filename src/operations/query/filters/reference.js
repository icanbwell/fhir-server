const {referenceQueryBuilder} = require('../../../utils/querybuilder.util');

/**
 * Filters by reference
 * https://www.hl7.org/fhir/search.html#reference
 * @param {import('../common/types').SearchParameterDefinition} propertyObj
 * @param {Object[]} and_segments
 * @param {string | string[]} queryParameterValue
 * @param {Set} columns
 */
function filterByReference(propertyObj, and_segments, queryParameterValue, columns) {
    if (propertyObj.target.length === 1) {
        // handle simple case without an OR to keep it simple
        const target = propertyObj.target[0];
        if (propertyObj.fields && Array.isArray(propertyObj.fields)) {
            and_segments.push({
                $or: propertyObj.fields.map((field1) =>
                    referenceQueryBuilder(
                        queryParameterValue.includes('/') ? queryParameterValue
                            : `${target}/` + queryParameterValue,
                        `${field1}.reference`,
                        null
                    )
                ),
            });
        } else {
            and_segments.push(
                referenceQueryBuilder(
                    queryParameterValue.includes('/') ? queryParameterValue
                        : `${target}/` + queryParameterValue,
                    `${propertyObj.field}.reference`,
                    null
                )
            );
        }
    } else {
        // handle multiple targets
        // if resourceType is specified then search for only those resources
        if (queryParameterValue.includes('/')) {
            and_segments.push(
                referenceQueryBuilder(
                    queryParameterValue,
                    `${propertyObj.field}.reference`,
                    null
                )
            );
        } else {
            // else search for these ids in all the target resources
            and_segments.push({
                $or: propertyObj.target.map((target1) =>
                    referenceQueryBuilder(
                        queryParameterValue.includes('/') ? queryParameterValue
                            : `${target1}/` + queryParameterValue,
                        `${propertyObj.field}.reference`,
                        null
                    )
                ),
            });
        }
    }
    columns.add(`${propertyObj.field}.reference`);
}

module.exports = {
    filterByReference: filterByReference
};
