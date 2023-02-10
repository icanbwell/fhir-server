const moment = require('moment-timezone');
const {BasePartitioner} = require('./basePartitioner');

/**
 * @classdesc this partitioner partitions a collection by year & month
 * @example AuditEvent_4_0_0_2002_09
 */
class YearMonthPartitioner extends BasePartitioner {
    /**
     * @param {string} fieldValue
     * @param {string} resourceWithBaseVersion
     * @returns {string}
     */
    static getPartitionNameFromYearMonth({fieldValue, resourceWithBaseVersion}) {
        const fieldDate = new Date(fieldValue);
        const year = fieldDate.getUTCFullYear();
        const month = fieldDate.getUTCMonth() + 1; // 0 indexed
        const monthFormatted = String(month).padStart(2, '0');
        return `${resourceWithBaseVersion}_${year}_${monthFormatted}`;
    }

    /**
     * gets partition for resource
     * @param {Resource} resource
     * @param {string} field
     * @param {string} resourceWithBaseVersion
     * @returns {Promise<string>}
     */
    async getPartitionByResourceAsync({resource, field, resourceWithBaseVersion}) {
        // get value of field
        const fieldValue = resource[`${field}`];
        if (!fieldValue) {
            return resourceWithBaseVersion;
        } else {
            return YearMonthPartitioner.getPartitionNameFromYearMonth(
                {fieldValue, resourceWithBaseVersion});
        }
    }

    /**
     * Gets partitions by query
     * @param {string} resourceType
     * @param {import('mongodb').Filter<import('mongodb').DefaultSchema>|undefined} [query]
     * @param {string} field
     * @param {string} resourceWithBaseVersion
     * @param {Map<string, string[]>} partitionsCache
     * @returns {Promise<*[]>}
     */
    async getPartitionByQueryAsync(
        {
            resourceType,
            query,
            field,
            resourceWithBaseVersion,
            partitionsCache
        }
    ) {
        if (!query || Object.keys(query).length === 0) {
            return partitionsCache.get(resourceType);
        }
        /**
         * @type {Object[]}
         */
        const andClauses = query.$and || [];
        /**
         * @type {Object[]}
         */
        const clausesForDate = andClauses.filter(c => c[`${field}`] !== undefined);
        let { greaterThan, lessThan } = this.getUpdateDateRangeForField(clausesForDate, field);

        // now find partitions for the months in between greaterThan and lessThan
        /**
         * @type {moment.Moment}
         */
        let currentDate = moment.utc(lessThan);
        const partitions = [];
        while (currentDate.isSameOrAfter(greaterThan.startOf('month'))) {
            /**
             * @type {string}
             */
            const partition = YearMonthPartitioner.getPartitionNameFromYearMonth(
                {
                    fieldValue: currentDate.utc().toISOString(), resourceWithBaseVersion
                }
            );
            if (partitionsCache.has(resourceType) && partitionsCache.get(resourceType).includes(partition)) {
                partitions.push(partition);
            }
            currentDate = currentDate.utc().subtract(1, 'months');
        }
        return partitions;
    }

    /**
     * Returns updates date range for a field
     * @param {Object|Object[]} clausesForDate
     * @param {string} field
     * @return {function(string, string): number}
     */
    getUpdateDateRangeForField(clausesForDate, field) {
        /**
         * init to an initial value
         * @type {moment.Moment}
         */
        let greaterThan = moment.utc(new Date(2010, 0, 1));
        /**
         * init to an initial value
         * @type {moment.Moment}
         */
        let lessThan = moment.utc(new Date(2030, 0, 1));

        for (const clauseForDate of clausesForDate) {
            /**
             * @type {{$gt:Date|undefined, $lt: Date|undefined }}
             */
            const value = clauseForDate[`${field}`];
            if (value.$gt) {
                greaterThan = moment.utc(value.$gt).isAfter(greaterThan) ? moment.utc(value.$gt) : greaterThan;
            }
            if (value.$lt) {
                lessThan = moment.utc(value.$lt).isBefore(lessThan) ? moment.utc(value.$lt) : lessThan;
            }
        }
        return { greaterThan, lessThan };
    }

    /**
     * Returns a function used for sorting the partitions
     * @return {function(string, string): number}
     */
    getSortingFunction() {
        return (a, b) => (a > b ? -1 : 1);
    }
}

module.exports = {
    YearMonthPartitioner
};
