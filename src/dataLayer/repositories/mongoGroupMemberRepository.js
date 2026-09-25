const { assertTypeEquals } = require('../../utils/assertType');
const { DatabaseQueryFactory } = require('../databaseQueryFactory');
const { FastDatabaseBulkInserter } = require('../fastDatabaseBulkInserter');
const { RemoveHelper } = require('../../operations/remove/removeHelper');
const { FhirResourceWriteSerializer } = require('../../fhir/fhirResourceWriteSerializer');
const { ResourceLocatorFactory } = require('../../operations/common/resourceLocatorFactory');
const { generateUUIDv5 } = require('../../utils/uid.util');
const { GROUP_MEMBER_RESOURCE_TYPE } = require('../../constants');
const { resolveMemberWrite } = require('../../operations/common/resolveMemberWrite');
const { FhirRequestInfo } = require('../../utils/fhirRequestInfo');

/**
 * Repository for the MongoDB-native, large-Group ("extended") member storage, written from
 * GroupMemberPatchStrategy's Mongo-native branch when a PATCH targets an extended Group's
 * /member. This is a plain resource write, not an event log: each requested write resolves to
 * a real create/update/delete of a GroupMember_4_0_0 document. Writes go through
 * FastDatabaseBulkInserter -- insertOneAsync() for a fresh member, replaceOneAsync() for an
 * update/reactivation (see applyResolvedMemberWritesAsync for why the split matters); reads use
 * the raw-document path, not toObjectArrayAsync().
 *
 * Callers always call resolveMemberWritesAsync() first (a read-only lookup against the live
 * members, deciding what each requested write actually needs to do) and then, unless every one
 * of them resolved to a no-op, pass that same result into applyResolvedMemberWritesAsync() to
 * write it -- one DB read+resolve per PATCH request, not two. applyResolvedMemberWritesAsync()
 * flushes its own buffered create/update writes before returning, so callers don't need their
 * own reference to this same FastDatabaseBulkInserter instance just to commit it.
 *
 * A PATCH remove hard-deletes the GroupMember document instead of a soft inactive:true flag, via
 * RemoveHelper.deleteManyAsync() (history-then-delete), wired to the databaseBulkInserter
 * since RemoveHelper isn't Fast-compatible. The tombstone is identified purely by the history
 * entry's request.method being 'DELETE' -- there is no operation field on GroupMember itself.
 */
class MongoGroupMemberRepository {
    /**
     * @param {DatabaseQueryFactory} databaseQueryFactory
     * @param {FastDatabaseBulkInserter} fastDatabaseBulkInserter
     * @param {RemoveHelper} removeHelper
     * @param {ResourceLocatorFactory} resourceLocatorFactory
     */
    constructor({ databaseQueryFactory, fastDatabaseBulkInserter, removeHelper, resourceLocatorFactory }) {
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);
        /** @type {DatabaseQueryFactory} */
        this.databaseQueryFactory = databaseQueryFactory;

        assertTypeEquals(fastDatabaseBulkInserter, FastDatabaseBulkInserter);
        /** @type {FastDatabaseBulkInserter} */
        this.fastDatabaseBulkInserter = fastDatabaseBulkInserter;

        assertTypeEquals(removeHelper, RemoveHelper);
        /** @type {RemoveHelper} */
        this.removeHelper = removeHelper;

