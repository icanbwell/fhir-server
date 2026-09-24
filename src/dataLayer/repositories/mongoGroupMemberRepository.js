const { assertTypeEquals } = require('../../utils/assertType');
const { DatabaseQueryFactory } = require('../databaseQueryFactory');
const { FastDatabaseBulkInserter } = require('../fastDatabaseBulkInserter');
const { RemoveHelper } = require('../../operations/remove/removeHelper');
const { FhirResourceWriteSerializer } = require('../../fhir/fhirResourceWriteSerializer');
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
 * flushes its own buffered create/update writes before returning (so callers don't need their
 * own reference to this same FastDatabaseBulkInserter instance just to commit it), unless told
 * not to via `flush: false` -- see that method's own docstring for when a caller needs that.
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
     */
    constructor({ databaseQueryFactory, fastDatabaseBulkInserter, removeHelper }) {
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);
        /** @type {DatabaseQueryFactory} */
        this.databaseQueryFactory = databaseQueryFactory;

        assertTypeEquals(fastDatabaseBulkInserter, FastDatabaseBulkInserter);
        /** @type {FastDatabaseBulkInserter} */
        this.fastDatabaseBulkInserter = fastDatabaseBulkInserter;

        assertTypeEquals(removeHelper, RemoveHelper);
        /** @type {RemoveHelper} */
        this.removeHelper = removeHelper;
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
     * @param {boolean} [params.flush] - defaults to true (flush immediately, the PATCH caller's
     *   behavior: one resource per request, nothing else sharing its buffer). A caller that stages
     *   other resources under the same requestId's buffer before its own end-of-request flush (e.g.
     *   a $merge batch, which only flushes once after its whole resource loop finishes) should pass
     *   false: the create/update ops staged here then simply join that same buffer and get flushed
     *   together with everything else, instead of this call prematurely flushing and clearing
     *   entries the caller already staged earlier for other resources under the same requestId.
     * @returns {Promise<Array<{reference:string, operation:'create'|'update'|'delete'|'none'}>>}
     */
    async applyResolvedMemberWritesAsync({ requestInfo, base_version, groupUuid, groupVersionId, groupLastUpdated, sourceAssigningAuthority, securityTags, resolvedMemberWrites, flush = true }) {
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

        if (hasBufferedWrite && flush) {
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
     * Deletes every GroupMember_4_0_0 row for groupUuid, optionally scoped to an exact
     * meta.versionId. Exact match only, never a $gte/$lt range -- meta.versionId is stored as a
     * FHIR `id` string (see every other query against it in this codebase, e.g.
     * databaseBulkInserter.js's optimistic-concurrency checks), and a range comparison against a
     * string field sorts lexicographically, not numerically ("10" sorts before "9"), silently
     * matching or missing the wrong rows.
     *
     * Two callers, two different reasons an exact match (or no filter at all) is enough:
     *  - groupPromotion.js's promoteGroup calls this with no versionId, right before writing a
     *    fresh snapshot: a Group that has never successfully extended has no legitimate rows
     *    here at all, so whatever's found can only be leftover from an incomplete earlier
     *    attempt -- no comparison needed, just delete all of it.
     *  - groupPromotion.js's cleanupExtendedGroupOrphansIfNeeded calls this on every write to an
     *    already-extended Group, with versionId set to exactly the version that write is about
     *    to claim: only a row from an attempt that tried (and failed) to reach that exact
     *    version could ever be stamped with it, since the Group's own optimistic-concurrency
     *    check guarantees no two attempts ever both successfully commit the same version
     *    number -- and because this runs on every single write, a dangling row is always caught
     *    on the very next one, before a later write could move the floor past it.
     *
     * @param {Object} params
     * @param {FhirRequestInfo} params.requestInfo
     * @param {string} params.base_version
     * @param {string} params.groupUuid
     * @param {number} [params.versionId] - omit to delete every row for groupUuid.
     * @returns {Promise<number>} how many rows were removed
     */
    async removeMembersAsync({ requestInfo, base_version, groupUuid, versionId }) {
        const databaseQueryManager = this.databaseQueryFactory.createQuery({
            resourceType: GROUP_MEMBER_RESOURCE_TYPE,
            base_version
        });
        const query = versionId === undefined
            ? { groupUuid }
            : { groupUuid, 'meta.versionId': `${versionId}` };
        const cursor = await databaseQueryManager.findAsync({ query });
        // Raw documents, not toObjectArrayAsync(): deleteManyAsync only needs the plain field values.
        const existingMembers = await cursor.toArrayAsync();
        if (existingMembers.length === 0) {
            return 0;
        }

        // Cloned FhirRequestInfo overrides method to 'DELETE' for the tombstone, same as
        // applyResolvedMemberWritesAsync's own delete branch. No preserveLastUpdated here: unlike
        // that branch, these rows aren't being deleted as part of the same write that just
        // stamped a fresh groupLastUpdated on them -- they're stale leftovers being garbage
        // collected, so the tombstone should carry the real time of deletion.
        await this.removeHelper.deleteManyAsync({
            requestInfo: new FhirRequestInfo({ ...requestInfo, method: 'DELETE' }),
            resourceType: GROUP_MEMBER_RESOURCE_TYPE,
            resources: existingMembers,
            base_version
        });
        return existingMembers.length;
    }
}

module.exports = { MongoGroupMemberRepository };
