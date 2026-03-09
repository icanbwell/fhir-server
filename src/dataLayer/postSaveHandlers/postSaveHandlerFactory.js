const { logDebug } = require('../../operations/common/logging');

/**
 * Factory for creating post-save handlers based on resource type and configuration.
 * Encapsulates handler instantiation logic to decouple operations layer from storage implementations.
 */
class PostSaveHandlerFactory {
    /**
     * @param {Object} params
     * @param {import('../../utils/configManager').ConfigManager} params.configManager
     * @param {import('../../utils/clickHouseClientManager').ClickHouseClientManager} [params.clickHouseClientManager]
     */
    constructor({ configManager, clickHouseClientManager }) {
        this.configManager = configManager;
        this.clickHouseClientManager = clickHouseClientManager;
    }

    /**
     * Gets appropriate post-save handlers for the given resource type
     * @param {string} resourceType - FHIR resource type
     * @returns {Array<Object>} Array of handler instances
     */
    getHandlers(resourceType) {
        const handlers = [];

        if (this._shouldUseClickHouseHandler(resourceType)) {
            logDebug(`Creating storage sync handler for ${resourceType}`);

            const { ClickHouseGroupHandler } = require('./clickHouseGroupHandler');
            const { GroupMemberRepository } = require('../repositories/groupMemberRepository');

            const repository = new GroupMemberRepository({
                clickHouseClient: this.clickHouseClientManager
            });

            handlers.push(new ClickHouseGroupHandler({
                clickHouseClientManager: this.clickHouseClientManager,
                configManager: this.configManager,
                groupMemberRepository: repository
            }));
        }

        return handlers;
    }

    /**
     * Determines if ClickHouse handler should be used for the resource type
     * @param {string} resourceType
     * @returns {boolean}
     * @private
     */
    _shouldUseClickHouseHandler(resourceType) {
        return this.configManager.enableClickHouse &&
               this.configManager.mongoWithClickHouseResources &&
               this.configManager.mongoWithClickHouseResources.includes(resourceType);
    }
}

module.exports = { PostSaveHandlerFactory };
