const { assertTypeEquals } = require('../../utils/assertType');
const { ConfigManager } = require('../../utils/configManager');

/**
 * Decides which store serves a history read for a resource type. The list comes from
 * `RESOURCE_HISTORY_CLICKHOUSE_READ_RESOURCES` and is read on every call, so a config rollout takes
 * effect without a restart of the router. Every history entry point asks here, so the rule lives in one place.
 */
class HistoryReadRouter {
    /**
     * @param {Object} params
     * @param {ConfigManager} params.configManager
     */
    constructor({ configManager }) {
        assertTypeEquals(configManager, ConfigManager);
        this.configManager = configManager;
    }

    /**
     * @param {string} resourceType
     * @return {boolean} true when history for this type is read from ClickHouse, false for MongoDB
     */
    readsFromClickHouse(resourceType) {
        return this.configManager.resourceHistoryClickHouseReadResources.includes(resourceType);
    }
}

module.exports = {
    HistoryReadRouter
};
