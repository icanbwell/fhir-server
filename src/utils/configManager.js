const env = require('var');

class ConfigManager {
    /**
     * @returns {string[]}
     */
    get partitionResources() {
        // see if resourceType is in list of resources we want to partitionConfig in this environment
        /**
         * @type {string|undefined}
         */
        const partitionResourcesString = env.PARTITION_RESOURCES;
        return partitionResourcesString ?
            partitionResourcesString.split(',').map(s => String(s).trim()) : [];
    }

    get resourcesWithAccessIndex() {
        return (
            env.COLLECTIONS_ACCESS_INDEX && env.COLLECTIONS_ACCESS_INDEX.split(',')
                .map((col) => col.trim())
        ) || [];
    }
}

module.exports = {
    ConfigManager
};
