/**
 * Base class for an entity and its contained entities
 */
class EntityAndContainedBase {
    /**
     * @param {boolean} includeInOutput
     */
    constructor({includeInOutput}) {
        /**
         * @type {boolean}
         */
        this.includeInOutput = includeInOutput;
    }
}

module.exports = {
    EntityAndContainedBase
};