        assertTypeEquals(resourceLocatorFactory, ResourceLocatorFactory);
        /** @type {ResourceLocatorFactory} */
        this.resourceLocatorFactory = resourceLocatorFactory;
    }

    /**
     * Derives a GroupMember document's stable identity (_uuid) deterministically from the
     * owning Group and the member's own resolved global identity (entity._uuid) -- not
     * entity.reference, the raw string a caller submitted, which can take more than one form
     * for the same real-world entity (e.g. a local-id-form reference vs. a global-id-form
     * reference for the same Patient). Hashing entity._uuid means the same real-world entity
     * always maps to the same GroupMember document, regardless of which reference form a given
     * PATCH add operation used (design doc §3.2).
     *
     * @param {string} groupUuid
     * @param {string} entityUuid - the member's resolved entity._uuid (see enrichMemberReferences)
     * @returns {string}
     */
    static deriveMemberUuid(groupUuid, entityUuid) {
        return generateUUIDv5(`${groupUuid}|${entityUuid}`);
    }

    /**
     * Reads current membership for the given requested writes and, for each one, resolves (via
     * resolveMemberWrite) exactly what it needs: create/update/delete/none. Writes nothing
     * itself.
     *
     * Resolving always requires a DB read (to know what's already there), so there's no reason
     * to pay for that read twice per PATCH request. Callers that need to know ahead of time
     * whether a batch of requested writes is a genuine no-op (e.g. removing an already-absent
     * member, or re-adding one with identical period/type/display/inactive -- both resolve to
     * 'none') call this once, and -- if it isn't a no-op -- pass the very same Map into
     * applyResolvedMemberWritesAsync to actually write it, instead of resolving a second time.
     *
     * @param {Object} params
     * @param {string} params.base_version
     * @param {string} params.groupUuid
     * @param {Array<Object>} params.writeRequests
     * @returns {Promise<Map<string, {writeRequest: Object, writeType: 'create'|'update'|'delete'|'none', member: Object|undefined}>>}
     */
    async resolveMemberWritesAsync({ base_version, groupUuid, writeRequests }) {
        if (!writeRequests || writeRequests.length === 0) {
            return new Map();
        }

        // De-dupe by member identity within one call -- last requested write for a given entity wins.
        const writeRequestsByMemberUuid = new Map();
        for (const writeRequest of writeRequests) {
            const memberUuid = MongoGroupMemberRepository.deriveMemberUuid(groupUuid, writeRequest.entity._uuid);
            writeRequestsByMemberUuid.set(memberUuid, writeRequest);
        }

        const databaseQueryManager = this.databaseQueryFactory.createQuery({
            resourceType: GROUP_MEMBER_RESOURCE_TYPE,
            base_version
        });
        const cursor = await databaseQueryManager.findAsync({
            query: { groupUuid, _uuid: { $in: [...writeRequestsByMemberUuid.keys()] } }
        });
        // Raw documents, not toObjectArrayAsync(): reads only need the plain field values.
        const existingMembers = await cursor.toArrayAsync();
        const existingMembersByUuid = new Map(existingMembers.map((m) => [m._uuid, m]));

        const resolvedMemberWrites = new Map();
        for (const [memberUuid, writeRequest] of writeRequestsByMemberUuid) {
            const existingMember = existingMembersByUuid.get(memberUuid);
            const { writeType, member } = resolveMemberWrite(existingMember?.member, writeRequest);
            resolvedMemberWrites.set(memberUuid, { writeRequest, writeType, member });
        }
        return resolvedMemberWrites;
    }

    /**
     * Writes every non-'none' resolution from a prior resolveMemberWritesAsync call. Callers
     * that haven't already resolved (there currently are none in production code -- every call
     * site needs to check for a no-op first anyway) should call resolveMemberWritesAsync
     * themselves and pass the result here, rather than this method resolving again internally.
     *
     * @param {Object} params
     * @param {FhirRequestInfo} params.requestInfo
     * @param {string} params.base_version
     * @param {string} params.groupUuid - parent Group's _uuid, stamped onto every GroupMember
     *   document this call touches (same value resolveMemberWritesAsync was called with, for
     *   these same writes).
     * @param {number} params.groupVersionId - parent Group's meta.versionId at time of write;
     *   stamped onto every GroupMember document this call touches (create or update) as that
     *   document's own meta.versionId too -- there is no independent per-member version
     *   counter, so a membership document's meta.versionId always tells you exactly which Group
     *   version last touched it.
     * @param {Date} params.groupLastUpdated - parent Group's meta.lastUpdated at time of write;
     *   stamped onto every GroupMember document this call touches, so every one created/updated
     *   by the same PATCH shares one identical lastUpdated with each other and with the Group
     *   itself.
     * @param {string} params.sourceAssigningAuthority - copied from the owning Group
     * @param {Coding[]|undefined} params.securityTags - copied from the owning Group's meta.security
     * @param {Map<string, {writeRequest: Object, writeType: 'create'|'update'|'delete'|'none', member: Object|undefined}>} params.resolvedMemberWrites
     *   the result of a prior resolveMemberWritesAsync call against these same requested writes.
     * @returns {Promise<Array<{reference:string, operation:'create'|'update'|'delete'|'none'}>>}
     */
    async applyResolvedMemberWritesAsync({ requestInfo, base_version, groupUuid, groupVersionId, groupLastUpdated, sourceAssigningAuthority, securityTags, resolvedMemberWrites }) {
        if (!resolvedMemberWrites || resolvedMemberWrites.size === 0) {
            return [];
        }

        const outcomes = [];
        const docsToDelete = [];
        let hasBufferedWrite = false;

        for (const [memberUuid, { writeRequest, writeType, member }] of resolvedMemberWrites) {
            outcomes.push({ reference: writeRequest.entity.reference, operation: writeType });

            if (writeType === 'none') {
                continue;
            }

            const doc = FhirResourceWriteSerializer.serialize({
                obj: {
                    resourceType: GROUP_MEMBER_RESOURCE_TYPE,
                    id: memberUuid,
                    _uuid: memberUuid,
                    meta: {
                        versionId: `${groupVersionId}`,
                        lastUpdated: groupLastUpdated,
                        security: securityTags
                    },
                    _sourceAssigningAuthority: sourceAssigningAuthority,
                    groupUuid,
                    member
                }
            });

            if (writeType === 'delete') {
                docsToDelete.push(doc);
                continue;
            }

            if (writeType === 'create') {
                await this.fastDatabaseBulkInserter.insertOneAsync({
                    base_version,
                    requestInfo,
                    resourceType: GROUP_MEMBER_RESOURCE_TYPE,
                    doc
                });
            } else {
                await this.fastDatabaseBulkInserter.replaceOneAsync({
                    requestInfo,
                    resourceType: GROUP_MEMBER_RESOURCE_TYPE,
                    uuid: memberUuid,
                    doc,
                    patches: null
                });
            }
            hasBufferedWrite = true;
        }

        if (hasBufferedWrite) {
            await this.fastDatabaseBulkInserter.executeAsync({ requestInfo, base_version });
        }

        if (docsToDelete.length > 0) {
            // Cloned FhirRequestInfo overrides method to 'DELETE' for the tombstone.
            // removeHelper.deleteManyAsync self-flushes (history then delete), unlike the
            // buffered writes above. preserveLastUpdated: true keeps the groupLastUpdated already
            // stamped on each doc above -- without it, deleteManyAsync unconditionally overwrites
            // meta.lastUpdated with the current wall-clock time, breaking four-way parity
            // (Group/Group_History/GroupMember/GroupMember_History must all share the same
            // lastUpdated) specifically for the remove/tombstone case.
            await this.removeHelper.deleteManyAsync({
                requestInfo: new FhirRequestInfo({ ...requestInfo, method: 'DELETE' }),
                resourceType: GROUP_MEMBER_RESOURCE_TYPE,
                resources: docsToDelete,
                base_version,
                preserveLastUpdated: true
            });
        }

        return outcomes;
    }

    async getMemberCursorAsync({ base_version, groupUuid }) {
        const databaseQueryManager = this.databaseQueryFactory.createQuery({
            resourceType: GROUP_MEMBER_RESOURCE_TYPE,
            base_version
        });
        return await databaseQueryManager.findAsync({
            query: { groupUuid }
        });
    }

    /**
     * Reconstructs the roster as it stood at a point in time, straight from
     * GroupMember_4_0_0_History -- the live GroupMember_4_0_0 collection is never consulted.
     * That's what makes this correct for a membership that was hard-deleted and never revived
     * (no live row exists for it, ever again) and for a Group that was deleted and recreated
     * (live-collection state resets; history doesn't) -- see design doc §6.
     *
     * For each row identity (_uuid), only the latest history entry at or before
     * targetLastUpdated survives; if that latest entry is a tombstone (request.method ===
     * 'DELETE') the row is dropped entirely, since the membership was already removed as of
     * that moment.
     *
     * Backed by the GroupMember_4_0_0_History compound index (customIndexes.js): match by
     * groupUuid, then $sort/$group using the same key order/directions as that index lets
     * MongoDB's $groupByDistinctScan optimization walk it directly (FETCH<-DISTINCT_SCAN, no
     * blocking SORT/GROUP), verified against 55k rows. Keep the $sort spec here in lockstep with
     * the index if either changes.
     *
     * @param {Object} params
     * @param {string} params.base_version
     * @param {string} params.groupUuid
     * @param {Date} params.targetLastUpdated - the target Group version's own meta.lastUpdated
     * @param {string} [params.afterUuid] - resume past this row identity (exclusive). Rows stream
     *   out in ascending resource._uuid order (see the $sort stage below), so this is how a
     *   caller resumes a stream after a mid-read failure without re-emitting or skipping rows --
     *   see MongoReadableStream's timeout-retry path.
     * @param {number} [params.maxTimeMS] - per-query server-side timeout, widened by a caller
     *   retrying after a timeout (see streamGroupMemberArrayAsync's rebuildCursorAsync).
     * @returns {Promise<import('mongodb').AggregationCursor>} yields plain GroupMember documents
     *   (same shape as getMemberCursorAsync's live rows), one per membership still active as of
     *   targetLastUpdated
     */
    async getMemberCursorAtAsync({ base_version, groupUuid, targetLastUpdated, afterUuid, maxTimeMS }) {
        const resourceLocator = this.resourceLocatorFactory.createResourceLocator({
            resourceType: GROUP_MEMBER_RESOURCE_TYPE,
            base_version
        });
        const historyCollection = await resourceLocator.getHistoryCollectionAsync();
        const matchStage = {
            'resource.groupUuid': groupUuid,
            'resource.meta.lastUpdated': { $lte: targetLastUpdated }
        };
        if (afterUuid) {
            matchStage['resource._uuid'] = { $gt: afterUuid };
        }
        return historyCollection.aggregate([
            {
                $match: matchStage
            },
            {
                $sort: {
                    'resource._uuid': 1,
                    'resource.meta.lastUpdated': -1,
                    _id: 1
                }
            },
            {
                $group: {
                    _id: '$resource._uuid',
                    latest: { $first: '$$ROOT' }
                }
            },
            {
                $match: {
                    'latest.request.method': { $ne: 'DELETE' }
                }
            },
            {
                $replaceRoot: { newRoot: '$latest.resource' }
            }
        ], ...(maxTimeMS ? [{ maxTimeMS }] : []));
    }
}

module.exports = { MongoGroupMemberRepository };
