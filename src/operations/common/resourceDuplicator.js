const {getResource} = require('./getResource');

class ResourceDuplicator {
    constructor() {
    }

    /**
     * Duplicates a resource
     * @param {string} base_version
     * @param {Resource} resource
     * @returns {Resource}
     */
    duplicateResource({base_version, resource}) {
        // convert to JSON and then create a new resource
        const ResourceCreator = getResource(base_version, resource.resourceType);
        return new ResourceCreator(resource.toJSON());
    }
}

module.exports = {
    ResourceDuplicator
};
