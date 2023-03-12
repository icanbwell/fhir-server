class ParsedReferenceItem {
    /**
     * constructor
     * @param {string|undefined} resourceType
     * @param {string} id
     * @param {string|undefined} sourceAssigningAuthority
     */
    constructor({resourceType, id, sourceAssigningAuthority}) {
        /**
         * @type {string|undefined}
         */
        this.resourceType = resourceType;
        /**
         * @type {string}
         */
        this.id = id;
        /**
         * @type {string|undefined}
         */
        this.sourceAssigningAuthority = sourceAssigningAuthority;
    }

    clone() {
        return new ParsedReferenceItem(
            {
                resourceType: this.resourceType,
                id: this.id,
                sourceAssigningAuthority: this.sourceAssigningAuthority
            }
        );
    }
}

module.exports = {
    ParsedReferenceItem
};
