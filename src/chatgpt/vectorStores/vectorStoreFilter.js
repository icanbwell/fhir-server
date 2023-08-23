class VectorStoreFilter {
    /**
     * constructor
     * @param {string|undefined} [resourceType]
     * @param {string|undefined} [uuid]
     * @param {string|undefined} [parentResourceType]
     * @param {string|undefined} [parentUuid]
     */
    constructor(
        {
            resourceType,
            uuid,
            parentResourceType,
            parentUuid
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

        /**
         * @type {string|undefined}
         */
        this.parentResourceType = parentResourceType;
        /**
         * @type {string|undefined}
         */
        this.parentUuid = parentUuid;
    }
}

module.exports = {
    VectorStoreFilter
};
