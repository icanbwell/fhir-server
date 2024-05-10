class BasePartitioner {
    /**
     * gets partition for resource
     * @param {Resource} resource
     * @param {string} field
     * @param {string} resourceWithBaseVersion
     * @returns {Promise<string>}
     */

    async getPartitionByResourceAsync ({ resource, field, resourceWithBaseVersion }) {
        throw new Error(`base class ${this.constructor.name} must implement getPartitionByResourceAsync`);
    }

    /**
     * Gets partitions by query
     * @param {string} resourceType
     * @param {import('mongodb').Filter<import('mongodb').DefaultSchema>} [query]
     * @param {string} field
     * @param {string} resourceWithBaseVersion
     * @returns {Promise<*[]>}
     */

    async getPartitionByQueryAsync ({ resourceType, query, field, resourceWithBaseVersion }) {
        throw new Error(`base class ${this.constructor.name} must implement getPartitionByQueryAsync`);
    }

    /**
     * Returns a function used for sorting the partitions
     * @return {function(string, string): number}
     */
    getSortingFunction () {
        throw new Error(`base class ${this.constructor.name} must implement getSortingFunction`);
    }
}

module.exports = {
    BasePartitioner
};
