const { StorageProvider } = require('./storageProvider');
const { logDebug, logInfo, logError, logWarn } = require('../../operations/common/logging');
const { RethrownError } = require('../../utils/rethrownError');
const { STORAGE_PROVIDER_TYPES } = require('./storageProviderTypes');
const { QueryParser } = require('./mongoWithClickHouse/queryParser');

/**
 * MongoDB + MongoDB Members Storage Provider
 *
 * Routes queries between MongoDB Group metadata collection (Group_4_0_0)
 * and MongoDB member event collection/view (Group_4_0_0_MemberEvent / Group_4_0_0_MemberCurrent).
 *
 * Same interface as MongoWithClickHouseStorageProvider — swaps ClickHouse queries
 * for MongoDB view queries via MongoGroupMemberRepository.
 */
class MongoWithMongoMembersStorageProvider extends StorageProvider {
    /**
     * @param {Object} params
     * @param {import('../../operations/common/resourceLocator').ResourceLocator} params.resourceLocator
     * @param {import('./mongoStorageProvider').MongoStorageProvider} params.mongoStorageProvider
     * @param {import('../../dataLayer/repositories/mongoGroupMemberRepository').MongoGroupMemberRepository} params.mongoGroupMemberRepository
     * @param {import('../../utils/configManager').ConfigManager} params.configManager
     */
    constructor({
        resourceLocator,
        mongoStorageProvider,
        mongoGroupMemberRepository,
        configManager
    }) {
        super();
        this.resourceLocator = resourceLocator;
        this.mongoStorageProvider = mongoStorageProvider;
        this.repository = mongoGroupMemberRepository;
        this.configManager = configManager;
    }

    /**
     * Get current members with total count from MongoDB view
     *
     * @param {string} groupId - Group ID to query
     * @param {Object} options
     * @param {number} [options.limit=100] - Page size
     * @param {string|null} [options.afterReference=null] - Seek cursor
     * @returns {Promise<{members: Array<Object>, totalCount: number}>}
     */
    async getCurrentMembersWithCountAsync(groupId, { limit = 100, afterReference = null } = {}) {
        try {
            const [totalCount, members] = await Promise.all([
                this.repository.getActiveMemberCount(groupId),
                this.repository.getActiveMembers(groupId)
            ]);

            // Apply pagination (seek + limit) on the returned members
            let filtered = members;
            if (afterReference) {
                const idx = filtered.indexOf(afterReference);
                if (idx !== -1) {
                    filtered = filtered.slice(idx + 1);
                }
            }
            filtered = filtered.slice(0, limit);

            return {
                members: filtered.map(ref => ({
                    entity_reference: ref,
                    entity_type: ref.split('/')[0] || 'unknown',
                    inactive: 0
                })),
                totalCount
            };
        } catch (error) {
            logError('Error querying current members from MongoDB view', {
                error: error.message,
                groupId,
                limit,
                afterReference
            });

            throw new RethrownError({
                message: 'Error getting current members with count from MongoDB',
                error,
                args: { groupId, limit, afterReference }
            });
        }
    }

    /**
     * Get member count only (for Group.quantity)
     *
     * @param {string} groupId - Group ID to query
     * @returns {Promise<number>}
     */
    async getActiveMemberCountAsync(groupId) {
        return await this.repository.getActiveMemberCount(groupId);
    }

    /**
     * Finds resources - routes member queries to MongoDB view, metadata to MongoDB
     *
     * @param {Object} params
     * @param {Object} params.query
     * @param {Object} [params.options]
     * @param {Object} [params.extraInfo]
     * @returns {Promise<import('../databaseCursor').DatabaseCursor>}
     */
    async findAsync({ query, options, extraInfo }) {
        try {
            const isMemberQuery = this._isMemberQuery(query);

            if (isMemberQuery) {
                logInfo('Routing Group member query to MongoDB view', {
                    query,
                    limit: options?.limit
                });
                return await this._findGroupsByMemberFromMongo({ query, options, extraInfo });
            }

            logDebug('Routing Group metadata query to MongoDB', { query });
            return await this.mongoStorageProvider.findAsync({ query, options, extraInfo });
        } catch (error) {
            logError('Error in MongoWithMongoMembersStorageProvider.findAsync', {
                error: error.message,
                query
            });
            throw error;
        }
    }

