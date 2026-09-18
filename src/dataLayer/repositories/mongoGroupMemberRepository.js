const { assertTypeEquals } = require('../../utils/assertType');
const { DatabaseQueryFactory } = require('../databaseQueryFactory');
const { FastDatabaseBulkInserter } = require('../fastDatabaseBulkInserter');
const { RemoveHelper } = require('../../operations/remove/removeHelper');
const GroupMember = require('../../fhir/classes/4_0_0/custom_resources/groupMember');
const Meta = require('../../fhir/classes/4_0_0/complex_types/meta');
const { generateUUIDv5 } = require('../../utils/uid.util');
const { GROUP_MEMBER_RESOURCE_TYPE } = require('../../constants');
const { resolveMemberWrite } = require('../../operations/common/resolveMemberWrite');
const { FhirRequestInfo } = require('../../utils/fhirRequestInfo');

/**
 * Repository for the MongoDB-native, large-Group ("extended") member storage, written from
 * GroupMemberPatchStrategy's Mongo-native branch when a PATCH targets an extended Group's
 * /member. Writes go through FastDatabaseBulkInserter -- insertOneAsync() for a fresh row,
 * replaceOneAsync() for an update/reactivation (see applyMemberEventsAsync for why the split
 * matters); reads use the raw-document path, not toObjectArrayAsync().
 *
 * applyMemberEventsAsync() flushes its own buffered create/update writes before returning, so
 * callers don't need their own reference to this same FastDatabaseBulkInserter instance just to
 * commit it.
 *
 * A PATCH remove hard-deletes the row instead of a soft inactive:true flag, via
 * RemoveHelper.deleteManyAsync() (history-then-delete), wired to the databaseBulkInserter
 * since RemoveHelper isn't Fast-compatible. The tombstone is identified purely by the history
 * entry's request.method being 'DELETE' -- there is no operation field on GroupMember itself.
 */
class MongoGroupMemberRepository {
    /**
     * @param {DatabaseQueryFactory} databaseQueryFactory
     * @param {FastDatabaseBulkInserter} databaseBulkInserter
     * @param {RemoveHelper} removeHelper
     */
    constructor({ databaseQueryFactory, databaseBulkInserter, removeHelper }) {
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);
        /** @type {DatabaseQueryFactory} */
        this.databaseQueryFactory = databaseQueryFactory;

        assertTypeEquals(databaseBulkInserter, FastDatabaseBulkInserter);
        /** @type {FastDatabaseBulkInserter} */
        this.databaseBulkInserter = databaseBulkInserter;

