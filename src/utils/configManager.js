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

    /**
     * @return {string[]|null}
     */
    get requiredFiltersForAuditEvent() {
        return (
            env.REQUIRED_AUDIT_EVENT_FILTERS && env.REQUIRED_AUDIT_EVENT_FILTERS.split(',')
                .map((col) => col.trim())
        ) || null;
    }
}

module.exports = {
    ConfigManager
};
