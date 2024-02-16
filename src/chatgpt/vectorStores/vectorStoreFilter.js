class VectorStoreFilter {
    /**
     * constructor
     * @param {string|undefined} [resourceType]
     * @param {string|undefined} [uuid]
     */
    constructor (
        {
            resourceType,
            uuid
        }
    ) {
        /**
         * @type {string|undefined}
         */
        this.resourceType = resourceType;
        /**
         * @type {string|undefined}
         */
        this.uuid = uuid;
    }
}

module.exports = {
    VectorStoreFilter
};
