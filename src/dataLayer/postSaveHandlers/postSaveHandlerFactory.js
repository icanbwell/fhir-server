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
     * @param {import('../repositories/groupMemberRepository').GroupMemberRepository} [params.groupMemberRepository]
     *   Shared Group member repository. When omitted, one is constructed on demand from the client manager.
     */
    constructor({ configManager, clickHouseClientManager, groupMemberRepository = null }) {
        this.configManager = configManager;
        this.clickHouseClientManager = clickHouseClientManager;
        this.groupMemberRepository = groupMemberRepository;
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

            // Prefer the injected shared repository; fall back to constructing one so a factory
            // built without it (e.g. in isolation) still works.
            let repository = this.groupMemberRepository;
            if (!repository) {
                const { GroupMemberRepository } = require('../repositories/groupMemberRepository');
                repository = new GroupMemberRepository({
                    clickHouseClient: this.clickHouseClientManager
                });
            }

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
