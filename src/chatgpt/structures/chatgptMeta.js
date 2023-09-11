class ChatGPTMeta {
    /**
     * constructor
     * @param {string} _id
     * @param {string} uuid
     * @param {string} reference
     * @param {string} resourceType
     * @param {string} parentUuid
     * @param {string} parentResourceType
     */
    constructor({_id, uuid, reference, resourceType, parentUuid, parentResourceType}) {
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
    }
}

module.exports = {
    ChatGPTMeta
};
