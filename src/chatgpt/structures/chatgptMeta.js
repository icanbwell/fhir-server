class ChatGPTMeta {
    /**
     * constructor
     * @param {string} _id
     * @param {string} uuid
     * @param {string} reference
     * @param {string} resourceType
     * @param {string} parentUuid
     * @param {string} parentResourceType
     * @param {number|undefined} [similarity]
     */
    constructor({
                    _id, uuid, reference, resourceType, parentUuid, parentResourceType,
                    similarity
                }) {
        /**
         * @type {string}
         */
        this._id = _id;
        /**
         * @type {string}
         */
        this.uuid = uuid;
        /**
         * @type {string}
         */
        this.resourceType = resourceType;
        /**
         * @type {string}
         */
        this.parentUuid = parentUuid;
        /**
         * @type {string}
         */
        this.parentResourceType = parentResourceType;

        /**
         * @type {string}
         */
        this.reference = reference;

        /**
         * @type {number|undefined}
         */
        this.similarity = similarity;
    }
}

module.exports = {
    ChatGPTMeta
};
