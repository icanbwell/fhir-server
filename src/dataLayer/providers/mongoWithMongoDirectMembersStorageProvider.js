'use strict';

const { StorageProvider } = require('./storageProvider');
const { logDebug, logInfo, logError } = require('../../operations/common/logging');
const { RethrownError } = require('../../utils/rethrownError');
const { QueryParser } = require('./mongoWithClickHouse/queryParser');

/**
 * Storage provider for MongoDB Direct Group Members (V2)
 *
 * Routes member-related queries to the direct member collection,
 * metadata queries to the standard MongoDB collection.
 *
 * Same interface as MongoWithMongoMembersStorageProvider but uses
 * direct collection queries instead of MongoDB views.
 */
class MongoWithMongoDirectMembersStorageProvider extends StorageProvider {
    /**
     * @param {Object} params
     * @param {import('../../operations/common/resourceLocatorFactory').ResourceLocator} params.resourceLocator
     * @param {import('./mongoStorageProvider').MongoStorageProvider} params.mongoStorageProvider
     * @param {import('../repositories/mongoDirectGroupMemberRepository').MongoDirectGroupMemberRepository} params.mongoDirectGroupMemberRepository
     * @param {import('../../utils/configManager').ConfigManager} params.configManager
     */
    constructor({
        resourceLocator,
        mongoStorageProvider,
        mongoDirectGroupMemberRepository,
        configManager
    }) {
        super();
        this.resourceLocator = resourceLocator;
        this.mongoStorageProvider = mongoStorageProvider;
        this.repository = mongoDirectGroupMemberRepository;
        this.configManager = configManager;
    }

    /**
     * Get current members with count (for enrichment)
     * @param {string} groupUuid
     * @returns {Promise<{members: Array, count: number}>}
     */
    async getCurrentMembersWithCountAsync(groupUuid) {
        return this.repository.getCurrentMembersWithCountAsync(groupUuid);
    }

    /**
     * Finds resources - routes member queries to direct collection, metadata to MongoDB
     * @param {Object} params
     * @param {Object} params.query - MongoDB query object
     * @param {Object} [params.options]
     * @param {Object} [params.extraInfo]
     * @returns {Promise<import('../databaseCursor').DatabaseCursor>}
     */
    async findAsync({ query, options, extraInfo }) {
        if (this._isMemberQuery(query)) {
            logInfo('Routing Group member query to direct collection', { query });
            return this._findGroupsByMember({ query, options, extraInfo });
        }
        return this.mongoStorageProvider.findAsync({ query, options, extraInfo });
    }

    /**
     * Finds one resource - always uses MongoDB
     */
    async findOneAsync({ query, options }) {
        return this.mongoStorageProvider.findOneAsync({ query, options });
    }

    /**
     * Counts resources
     */
    async countAsync({ query }) {
        if (this._isMemberQuery(query)) {
            const memberCriteria = QueryParser.extractMemberCriteria(query);
            const reference = memberCriteria.memberReference ||
                memberCriteria.memberUuid ||
                memberCriteria.memberSourceId;
            if (reference) {
                const groupUuids = await this.repository.findGroupsByMemberCriteria({
                    memberReference: reference
                });
                return groupUuids.length;
            }
        }
        return this.mongoStorageProvider.countAsync({ query });
    }

    // Delegate write operations to mongo provider
    async upsertAsync({ resources, options }) {
        return this.mongoStorageProvider.upsertAsync({ resources, options });
    }

    // ========== Private Methods ==========

    /**
     * Detects if query is searching for Group members
     * Same logic as MongoWithMongoMembersStorageProvider._isMemberQuery
     * @private
     */
    _isMemberQuery(query) {
        return this._hasField(query, this._isMemberField.bind(this));
    }

    /** @private */
    _isMemberField(key) {
        return key === 'member' || key.startsWith('member.');
    }

    /** @private */
    _hasField(obj, fieldChecker) {
        if (!obj || typeof obj !== 'object') return false;

        for (const [key, value] of Object.entries(obj)) {
            if (fieldChecker(key)) return true;

            if (key === '$and' || key === '$or') {
                if (Array.isArray(value) &&
                    value.some(v => this._hasField(v, fieldChecker))) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Queries direct collection for Groups containing specified member
     * @private
     */
    async _findGroupsByMember({ query, options, extraInfo }) {
        try {
            const memberCriteria = QueryParser.extractMemberCriteria(query);

            // V2 stores all references as member_reference (the entity.reference string).
            // Use whichever criteria the query provides — UUID, sourceId, or reference —
            // they all map to the same member_reference field in the direct collection.
            const reference = memberCriteria.memberReference ||
                memberCriteria.memberUuid ||
                memberCriteria.memberSourceId;

            if (!reference) {
                logDebug('No member reference found in query', { memberCriteria });
                return this.mongoStorageProvider.findAsync({ query, options, extraInfo });
            }

            const groupUuids = await this.repository.findGroupsByMemberCriteria({
                memberReference: reference
            });

            if (!groupUuids || groupUuids.length === 0) {
                logDebug('No groups found for member in direct collection', { memberCriteria });
                return this.mongoStorageProvider.findAsync({
                    query: { _uuid: { $in: [] } },
                    options,
                    extraInfo
                });
            }

            const limit = options?.limit || 100;
            const mongoQuery = { _uuid: { $in: groupUuids.slice(0, limit) } };

            logInfo('Fetching Group documents from MongoDB', {
                groupCount: groupUuids.length,
                limit,
                memberCriteria
            });

            return this.mongoStorageProvider.findAsync({
                query: mongoQuery,
                options,
                extraInfo
            });
        } catch (error) {
            logError('Error querying direct collection for Groups by member', {
                error: error.message,
                query
            });

            throw new RethrownError({
                message: 'Error finding Groups by member in direct collection',
                error,
                args: { query }
            });
        }
    }
}

module.exports = { MongoWithMongoDirectMembersStorageProvider };
