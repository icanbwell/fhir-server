class ParsedReferenceItem {
    /**
     * constructor
     * @param {string|undefined} resourceType
     * @param {string} id
     */
    constructor({resourceType, id}) {
        /**
         * @type {string|undefined}
         */
        this.resourceType = resourceType;
        /**
         * @type {string}
         */
        this.id = id;
    }
}

module.exports = {
    ParsedReferenceItem
};
