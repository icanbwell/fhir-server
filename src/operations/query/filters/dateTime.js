const {
    dateQueryBuilder,
    dateQueryBuilderNative,
    datetimePeriodQueryBuilder,
    datetimeTimingQueryBuilder,
    datetimeApproxString
} = require('../../../utils/querybuilder.util');
const { isColumnDateTimeType } = require('../../common/isColumnDateTimeType');
const { BaseFilter } = require('./baseFilter');
const { isTrue } = require('../../../utils/isTrue');
const { isFalse } = require('../../../utils/isFalse');
const {BadRequestError} = require("../../../utils/httpErrors");

function isPeriodField (fieldString) {
    return fieldString === 'period' || fieldString === 'effectivePeriod' || fieldString === 'executionPeriod';
}

function isTimingField (fieldString) {
    const pattern = /timing/i;
    return pattern.test(fieldString);
}

/**
 * filters by date
 * https://www.hl7.org/fhir/search.html#date
 */
class FilterByDateTime extends BaseFilter {
   /**
     * @param {string} field
     * @param {string} value
     * @return {import('mongodb').Filter<import('mongodb').DefaultSchema>|import('mongodb').Filter<import('mongodb').DefaultSchema>[]}
     */
    filterByItem (field, value) {
        // prettier-ignore
        let strQuery;
        let dateQuery;
        const fieldName = this.fieldMapper.getFieldName(field);
        const isDateSearchingPeriod = isPeriodField(field);
        const isDateSearchingTiming = isTimingField(field);

        // In case of missing modifiers the value could be true/false
        if (isTrue(value) || isFalse(value)) {
            return null;
        }
        if (this.filterType === 'string') {
            if (isDateSearchingPeriod) {
                strQuery = datetimePeriodQueryBuilder(
                    {
                        dateQueryItem: value,
                        fieldName
                    }
                );
            } else if (isDateSearchingTiming) {
                strQuery = datetimeTimingQueryBuilder({
                        dateQueryItem: value,
                        fieldName
                    }
                );
            } else {
                // if this is date as a string
                if (!isColumnDateTimeType(this.resourceType, fieldName)) {
                    const regex = /([a-z]+)(.+)/;
                    const match = value.match(regex);
                    if (match && match[1] && match[1] === 'ap') {
                        const justDate = value.substring(2);
                        const { start, end} = datetimeApproxString({dateQueryItem: justDate})
                        strQuery = {
                            [fieldName]: { $gte: start, $lte: end }
                        }
                    } else {
                        strQuery = {
                            [fieldName]: dateQueryBuilder({
                                date: value, type: this.propertyObj.type
                            })
                        }
                    };
                }
            }
           return strQuery;
        }
        // if this of native Date type
        // this field stores the date as a native date, so we can do faster queries
        if (this.filterType === 'date') {
            if (isColumnDateTimeType(this.resourceType, fieldName)) {
                dateQuery = {
                    [fieldName]: dateQueryBuilderNative(
                        {
                            dateSearchParameter: value,
                            type: this.propertyObj.type
                        }
                    )
                };
            }
            return dateQuery;
        }
      return null;
}

    /**
     * filter function that calls filterByItem for each field and each value supplied
     * @return {import('mongodb').Filter<import('mongodb').DefaultSchema>[]}
     */
    filter () {
        /**
         * @type {import('mongodb').Filter<import('mongodb').DefaultSchema>[]}
         */
        const and_segments = [];

        if (this.parsedArg.queryParameterValue.values) {
            this.filterType = 'string';
            and_segments.push({
                    $or: this.propertyObj.fields.flatMap((field) => {
                            const sq = this.filterByField(field, this.parsedArg.queryParameterValue);
                            if (sq[this.parsedArg.queryParameterValue.operator][0]) {
                                return sq;
                            }
                        }
                    )
                }
            );
            this.filterType = 'date';
            const dateSegments =
                this.propertyObj.fields.flatMap((field) => {
                        const dq = this.filterByField(field, this.parsedArg.queryParameterValue);
                        if (dq[this.parsedArg.queryParameterValue.operator][0]) {
                            return dq;
                        }
                    }
            );
            if (dateSegments && dateSegments.length > 0) {
                and_segments[0].$or = and_segments[0].$or.concat(dateSegments);
            }
        }

        // clean up and_segments, remove undefines
        and_segments[0]['$or'] = and_segments[0]['$or'].filter((query) => {
            if (query) {
                return query;
            }
        });

        return and_segments;
    }

    /**
     * Generate filter for each field
     * @param {string} field
     * @param {import('../queryParameterValue').QueryParameterValue} queryParameterValue
     */
    filterByField (field, queryParameterValue) {
        const childQueries = queryParameterValue.values.flatMap((v) => {
            return this.filterByItem(field, v);
        });

        const query = {
            [queryParameterValue.operator]: childQueries
        };

        if (isColumnDateTimeType(this.resourceType, this.fieldMapper.getFieldName(field)) &&
            this.filterType === 'date') {
            const simplifiedRangeQuery = {};
            const newChildQueries = [];
            // correct the query
            const fieldName = this.fieldMapper.getFieldName(field);
            const possibleRanges = ['$lt', '$lte', '$gt', '$gte'];

            if (Array.isArray(childQueries)) {
                childQueries.forEach((childQuery) => {
                    const nestedRangeQuery = childQuery[`${fieldName}`];

                    if (!nestedRangeQuery) {
                        return;
                    }
                    // check if query doesn't have correct range query
                    const nestedKeys = Object.keys(nestedRangeQuery);
                    const canQueryBeSimplified =
                        nestedKeys.length === 1 && nestedKeys.every((v) => possibleRanges.includes(v));
                    if (canQueryBeSimplified) {
                        nestedKeys.forEach((k) => {
                            simplifiedRangeQuery[`${k}`] = nestedRangeQuery[`${k}`];
                        });
                    } else {
                        newChildQueries.push(childQuery);
                    }
                });
            }

            // simplify the range query
            if (simplifiedRangeQuery.$lt && simplifiedRangeQuery.$lte) {
                // give more preference to $lte
                delete simplifiedRangeQuery.$lt;
            }

            if (simplifiedRangeQuery.$gt && simplifiedRangeQuery.$gte) {
                // give more preference to $gte
                delete simplifiedRangeQuery.$gt;
            }

            if (Object.keys(simplifiedRangeQuery).length > 0) {
                newChildQueries.push({
                    [fieldName]: simplifiedRangeQuery
                });
            }

            query[queryParameterValue.operator] = newChildQueries;
        }
        return query;
    }
}

module.exports = {
    FilterByDateTime
};
