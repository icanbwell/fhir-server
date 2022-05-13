const { dateQueryBuilder, dateQueryBuilderNative } = require('../../../utils/querybuilder.util');
const { isColumnDateType } = require('../../common/isColumnDateType');
const { searchParameterQueries } = require('../../../searchParameters/searchParameters');
const { fhirFilterTypes } = require('../customQueries');

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
        const isDateSearchingPeriod = hasDateParam ? hasDateParam['field'] === 'period' : false;
        if (isDateSearchingPeriod) {
            and_segments.push({
                ['period.start']: dateQueryBuilder(
                    `le${dateQueryItem.slice(2)}`,
                    propertyObj.type,
                    ''
                )
            });
            and_segments.push({
                ['period.end']: dateQueryBuilder(
                    `ge${dateQueryItem.slice(2)}`,
                    propertyObj.type,
                    ''
                )
            });
        } else if (propertyObj.fields) {
            // if there are multiple fields
            and_segments.push({
                $or: propertyObj.fields.map((f) => {
                    return {
                        [`${f}`]: dateQueryBuilder(dateQueryItem, propertyObj.type, '')
                    };
                })
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
                )
            });
        } else {
            // if this is date as a string
            and_segments.push({
                [`${propertyObj.field}`]: dateQueryBuilder(dateQueryItem, propertyObj.type, '')
            });
        }
    }
    columns.add(`${propertyObj.field}`);
    return queryParameterValue;
}

module.exports = {
    filterByDateTime: filterByDateTime
};
