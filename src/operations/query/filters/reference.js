const {referenceQueryBuilder} = require('../../../utils/querybuilder.util');

/**
 * Filters by reference
 * https://www.hl7.org/fhir/search.html#reference
 * @param {SearchParameterDefinition} propertyObj
 * @param {string | string[]} queryParameterValue
 * @param {Set} columns
 * @return {import('mongodb').Filter<import('mongodb').DefaultSchema>[]}
 */
function filterByReference({propertyObj, queryParameterValue, columns}) {
    /**
     * @type {Object[]}
     */
    const and_segments = [];
    if (propertyObj.target.length === 1) {
        // handle simple case without an OR to keep it simple
        /**
         * @type {string}
         */
        const target = propertyObj.target[0];
        if (propertyObj.fields && Array.isArray(propertyObj.fields)) {
            and_segments.push(
                {
                    $or: propertyObj.fields.map((field1) =>
                        referenceQueryBuilder({
                                target_type: target,
                                target: queryParameterValue.includes('/') ? queryParameterValue
                                    : `${target}/` + queryParameterValue,
                                field: `${field1}.reference`,
                            }
                        )
                    ),
                },
            );
        } else {
            and_segments.push(
                referenceQueryBuilder(
                    {
                        target_type: target,
                        target: queryParameterValue.includes('/') ? queryParameterValue
                            : `${target}/` + queryParameterValue,
                        field: `${propertyObj.field}.reference`
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
            const target = propertyObj.target[0];
            and_segments.push(
                referenceQueryBuilder(
                    {
                        target_type: target,
                        target: queryParameterValue,
                        field: field
                    }
                )
            );
        } else {
            // else search for these ids in all the target resources
            and_segments.push(
                {
                    $or: propertyObj.target.map((target1) =>
                        referenceQueryBuilder({
                                target_type: target1,
                                target: queryParameterValue.includes('/') ? queryParameterValue
                                    : `${target1}/` + queryParameterValue,
                                field: `${field}`,
                            }
                        )
                    ),
                },
            );
        }
    }
    columns.add(propertyObj.fields ? `${propertyObj.fields.map(f => `${f}.reference`)}` : `${propertyObj.field}.reference`);
    return and_segments;
}

module.exports = {
    filterByReference
};
