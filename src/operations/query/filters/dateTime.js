const {dateQueryBuilder, dateQueryBuilderNative} = require('../../../utils/querybuilder.util');
const {isColumnDateType} = require('../../common/isColumnDateType');

function isPeriodField(fieldString) {
    return fieldString === 'period' || fieldString === 'effectivePeriod';
}

/**
 * filters by date
 * https://www.hl7.org/fhir/search.html#date
 * @param {string | string[]} queryParameterValue
 * @param {import('../../common/types').SearchParameterDefinition} propertyObj
 * @param {string} resourceType
 * @param {Set} columns
 * @returns {Object[]}
 */
function filterByDateTime({queryParameterValue, propertyObj, resourceType, columns}) {
    /**
     * @type {Object[]}
     */
    const and_segments = [];
    if (!Array.isArray(queryParameterValue)) {
        queryParameterValue = [queryParameterValue];
    }
    if (queryParameterValue.join('').trim() === '') {
        return [];
    }
    for (const dateQueryItem of queryParameterValue) {
        // prettier-ignore
        // eslint-disable-next-line security/detect-object-injection
        const isDateSearchingPeriod = isPeriodField(propertyObj.field);
        const dateRangeSegments = (fieldName, appendArray) => {
            const alphaLength = dateQueryItem.replace(/[^a-z]/gi, '').length;
            const rangeArray = appendArray ? appendArray : [];
            rangeArray.push({
                [`${fieldName}.start`]: dateQueryBuilder(
                    {
                        date: `le${dateQueryItem.slice(alphaLength)}`,
                        type: propertyObj.type,
                    }
                ),
            });
            rangeArray.push({
                [`${fieldName}.end`]: dateQueryBuilder(
                    {
                        date: `ge${dateQueryItem.slice(alphaLength)}`,
                        type: propertyObj.type,
                    }
                ),
            });
            if (!appendArray) {
                return rangeArray;
            }
        };
        if (isDateSearchingPeriod) {
            dateRangeSegments('period', and_segments);
        } else if (propertyObj.fields) {
            // if there are multiple fields
            and_segments.push(
                {
                    $or: propertyObj.fields.map((f) => {
                        return isPeriodField(f) ?
                            {$and: dateRangeSegments('effectivePeriod')} :
                            {
                                [`${f}`]: dateQueryBuilder({
                                    date: dateQueryItem, type: propertyObj.type,
                                }),
                            };
                    }),
                }
            );
        } else if (
            propertyObj.field === 'meta.lastUpdated' ||
            isColumnDateType(resourceType, propertyObj.field)
        ) {
            // if this of native Date type
            // this field stores the date as a native date, so we can do faster queries
            and_segments.push({
                [`${propertyObj.field}`]: dateQueryBuilderNative(
                    {
                        dateSearchParameter: dateQueryItem,
                        type: propertyObj.type
                    }
                ),
            });
        } else {
            // if this is date as a string
            and_segments.push({
                [`${propertyObj.field}`]: dateQueryBuilder({
                    date: dateQueryItem, type: propertyObj.type
                }),
            });
        }
    }
    columns.add(`${propertyObj.field}`);
    return and_segments;
}

module.exports = {
    filterByDateTime,
};
