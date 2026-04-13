'use strict';

const { logInfo, logDebug, logError } = require('../../operations/common/logging');
const { RethrownError } = require('../../utils/rethrownError');
const { COLLECTIONS } = require('../../constants/mongoGroupMemberConstants');

/**
 * Repository for MongoDB Direct Group Member storage (V2)
 *
 * Key design differences from MongoGroupMemberRepository (V1):
 * - No ObjectId resolution — stores string references (like ClickHouse)
 * - No member existence validation — trusts client data (like ClickHouse)
 * - No event sourcing — upserts/deletes in place (current state only)
 * - No MongoDB view — queries collection directly
 *
 * TODO: Add history tracking for member changes following existing
 * resource history implementation pattern (separate history collection)
 */
class MongoDirectGroupMemberRepository {
    /**
     * @param {Object} params
     * @param {import('../../utils/mongoDatabaseManager').MongoDatabaseManager} params.mongoDatabaseManager
     */
    constructor({ mongoDatabaseManager }) {
        this.mongoDatabaseManager = mongoDatabaseManager;
    }

    /**
     * Gets the direct member collection
     * @returns {Promise<import('mongodb').Collection>}
     * @private
     */
    async _getCollection() {
        const db = await this.mongoDatabaseManager.getClientDbAsync();
        return db.collection(COLLECTIONS.GROUP_MEMBER_DIRECT);
    }

    /**
     * Upserts members for a group (add or update)
     * Uses bulkWrite with upsert for atomic batch operations
     *
     * @param {Object} params
     * @param {string} params.groupUuid - Group _uuid (e.g., "Group/uuid-123")
     * @param {Array<Object>} params.members - FHIR Group.member objects
     * @returns {Promise<{upserted: number, modified: number}>}
     */
    async upsertMembersAsync({ groupUuid, members }) {
        if (!members || members.length === 0) {
            return { upserted: 0, modified: 0 };
        }

        const collection = await this._getCollection();
        const now = new Date();

        const operations = members.map(member => {
            const reference = member.entity?.reference;

            return {
                updateOne: {
                    filter: {
                        group_uuid: groupUuid,
                        member_reference: reference
                    },
                    update: {
                        $set: {
                            period: member.period || null,
                            inactive: member.inactive || false,
                            updated_at: now
                        },
                        $setOnInsert: {
                            group_uuid: groupUuid,
                            member_reference: reference
                        }
                    },
                    upsert: true
                }
            };
        });

        try {
            const result = await collection.bulkWrite(operations, { ordered: false });

            logDebug('Upserted members', {
                groupUuid,
                requested: members.length,
                upserted: result.upsertedCount,
                modified: result.modifiedCount
            });

            return {
                upserted: result.upsertedCount,
                modified: result.modifiedCount
            };
        } catch (error) {
            throw new RethrownError({
                message: 'Error upserting direct group members',
                error,
                args: { groupUuid, memberCount: members.length }
            });
        }
    }

    /**
     * Removes members from a group
     *
     * @param {Object} params
     * @param {string} params.groupUuid - Group _uuid
     * @param {Array<Object>} params.members - FHIR Group.member objects (need entity.reference)
     * @returns {Promise<{deleted: number}>}
     */
    async removeMembersAsync({ groupUuid, members }) {
        if (!members || members.length === 0) {
            return { deleted: 0 };
        }

        const collection = await this._getCollection();
        const references = members.map(m => m.entity?.reference).filter(Boolean);

        try {
            const result = await collection.deleteMany({
                group_uuid: groupUuid,
                member_reference: { $in: references }
            });

            logDebug('Removed members', {
                groupUuid,
                requested: references.length,
                deleted: result.deletedCount
            });

            return { deleted: result.deletedCount };
        } catch (error) {
            throw new RethrownError({
                message: 'Error removing direct group members',
                error,
                args: { groupUuid, memberCount: references.length }
            });
        }
    }

