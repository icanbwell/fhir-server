/**
 * class that represents a non-resource (such as an element inside a resource) and its contained entities
 */
const {assertIsValid} = require('../../utils/assertType');
const {EntityAndContainedBase} = require('./entityAndContainedBase');

class NonResourceEntityAndContained extends EntityAndContainedBase {
    /**
     * class
     * @param {boolean} includeInOutput
     * @param {Object} item
     * @param {EntityAndContainedBase[]} containedEntries
     */
    constructor({includeInOutput, item, containedEntries}) {
        super({includeInOutput});
        /**
         * @type {*}
         */
        assertIsValid(item);
        this.item = item;
        /**
         * @type {[EntityAndContainedBase]}
         */
        assertIsValid(containedEntries);
        this.containedEntries = containedEntries;
    }
}

module.exports = {
    NonResourceEntityAndContained
};
