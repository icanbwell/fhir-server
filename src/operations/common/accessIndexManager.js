const {assertTypeEquals} = require('../../utils/assertType');
const {ConfigManager} = require('../../utils/configManager');

class AccessIndexManager {
    /**
     * Constructor
     * @param {ConfigManager} configManager
     */
    constructor({configManager}) {
        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
    }

    /**
     * whether this collection has access index
     * @param {string} collection_name
     * @returns {boolean}
     */
    resourceHasAccessIndex(collection_name) {
        return this.configManager.resourcesWithAccessIndex.includes(collection_name);
    }
}

module.exports = {
    AccessIndexManager
};
