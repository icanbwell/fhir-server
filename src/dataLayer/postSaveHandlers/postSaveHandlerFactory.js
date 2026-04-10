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
     * @param {import('../../utils/mongoDatabaseManager').MongoDatabaseManager} [params.mongoDatabaseManager]
     */
    constructor({ configManager, clickHouseClientManager, mongoDatabaseManager }) {
        this.configManager = configManager;
        this.clickHouseClientManager = clickHouseClientManager;
        this.mongoDatabaseManager = mongoDatabaseManager;
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

        if (this._shouldUseMongoGroupMemberHandler(resourceType)) {
            logDebug(`Creating MongoDB group member handler for ${resourceType}`);

            const { MongoGroupMemberHandler } = require('./mongoGroupMemberHandler');
            const { MongoGroupMemberRepository } = require('../repositories/mongoGroupMemberRepository');

            const repository = new MongoGroupMemberRepository({
                mongoDatabaseManager: this.mongoDatabaseManager
            });

            handlers.push(new MongoGroupMemberHandler({
                configManager: this.configManager,
                mongoGroupMemberRepository: repository
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

    /**
     * Determines if MongoDB group member handler should be used
     * @param {string} resourceType
     * @returns {boolean}
     * @private
     */
    _shouldUseMongoGroupMemberHandler(resourceType) {
        return this.configManager.enableMongoGroupMembers && resourceType === 'Group';
    }
}

module.exports = { PostSaveHandlerFactory };
