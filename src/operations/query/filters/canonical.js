/**
 * filters by canonical uri
 * https://www.hl7.org/fhir/search.html#uri
 * @param {import('../../common/types').SearchParameterDefinition} propertyObj
 * @param {string | string[]} queryParameterValue
 * @param {Set} columns
 * @param {boolean} negation
 * @return {Object[]}
 */
const {negateEqualsIfNeeded} = require('../../../utils/mongoNegator');

function filterByCanonical({propertyObj, queryParameterValue, columns, negation}) {
    /**
     * @type {Object[]}
     */
    const and_segments = [];
    // handle simple case without an OR to keep it simple
    if (propertyObj.fields && Array.isArray(propertyObj.fields)) {
        if (negation) {
            and_segments.push({
                $and: propertyObj.fields.map((field1) => {
                        return {
                            [`${field1}`]: {$ne: queryParameterValue},
                        };
                    }
                ),
            });
        } else {
            and_segments.push({
                $or: propertyObj.fields.map((field1) => {
                        return {
                            [`${field1}`]: queryParameterValue,
                        };
                    }
                ),
            });
        }
    } else {
        and_segments.push(
            {
                [`${propertyObj.field}`]: negateEqualsIfNeeded({value: queryParameterValue, negation}),
            }
        );
    }
    columns.add(propertyObj.fields ? `${propertyObj.fields}` : `${propertyObj.field}`);
    return and_segments;
}

module.exports = {
    filterByCanonical
};
