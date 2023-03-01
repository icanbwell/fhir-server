class QueryItem {
    /**
     * cosntructor
     * @param {import('mongodb').Filter<import('mongodb').DefaultSchema>} query
     * @param {string|null} resourceType
     * @param {string|null} collectionName
     * @param {string} [property]
     * @param {string} [reverse_filter]
     * @param {import('mongodb').Document[]} [explanations]
     */
    constructor(
        {
            query,
            resourceType,
            collectionName,
            property,
            reverse_filter,
            explanations
        }
    ) {
        /**
         * @type {import('mongodb').Filter<import('mongodb').DefaultSchema>}
         */
        this.query = query;
        /**
         * @type {string}
         */
        this.resourceType = resourceType;
        /**
         * @type {string}
         */
        this.collectionName = collectionName;
        /**
         * @type {string}
         */
        this.property = property;
        /**
         * @type {string}
         */
        this.reverse_filter = reverse_filter;
        /**
         * @type {import('mongodb').Document[]}
         */
        this.explanations = explanations;
    }
}

module.exports = {
    QueryItem
};