    /**
     * Finds one resource - always uses MongoDB
     */
    async findOneAsync({ query, options }) {
        return await this.mongoStorageProvider.findOneAsync({ query, options });
    }

    /**
     * Inserts/updates resources - delegates to MongoDB
     * Member events are handled by post-save handler (MongoGroupMemberHandler)
     */
    async upsertAsync({ resources, options }) {
        const results = [];

        try {
            for (const resource of resources) {
                const mongoResult = await this.mongoStorageProvider.upsertAsync({
                    resources: [resource],
                    options
                });
                results.push(mongoResult);
            }

            return {
                acknowledged: true,
                insertedCount: results.length
            };
        } catch (error) {
            logError('Error in MongoWithMongoMembersStorageProvider.upsertAsync', {
                error: error.message,
                resourceCount: resources.length
            });

            throw new RethrownError({
                message: 'Error in MongoDB member storage upsert',
                error,
                args: { resourceCount: resources.length }
            });
        }
    }

    /**
     * Counts resources
     */
    async countAsync({ query }) {
        const isMemberQuery = this._isMemberQuery(query);
        if (isMemberQuery) {
            const memberCriteria = QueryParser.extractMemberCriteria(query);
            const validation = QueryParser.validateMemberCriteria(memberCriteria);

            if (!validation.valid) {
                logWarn(`Cannot count by member: ${validation.reason}`, { memberCriteria });
                return await this.mongoStorageProvider.countAsync({ query });
            }

            try {
                return await this.repository.countGroupsByMember(validation.entityReference);
            } catch (error) {
                logError('Error counting groups by member from MongoDB view', {
                    error: error.message,
                    entityReference: validation.entityReference
                });
                throw error;
            }
        }

        return await this.mongoStorageProvider.countAsync({ query });
    }

    /**
     * Returns storage type identifier
     * @returns {string}
     */
    getStorageType() {
        return STORAGE_PROVIDER_TYPES.MONGO_WITH_MONGO_MEMBERS;
    }

    // ========== Private Methods ==========

    /**
     * Detects if query is searching for Group members
     * Same logic as MongoWithClickHouseStorageProvider._isMemberQuery
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
     * Queries MongoDB view for Groups containing specified member
     * @private
     */
    async _findGroupsByMemberFromMongo({ query, options, extraInfo }) {
        try {
            const memberCriteria = QueryParser.extractMemberCriteria(query);
            const validation = QueryParser.validateMemberCriteria(memberCriteria);

            if (!validation.valid) {
                logWarn(`Cannot search by member: ${validation.reason}`, { memberCriteria });
                return await this.mongoStorageProvider.findAsync({ query, options, extraInfo });
            }

            // Get Group IDs from MongoDB view
            const groupUuids = await this.repository.findGroupsByMember(validation.entityReference);

            if (!groupUuids || groupUuids.length === 0) {
                logDebug('No groups found for member in MongoDB view', {
                    entityReference: validation.entityReference
                });
                return await this.mongoStorageProvider.findAsync({
                    query: { _uuid: { $in: [] } },
                    options,
                    extraInfo
                });
            }

            // Fetch full Group documents from MongoDB
            const limit = options?.limit || 100;
            const mongoQuery = { _uuid: { $in: groupUuids.slice(0, limit) } };

            logInfo('Fetching Group documents from MongoDB', {
                groupCount: groupUuids.length,
                limit,
                entityReference: validation.entityReference
            });

            return await this.mongoStorageProvider.findAsync({
                query: mongoQuery,
                options,
                extraInfo
            });
        } catch (error) {
            logError('Error querying MongoDB view for Groups by member', {
                error: error.message,
                query
            });

            throw new RethrownError({
                message: 'Error finding Groups by member in MongoDB view',
                error,
                args: { query }
            });
        }
    }
}

module.exports = { MongoWithMongoMembersStorageProvider };
