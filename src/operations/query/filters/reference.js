const {referenceQueryBuilder} = require('../../../utils/querybuilder.util');

/**
 * Filters by reference
 * https://www.hl7.org/fhir/search.html#reference
 * @param {import('../common/types').SearchParameterDefinition} propertyObj
 * @param {Object[]} and_segments
 * @param {string | string[]} queryParameterValue
 * @param {Set} columns
 */
function filterByReference({propertyObj, and_segments, queryParameterValue, columns}) {
    if (propertyObj.target.length === 1) {
        // handle simple case without an OR to keep it simple
        const target = propertyObj.target[0];
        if (propertyObj.fields && Array.isArray(propertyObj.fields)) {
            and_segments.push({
                $or: propertyObj.fields.map((field1) =>
                    referenceQueryBuilder({
                            target: queryParameterValue.includes('/') ? queryParameterValue
                                : `${target}/` + queryParameterValue,
                            field: `${field1}.reference`,
                            exists_flag: null
                        }
                    )
                ),
            });
        } else {
            and_segments.push(
                referenceQueryBuilder(
                    {
                        target: queryParameterValue.includes('/') ? queryParameterValue
                            : `${target}/` + queryParameterValue,
                        field: `${propertyObj.field}.reference`,
                        exists_flag: null
                    }
                )
            );
        }
    } else {
        var field = propertyObj.fields ? `${propertyObj.fields[propertyObj.fields.length - 1]}.reference` // set field to 'library' if propertyObj.fields
            : `${propertyObj.field}.reference`;
        // handle multiple targets
        // if resourceType is specified then search for only those resources
        if (queryParameterValue.includes('/')) {
            and_segments.push(
                referenceQueryBuilder(
                    {
                        target: queryParameterValue,
                        field: field,
                        exists_flag: null
                    }
                )
            );
        } else {
            // else search for these ids in all the target resources
            and_segments.push({
                $or: propertyObj.target.map((target1) =>
                    referenceQueryBuilder({
                            target: queryParameterValue.includes('/') ? queryParameterValue
                                : `${target1}/` + queryParameterValue,
                            field: `${field}`,
                            exists_flag: null
                        }
                    )
                ),
            });
        }
    }
    columns.add(propertyObj.fields ? `${propertyObj.fields.map(f => `${f}.reference`)}` : `${propertyObj.field}.reference`);
}

module.exports = {
    filterByReference
};
