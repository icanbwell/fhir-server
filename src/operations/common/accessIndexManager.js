const {assertTypeEquals} = require('../../utils/assertType');
const {ConfigManager} = require('../../utils/configManager');
const {IndexProvider} = require('../../indexes/indexProvider');

class AccessIndexManager {
    /**
     * Constructor
     * @param {ConfigManager} configManager
     * @param {IndexProvider} indexProvider
     */
    constructor({configManager, indexProvider}) {
        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);

        /**
         * @type {IndexProvider}
         */
        this.indexProvider = indexProvider;
        assertTypeEquals(indexProvider, IndexProvider);
    }

    /**
     * whether this collection has access index
     * @param {string} resourceType
     * @returns {boolean}
     */
    resourceHasAccessIndex({resourceType}) {
        return this.configManager.resourcesWithAccessIndex.includes(resourceType) ||
            this.configManager.resourcesWithAccessIndex.includes('all');
    }

        /**
         * whether this collection has access index and there is an index for this accessCode
         * @param {string} resourceType
         * @param {string[]} accessCodes
         * @returns {boolean}
         */
    resourceHasAccessIndexForAccessCodes({resourceType, accessCodes}) {
        return this.resourceHasAccessIndex({resourceType}) &&
            this.indexProvider.hasIndexForAccessCodes({accessCodes});
    }

}

module.exports = {
    AccessIndexManager
};
