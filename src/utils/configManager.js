const env = require('var');
const {isTrue} = require('./isTrue');

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

    get useAccessIndex() {
        return isTrue(env.USE_ACCESS_INDEX);
    }
}

module.exports = {
    ConfigManager
};
