const { dateQueryBuilder, dateQueryBuilderNative } = require('../../../utils/querybuilder.util');
const { isColumnDateType } = require('../../common/isColumnDateType');
const { searchParameterQueries } = require('../../../searchParameters/searchParameters');
const { fhirFilterTypes } = require('../customQueries');

function isPeriodField(fieldString) {
    return fieldString === 'period' || fieldString === 'effectivePeriod';
}

/**
 * filters by date
 * https://www.hl7.org/fhir/search.html#date
 * @param {string | string[]} queryParameterValue
 * @param {import('../common/types').SearchParameterDefinition} propertyObj
 * @param {Object[]} and_segments
 * @param {string} resourceName
 * @param {Set} columns
 * @returns {*[]}
 */
function filterByDateTime(queryParameterValue, propertyObj, and_segments, resourceName, columns) {
    if (!Array.isArray(queryParameterValue)) {
        queryParameterValue = [queryParameterValue];
    }
    for (const dateQueryItem of queryParameterValue) {
        // prettier-ignore
        // eslint-disable-next-line security/detect-object-injection
        const resourceSearch = searchParameterQueries[resourceName];
        const hasDateParam = resourceSearch[fhirFilterTypes.date];
        const isDateSearchingPeriod = hasDateParam ? isPeriodField(hasDateParam['field']) : false;
        const dateRangeSegments = (fieldName, appendArray) => {
            const rangeArray = appendArray ? appendArray : [];
            rangeArray.push({
                [`${fieldName}.start`]: dateQueryBuilder(
                    `le${dateQueryItem.slice(2)}`,
                    propertyObj.type,
                    ''
                ),
            });
            rangeArray.push({
                [`${fieldName}.end`]: dateQueryBuilder(
                    `ge${dateQueryItem.slice(2)}`,
                    propertyObj.type,
                    ''
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
            and_segments.push({
                $or: propertyObj.fields.map((f) => {
                    return isPeriodField(f)
                        ? { $and: dateRangeSegments('effectivePeriod', null) }
                        : {
                              [`${f}`]: dateQueryBuilder(dateQueryItem, propertyObj.type, ''),
                          };
                }),
            });
        } else if (
            propertyObj.field === 'meta.lastUpdated' ||
            isColumnDateType(resourceName, propertyObj.field)
        ) {
            // if this of native Date type
            // this field stores the date as a native date, so we can do faster queries
            and_segments.push({
                [`${propertyObj.field}`]: dateQueryBuilderNative(
                    dateQueryItem,
                    propertyObj.type,
                    ''
                ),
            });
        } else {
            // if this is date as a string
            and_segments.push({
                [`${propertyObj.field}`]: dateQueryBuilder(dateQueryItem, propertyObj.type, ''),
            });
        }
    }
    columns.add(`${propertyObj.field}`);
    return queryParameterValue;
}

module.exports = {
    filterByDateTime: filterByDateTime,
};
