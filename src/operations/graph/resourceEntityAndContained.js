/**
 * class that represents a resource and its contained entities
 */
const {EntityAndContainedBase} = require('./entityAndContainedBase');
const {assertIsValid} = require('../../utils/assertType');

class ResourceEntityAndContained extends EntityAndContainedBase {
    /**
     * class
     * @param {string} entityId
     * @param {string} entityUuid
     * @param {string} entityResourceType
     * @param {boolean} includeInOutput
     * @param {Resource} resource
     * @param {EntityAndContainedBase[]} containedEntries
     */
    constructor (
        {
            entityId,
            entityUuid,
            entityResourceType,
            includeInOutput,
            resource,
            containedEntries
        }) {
        super({includeInOutput});
        /**
         * @type {string}
         */
        this.entityId = entityId;
        assertIsValid(entityId);
        /**
         * @type {string}
         */
        this.entityUuid = entityUuid;
        assertIsValid(entityUuid);
        /**
         * @type {string}
         */
        this.entityResourceType = entityResourceType;
        assertIsValid(entityResourceType);
        /**
         * @type {Resource}
         */
        this.resource = resource;
        assertIsValid(resource);
        /**
         * @type {[EntityAndContainedBase]}
         */
        this.containedEntries = containedEntries;
        assertIsValid(containedEntries);
    }
}

module.exports = {
    ResourceEntityAndContained
};
