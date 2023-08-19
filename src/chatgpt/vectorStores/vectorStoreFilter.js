class VectorStoreFilter {
    /**
     * constructor
     * @param {string|undefined} [resourceType]
     * @param {string|undefined} [id]
     */
    constructor(
        {
            resourceType,
            id
        }
    ) {
        /**
         * @type {string|undefined}
         */
        this.resourceType = resourceType;
        /**
         * @type {string|undefined}
         */
        this.id = id;
    }
}

module.exports = {
    VectorStoreFilter
};
