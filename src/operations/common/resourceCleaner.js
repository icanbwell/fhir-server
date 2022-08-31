const {getResource} = require('./getResource');
const {removeNull} = require('../../utils/nullRemover');

/**
 * This class cleans any extra properties from a resource
 */
class ResourceCleaner {
    constructor() {
    }

    /**
     * Cleans a resource
     * @param {string} base_version
     * @param {Object} resource
     * @return {Resource}
     */
    clean(base_version, resource) {
        /**
         * @type {function({Object}): Resource}
         */
        let ResourceCreator = getResource(base_version, resource.resourceType);
        const resourceCreator = new ResourceCreator(resource);
        // noinspection JSValidateTypes
        return removeNull(resourceCreator.toJSON());
    }
}

module.exports = {
    ResourceCleaner
};
