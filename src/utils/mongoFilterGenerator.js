const { assertTypeEquals } = require('./assertType');
const { ConfigManager } = require('./configManager');

/**
 * @classdesc Generates filters for use in Mongo queries
 */
class MongoFilterGenerator {
    /**
     * constructor
     * @param {ConfigManager} configManager
     */
    constructor ({
                    configManager
                }
    ) {
        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
    }

    /**
     * generates a mongo filter for lookup by uuid
     * @param {string} uuid
     * @return {import('mongodb').Filter<import('mongodb').DefaultSchema>}
     */
    generateFilterForUuid ({ uuid }) {
        /**
         * @type {import('mongodb').Filter<import('mongodb').DefaultSchema>}
         */
        const filter = { _uuid: uuid.toString() };
        return filter;
    }
}

module.exports = {
    MongoFilterGenerator
};
