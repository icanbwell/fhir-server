const {dateQueryBuilder, dateQueryBuilderNative} = require('../../../utils/querybuilder.util');
const {isColumnDateType} = require('../../common/isColumnDateType');

function isPeriodField(fieldString) {
    return fieldString === 'period' || fieldString === 'effectivePeriod';
}

/**
 * filters by date for a Period
 * https://www.hl7.org/fhir/search.html#date
 * https://www.hl7.org/fhir/search.html#prefix
 * @param {string} dateQueryItem
 * @param {string} fieldName
 * @returns {Object[]}
 */
function datetimePeriodQueryBuilder({ dateQueryItem, fieldName }) {
    // eslint-disable-next-line security/detect-unsafe-regex
    const regex = /([a-z]+)(.+)/;
    const match = dateQueryItem.match(regex);

    const [prefix, date] = (match && match.length >= 1 && match[1]) ?
        [match[1], dateQueryItem.slice(match[1].length)] :
        ['eq', dateQueryItem];

    // Build query for period.start
    let startQuery = {};
    switch (prefix) {
        case 'eq':
        case 'le':
        case 'lt':
            startQuery = dateQueryBuilder({
                date: `le${date}`,
                type: 'date'
            });
            break;
        case 'sa':
            startQuery = dateQueryBuilder({
                date: `ge${date}`,
                type: 'date'
            });
            break;
        case 'ge':
        case 'gt':
        case 'eb':
            startQuery = {
                $ne: null
            };
            break;
    }
    startQuery = { [`${fieldName}.start`]: startQuery };

    // Build query for period.end
    let endQuery = {};
    switch (prefix) {
        case 'eq':
        case 'ge':
        case 'gt':
            endQuery = {
                $or: [
                    {
                        [`${fieldName}.end`]: dateQueryBuilder({
                            date: `ge${date}`,
                            type: 'date'
                        })
                    },
                    {
                        [`${fieldName}.end`]: null
                    }
                ]
            };
            break;
        case 'eb':
            endQuery = {
                [`${fieldName}.end`]: dateQueryBuilder({
                    date: `le${date}`,
                    type: 'date'
                })
            };
            break;
    }

    return [startQuery, endQuery];
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
        if (isDateSearchingPeriod) {
            and_segments.concat(
                datetimePeriodQueryBuilder({ dateQueryItem, fieldName: propertyObj.field })
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
    columns.add(`${propertyObj.field}`);
    return and_segments;
}

module.exports = {
    filterByDateTime,
};
