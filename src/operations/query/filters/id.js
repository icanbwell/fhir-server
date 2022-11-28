/**
 * Filters by id
 * https://www.hl7.org/fhir/search.html#id
 * @param {string | string[]} queryParameterValue
 * @param {import('../../common/types').SearchParameterDefinition} propertyObj
 * @param {Set} columns
 * @param {boolean|undefined} isHistoryCollection
 * @return {Object[]}
 */
function filterById({queryParameterValue, propertyObj, columns, isHistoryCollection}) {
    /**
     * @type {Object[]}
     */
    const and_segments = [];
    if (Array.isArray(queryParameterValue)) {
        // if array is passed then check in array
        if (isHistoryCollection) {
            and_segments.push(
                {
                    $or: [
                        {
                            [`${propertyObj.field}`]: {
                                $in: queryParameterValue,
                            }
                        },
                        {
                            [`resource.${propertyObj.field}`]: {
                                $in: queryParameterValue,
                            }
                        },
                    ]
                });
        } else {
            and_segments.push({
                [`${propertyObj.field}`]: {
                    $in: queryParameterValue,
                },
            });
        }
    } else if (queryParameterValue.includes(',')) {
        // see if this is a comma separated list
        const value_list = queryParameterValue.split(',');
        if (isHistoryCollection) {
            and_segments.push(
                {
                    $or: [
                        {
                            [`${propertyObj.field}`]: {
                                $in: value_list,
                            }
                        }, {
                            [`resource.${propertyObj.field}`]: {
                                $in: value_list,
                            },
                        }
                    ]
                }
            );
        } else {
            and_segments.push({
                [`${propertyObj.field}`]: {
                    $in: value_list,
                },
            });
        }

    } else {
        // single value is passed
        if (isHistoryCollection) {
            and_segments.push({
                $or: [
                    {
                        [`${propertyObj.field}`]: queryParameterValue,
                    },
                    {
                        [`resource.${propertyObj.field}`]: queryParameterValue,
                    },
                ]
            });

        } else {
            and_segments.push({
                [`${propertyObj.field}`]: queryParameterValue,
            });
        }

    }
    columns.add(`${propertyObj.field}`);
    return and_segments;
}

module.exports = {
    filterById
};
