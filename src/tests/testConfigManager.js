const { ConfigManager } = require('../utils/configManager');

class TestConfigManager extends ConfigManager {
    /**
     * returns enabled gridFs resources list
     * @returns {string[]}
     */
    get enabledGridFsResources () {
        return process.env.GRIDFS_RESOURCES ? process.env.GRIDFS_RESOURCES.split(',') : [];
    }
}

module.exports = {
    TestConfigManager
};
