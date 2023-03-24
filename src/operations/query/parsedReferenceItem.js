const {removeNull} = require('../../utils/nullRemover');

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

    /**
     * returns id + sourceAssigningAuthority (if present)
     * @return {string}
     */
    get idPlusSourceAssigningAuthority() {
        if (this.sourceAssigningAuthority) {
            return `${this.id}|${this.sourceAssigningAuthority}`;
        }
        return this.id;
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

    /**
     * Returns JSON representation of entity
     * @return {Object}
     */
    toJSON() {
        return removeNull({
            resourceType: this.resourceType,
            id: this.id,
            sourceAssigningAuthority: this.sourceAssigningAuthority
        });
    }
}

module.exports = {
    ParsedReferenceItem
};