    /**
     * Replaces all members for a group (used on UPDATE/PUT)
     * Computes diff: adds new, removes absent
     *
     * @param {Object} params
     * @param {string} params.groupUuid - Group _uuid
     * @param {Array<Object>} params.members - New full member list
     * @returns {Promise<{added: number, removed: number, unchanged: number}>}
     */
    async replaceMembersAsync({ groupUuid, members }) {
        const collection = await this._getCollection();

        // Get current member references
        const currentDocs = await collection
            .find({ group_uuid: groupUuid }, { projection: { member_reference: 1 } })
            .toArray();
        const currentRefs = new Set(currentDocs.map(d => d.member_reference));

        const newRefs = new Set((members || []).map(m => m.entity?.reference).filter(Boolean));

        // Compute diff
        const toAdd = (members || []).filter(m => !currentRefs.has(m.entity?.reference));
        const toRemove = currentDocs.filter(d => !newRefs.has(d.member_reference));
        const unchangedCount = currentRefs.size - toRemove.length;

        // Execute
        const addResult = await this.upsertMembersAsync({ groupUuid, members: toAdd });
        let removedCount = 0;
        if (toRemove.length > 0) {
            const removeResult = await collection.deleteMany({
                group_uuid: groupUuid,
                member_reference: { $in: toRemove.map(d => d.member_reference) }
            });
            removedCount = removeResult.deletedCount;
        }

        logDebug('Replaced members', {
            groupUuid,
            added: addResult.upserted,
            removed: removedCount,
            unchanged: unchangedCount
        });

        return { added: addResult.upserted, removed: removedCount, unchanged: unchangedCount };
    }

    /**
     * Gets active member count for a group
     *
     * @param {string} groupUuid - Group _uuid
     * @returns {Promise<number>}
     */
    async getActiveMemberCount(groupUuid) {
        const collection = await this._getCollection();
        return collection.countDocuments({
            group_uuid: groupUuid,
            inactive: { $ne: true }
        });
    }

    /**
     * Gets active member references for a group
     *
     * @param {string} groupUuid - Group _uuid
     * @returns {Promise<Array<string>>} Array of member reference strings
     */
    async getActiveMembers(groupUuid) {
        const collection = await this._getCollection();
        const docs = await collection
            .find(
                { group_uuid: groupUuid, inactive: { $ne: true } },
                { projection: { member_reference: 1, _id: 0 } }
            )
            .toArray();
        return docs.map(d => d.member_reference);
    }

    /**
     * Finds groups that contain a given member
     *
     * @param {Object} criteria
     * @param {string} [criteria.memberReference] - e.g., "Patient/123"
     * @returns {Promise<Array<string>>} Array of group _uuid strings
     */
    async findGroupsByMemberCriteria(criteria) {
        const collection = await this._getCollection();

        let filter;
        if (criteria.memberReference) {
            filter = { member_reference: criteria.memberReference, inactive: { $ne: true } };
        } else {
            return [];
        }

        const docs = await collection
            .find(filter, { projection: { group_uuid: 1, _id: 0 } })
            .toArray();

        return [...new Set(docs.map(d => d.group_uuid))];
    }

    /**
     * Gets active members with count (for enrichment provider)
     *
     * @param {string} groupUuid
     * @returns {Promise<{members: Array<Object>, count: number}>}
     */
    async getCurrentMembersWithCountAsync(groupUuid) {
        const collection = await this._getCollection();
        const docs = await collection
            .find(
                { group_uuid: groupUuid, inactive: { $ne: true } },
                { projection: { _id: 0, group_uuid: 0 } }
            )
            .toArray();

        return {
            members: docs.map(d => ({
                entity: {
                    reference: d.member_reference
                },
                period: d.period,
                inactive: d.inactive
            })),
            count: docs.length
        };
    }

    /**
     * Deletes all members for a group
     *
     * @param {string} groupUuid
     * @returns {Promise<{deleted: number}>}
     */
    async deleteAllMembersAsync(groupUuid) {
        const collection = await this._getCollection();
        const result = await collection.deleteMany({ group_uuid: groupUuid });
        return { deleted: result.deletedCount };
    }

    /**
     * Gets collection stats (for performance tests)
     *
     * @returns {Promise<Object>}
     */
    async getCollectionStats() {
        const collection = await this._getCollection();
        const db = await this.mongoDatabaseManager.getClientDbAsync();
        const stats = await db.command({ collStats: COLLECTIONS.GROUP_MEMBER_DIRECT });
        return stats;
    }
}

module.exports = { MongoDirectGroupMemberRepository };