        assertTypeEquals(removeHelper, RemoveHelper);
        /** @type {RemoveHelper} */
        this.removeHelper = removeHelper;
    }

    /**
     * Derives a membership row's stable identity (_uuid) deterministically from the owning
     * Group and the member's own resolved global identity (entity._uuid) -- not
     * entity.reference, the raw string a caller submitted, which can take more than one form
     * for the same real-world entity (e.g. a local-id-form reference vs. a global-id-form
     * reference for the same Patient). Hashing entity._uuid means the same real-world entity
     * always maps to the same row, regardless of which reference form a given PATCH add
     * operation used (design doc §3.2).
     *
     * @param {string} groupUuid
     * @param {string} entityUuid - the member's resolved entity._uuid (see enrichMemberReferences)
     * @returns {string}
     */
    static rowUuid(groupUuid, entityUuid) {
        return generateUUIDv5(`${groupUuid}|${entityUuid}`);
    }

    /**
     * Queues a batch of PATCH add/remove events against the live roster; each membership is
     * targeted directly by its own deterministic row id -- the incoming set is never diffed
     * against the whole roster.
     *
     * @param {Object} params
     * @param {FhirRequestInfo} params.requestInfo
     * @param {string} params.base_version
     * @param {string} params.groupUuid
     * @param {number} params.groupVersionId - parent Group's meta.versionId at time of write
     * @param {string} params.sourceAssigningAuthority - copied from the owning Group
     * @param {Coding[]|undefined} params.securityTags - copied from the owning Group's meta.security
     * @param {Array<{entity: {reference:string, _uuid:string, type:string|undefined, display:string|undefined}, period:Object|undefined, op:'add'|'remove'}>} params.events
     *   entity._uuid must already be populated (see enrichMemberReferences) -- it's what row
     *   identity is derived from, not entity.reference.
     * @returns {Promise<Array<{reference:string, operation:'create'|'update'|'delete'|'none'}>>}
     */
    async applyMemberEventsAsync({ requestInfo, base_version, groupUuid, groupVersionId, sourceAssigningAuthority, securityTags, events }) {
        if (!events || events.length === 0) {
            return [];
        }

        // De-dupe by row id within one call -- last event for a given entity wins.
        const eventsByRowUuid = new Map();
        for (const event of events) {
            const rowUuid = MongoGroupMemberRepository.rowUuid(groupUuid, event.entity._uuid);
            eventsByRowUuid.set(rowUuid, event);
        }

        const databaseQueryManager = this.databaseQueryFactory.createQuery({
            resourceType: GROUP_MEMBER_RESOURCE_TYPE,
            base_version
        });
        const cursor = await databaseQueryManager.findAsync({
            query: { groupUuid, _uuid: { $in: [...eventsByRowUuid.keys()] } }
        });
        // Raw documents, not toObjectArrayAsync(): reads only need the plain field values.
        const existingRows = await cursor.toArrayAsync();
        const existingByRowUuid = new Map(existingRows.map((r) => [r._uuid, r]));

        const now = new Date();
        const outcomes = [];
        const docsToDelete = [];
        let hasBufferedWrite = false;

        for (const [rowUuid, event] of eventsByRowUuid) {
            const existingRow = existingByRowUuid.get(rowUuid);
            const { classification, member } = resolveMemberWrite(existingRow?.member, event);

            outcomes.push({ reference: event.entity.reference, operation: classification });

            if (classification === 'none') {
                continue;
            }

            const previousVersionId = parseInt(existingRow?.meta?.versionId, 10);
            const doc = new GroupMember({
                id: rowUuid,
                _uuid: rowUuid,
                meta: new Meta({
                    versionId: `${Number.isNaN(previousVersionId) ? 1 : previousVersionId + 1}`,
                    lastUpdated: now,
                    security: securityTags
                }),
                _sourceAssigningAuthority: sourceAssigningAuthority,
                groupUuid,
                groupVersionId,
                member
            });

            if (classification === 'delete') {
                docsToDelete.push(doc);
                continue;
            }

            if (classification === 'create') {
                await this.databaseBulkInserter.insertOneAsync({
                    base_version,
                    requestInfo,
                    resourceType: GROUP_MEMBER_RESOURCE_TYPE,
                    doc
                });
            } else {
                await this.databaseBulkInserter.replaceOneAsync({
                    base_version,
                    requestInfo,
                    resourceType: GROUP_MEMBER_RESOURCE_TYPE,
                    uuid: rowUuid,
                    doc,
                    patches: null
                });
            }
            hasBufferedWrite = true;
        }

        if (hasBufferedWrite) {
            await this.databaseBulkInserter.executeAsync({ requestInfo, base_version });
        }

        if (docsToDelete.length > 0) {
            // Cloned FhirRequestInfo overrides method to 'DELETE' for the tombstone.
            // removeHelper.deleteManyAsync self-flushes (history then delete), unlike the
            // buffered writes above.
            await this.removeHelper.deleteManyAsync({
                requestInfo: new FhirRequestInfo({ ...requestInfo, method: 'DELETE' }),
                resourceType: GROUP_MEMBER_RESOURCE_TYPE,
                resources: docsToDelete,
                base_version
            });
        }

        return outcomes;
    }
}

module.exports = { MongoGroupMemberRepository };
