/**
 * Filters by string
 * https://www.hl7.org/fhir/search.html#string
 * @param {string | string[]} queryParameterValue
 * @param {import('../../common/types').SearchParameterDefinition} propertyObj
 * @param {Set} columns
 * @param {boolean} negation
 * @return {Object[]}
 */
const {negateQueryIfNegation, negateEqualsIfNegation} = require('../../../utils/mongoNegator');

function filterByString({queryParameterValue, propertyObj, columns, negation}) {
    /**
     * @type {Object[]}
     */
    const and_segments = [];
    if (Array.isArray(queryParameterValue)) {
        // if array is passed then check in array
        if (propertyObj.fields) {
            if (negation) {
                and_segments.push({
                    $and: propertyObj.fields.map((f) => {
                        return {
                            [`${f}`]: {
                                $nin: queryParameterValue
                            }
                        };
                    }),
                });
            } else {
                and_segments.push({
                    $or: propertyObj.fields.map((f) => {
                        return {
                            [`${f}`]: {
                                $in: queryParameterValue
                            }
                        };
                    }),
                });

            }
            columns.add(`${propertyObj.fields}`);
        } else {
            and_segments.push({
                [`${propertyObj.field}`]: negateQueryIfNegation({
                    query: {
                        $in: queryParameterValue,
                    }, negation
                }),
            });
            columns.add(`${propertyObj.field}`);
        }
    } else if (queryParameterValue.includes(',')) {
        // see if this is a comma separated list
        const value_list = queryParameterValue.split(',');

        if (propertyObj.fields) {
            if (negation) {
                and_segments.push({
                    $and: propertyObj.fields.map((f) => {
                        return {
                            [`${f}`]: {
                                $nin: value_list
                            }
                        };
                    }),
                });
            } else {
                and_segments.push({
                    $or: propertyObj.fields.map((f) => {
                        return {
                            [`${f}`]: {
                                $in: value_list
                            }
                        };
                    }),
                });

            }
            columns.add(`${propertyObj.fields}`);
        } else {
            and_segments.push({
                [`${propertyObj.field}`]: negateQueryIfNegation({
                    query: {
                        $in: value_list,
                    }, negation
                }),
            });
            columns.add(`${propertyObj.field}`);
        }
    } else if (propertyObj.fields) {
        if (negation) {
            and_segments.push({
                $and: propertyObj.fields.map((f) => {
                    return {
                        [`${f}`]: {$ne: queryParameterValue}
                    };
                }),
            });
        } else {
            and_segments.push({
                $or: propertyObj.fields.map((f) => {
                    return {
                        [`${f}`]: queryParameterValue
                    };
                }),
            });

        }
        columns.add(`${propertyObj.fields}`);
    } else {
        and_segments.push({
            [`${propertyObj.field}`]: negateEqualsIfNegation({value: queryParameterValue, negation}),
        });
        columns.add(`${propertyObj.field}`);
    }
    return and_segments;
}

module.exports = {
    filterByString
};
