const {dateQueryBuilder, dateQueryBuilderNative, datetimePeriodQueryBuilder} = require('../../../utils/querybuilder.util');
const {isColumnDateType} = require('../../common/isColumnDateType');
const { getIndexHints } = require('../../common/getIndexHints');

function isPeriodField(fieldString) {
    return fieldString === 'period' || fieldString === 'effectivePeriod';
}

/**
 * filters by date
 * https://www.hl7.org/fhir/search.html#date
 * @param {ParsedArgsItem} parsedArg
 * @param {SearchParameterDefinition} propertyObj
 * @param {string} resourceType
 * @param {Set} columns
 * @returns {import('mongodb').Filter<import('mongodb').DefaultSchema>[]}
 */
function filterByDateTime({parsedArg, propertyObj, resourceType, columns}) {
        /**
     * @type {string[]}
     */
    const queryParameterValues = parsedArg.queryParameterValue.values;
    /**
     * @type {Object[]}
     */
    const and_segments = [];
    for (const dateQueryItem of queryParameterValues) {
        // prettier-ignore
        // eslint-disable-next-line security/detect-object-injection
        const isDateSearchingPeriod = isPeriodField(propertyObj.field);
        if (isDateSearchingPeriod) {
            and_segments.push(
                ...datetimePeriodQueryBuilder({ dateQueryItem, fieldName: propertyObj.field })
            );
        } else if (propertyObj.fields) {
            // if there are multiple fields
            and_segments.push(
                {
                    $or: propertyObj.fields.map((f) => {
                        return isPeriodField(f) ?
                            { $and: datetimePeriodQueryBuilder({ dateQueryItem, fieldName: f }) } :
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
    getIndexHints(columns, propertyObj);
    return and_segments;
}

module.exports = {
    filterByDateTime,
};
