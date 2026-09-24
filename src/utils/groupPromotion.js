const { logInfo, logError } = require('../operations/common/logging');
const { RethrownError } = require('./rethrownError');
const { BadRequestError } = require('./httpErrors');
const { enrichMemberReferences } = require('./referenceEnricher');
const { MONGO_GROUP_EXTENDED_FIELD } = require('./mongoGroupExtendedTag');
const { createTooCostlyError } = require('./fhirErrorFactory');
const OperationOutcomeIssue = require('../fhir/classes/4_0_0/backbone_elements/operationOutcomeIssue');
const { PATCH_OPERATIONS } = require('../constants/groupConstants');
const Resource = require('../fhir/classes/4_0_0/resources/resource');

/**
 * True when doc is a Group whose member[] has crossed configManager.groupMemberLimit and still
 * needs promoting to MongoDB-native extended member storage (GroupMember_4_0_0). Only reachable
 * for an existing Group crossing the limit (PUT-update, PATCH, $merge-update/insert, all of which
 * already have an addressable identity and a safe rollback -- see promoteExistingGroupIfNeeded and
 * mergeManager.js). A brand-new Group (CREATE, PUT-insert) that arrives already over the limit is
 * rejected outright instead -- see rejectNewGroupIfOverLimit.
 *
 * @param {Object} params
 * @param {Resource} params.doc
 * @param {import('./configManager').ConfigManager} params.configManager
 * @returns {boolean}
 */
function isGroupOverLimit ({ doc, configManager }) {
    // isGroupOverLimit is called for every resource write, not just Group ones (unlike
    // GroupMemberPatchStrategy.determineGroupMemberType, whose caller already filters to Group
    // before it's ever invoked) -- so resourceType is checked first, to bail out before touching
    // any Group-specific field on a non-Group doc at all.
    if (doc.resourceType !== 'Group' || !configManager.enableExtendedGroup) {
        return false;
    }
    if (doc[MONGO_GROUP_EXTENDED_FIELD] === true) {
        return false;
    }
    // Mutually exclusive with ClickHouse tracking by design (see configManager's
    // enableExtendedGroup docstring) -- guarded explicitly here too, defensively, rather than
    // relying only on operators never enabling both for the same resource type.
    if (configManager.enableClickHouse && configManager.mongoWithClickHouseResources.includes('Group')) {
        return false;
    }
    return (doc.member || []).length > configManager.groupMemberLimit;
}

/**
 * Writes doc.member into GroupMember_4_0_0, then strips member[] and sets MONGO_GROUP_EXTENDED_FIELD
 * (`_extended`) on doc -- the caller must not have staged doc for its own write yet, so the
 * strip+flag rides along in the SAME physical write and the SAME meta.versionId bump the caller
 * already intends, instead of a second, separately-versioned write.
 *
 * Callers must have already ensured doc._uuid and doc._sourceAssigningAuthority are set -- true for
 * every caller of promoteGroup, since only an existing resource (carrying them forward) is ever
 * promoted; a brand-new Group already over the limit is rejected outright instead (see
 * rejectNewGroupIfOverLimit) rather than promoted.
 *
 * @param {Object} params
 * @param {Resource} params.doc - Mutated in place (member deleted, MONGO_GROUP_EXTENDED_FIELD set).
 * @param {import('./fhirRequestInfo').FhirRequestInfo} params.requestInfo
 * @param {string} params.base_version
 * @param {import('../dataLayer/repositories/mongoGroupMemberRepository').MongoGroupMemberRepository} params.mongoGroupMemberRepository
 * @param {boolean} [params.flush] - forwarded to applyResolvedMemberWritesAsync; see that
 *   method's own docstring. Defaults to true (self-flush) for create/update/patch, which each
 *   handle one resource per request. mergeManager passes false: a $merge batch stages every
 *   resource under the same requestId's buffer and only flushes once, after its whole loop
 *   finishes, so the roster's create/update ops just need to join that same buffer, not trigger
 *   their own premature flush of everything staged so far.
 * @returns {Promise<Map<string, {writeRequest: Object, writeType: 'create'|'update'|'delete'|'none', member: Object|undefined}>>}
 *   the resolvedMemberWrites this call staged. A `flush: false` caller (mergeManager.js) that
 *   goes on to stage its own doc right after this call does NOT roll these back if that
 *   subsequent staging fails -- the Group's own version is never bumped on that failure, so the
 *   Group is left exactly as if promotion had crashed mid-flight: still over-limit, not yet
 *   marked extended. The next write to the same uuid re-enters promotion and resolves every
 *   member through the same resolveMemberWrite state table, so rows already buffered/flushed here
 *   classify as 'none'/'update' instead of duplicating.
 */
async function promoteGroup ({ doc, requestInfo, base_version, mongoGroupMemberRepository, flush = true }) {
    const members = doc.member;
    try {
        // Members submitted directly on a create/PUT/$merge body, or appended via a standard
        // JSON-Patch op on the embedded array, never go through referenceGlobalIdHandler (that
        // only runs later, inside the caller's own insertOneAsync/replaceOneAsync/mergeOneAsync
        // call) -- so entity._uuid/_sourceId may not be populated yet. enrichMemberReferences
        // mirrors that handler for exactly this kind of bypass and is a no-op for any entry
        // that's already enriched.
        enrichMemberReferences(members, doc._sourceAssigningAuthority);

        const memberMissingReference = members.find((member) => !member.entity?.reference);
        if (memberMissingReference) {
            throw new BadRequestError({
                message: `Missing required member.entity.reference while promoting Group to extended member storage: ${JSON.stringify(memberMissingReference)}`,
                toString: function () { return this.message; }
            }, {
                issue: [new OperationOutcomeIssue({
                    severity: 'error',
                    code: 'required',
                    diagnostics: 'Each Group member must include entity.reference to be promoted to extended member storage'
                })]
            });
        }

        const isResourceInstance = doc instanceof Resource;
        const writeRequests = members.map((member) => ({
            ...(isResourceInstance ? member.toJSONInternal() : member),
            op: PATCH_OPERATIONS.ADD
        }));

        const groupUuid = doc._uuid;

        // A Group reaching this point has never successfully extended (isGroupOverLimit already
        // confirmed MONGO_GROUP_EXTENDED_FIELD isn't set), so there is no legitimate row for it
        // in GroupMember_4_0_0 yet -- anything found can only be leftover from an earlier
        // promotion attempt that wrote the roster but never reached its own commit (a crash, or
        // losing doc's own optimistic-concurrency race to an unrelated write). Unlike the
        // already-extended steady-state case, there's no existing content here worth preserving
        // or merging against, so wipe it unconditionally rather than trying to tell stale rows
        // apart from fresh ones by version. See MongoGroupMemberRepository.removeMembersAsync's
        // own docstring for why that's also true for the already-extended case, just handled
        // differently (see cleanupExtendedGroupOrphansIfNeeded below).
        await mongoGroupMemberRepository.removeMembersAsync({ requestInfo, base_version, groupUuid });

        // Every member below is therefore a fresh create -- resolveMemberWritesAsync's own DB
        // read (against the now-empty roster) will find nothing to resolve against.
        const resolvedMemberWrites = await mongoGroupMemberRepository.resolveMemberWritesAsync({
            base_version,
            groupUuid,
            writeRequests
        });

        // Write the roster into GroupMember_4_0_0 BEFORE mutating doc -- doc must only be
        // stripped/flagged once the roster is durably written, so a crash before this line leaves
        // the Group untouched (still over-limit, not yet promoted) for the next write to retry.
        await mongoGroupMemberRepository.applyResolvedMemberWritesAsync({
            requestInfo,
            base_version,
            groupUuid,
            groupVersionId: parseInt(doc.meta.versionId, 10),
            groupLastUpdated: doc.meta.lastUpdated,
            sourceAssigningAuthority: doc._sourceAssigningAuthority,
            securityTags: doc.meta.security,
            resolvedMemberWrites,
            flush
        });

        // Only now, with the roster durably written, fold the promotion into the doc that's about
        // to be staged for its own (already in-flight) write.
        delete doc.member;
        doc[MONGO_GROUP_EXTENDED_FIELD] = true;

        logInfo('Promoted Group to extended member storage', {
            groupId: doc.id,
            rosterSize: members.length
        });

        return resolvedMemberWrites;
    } catch (error) {
        logError('Error promoting Group to extended member storage', {
            error: error.message,
            groupId: doc.id
        });
        throw new RethrownError({
            message: 'Error promoting Group to extended member storage',
            error,
            args: { groupId: doc.id }
        });
    }
}

/**
 * Promotes an existing Group (PUT-update, PATCH, $merge-update) whose member[] has crossed the
 * limit. doc._uuid/_sourceAssigningAuthority are already set -- they're persisted fields carried
 * forward from the resource that was loaded, not something this request computes.
 *
 * @param {Object} params
 * @param {Resource} params.doc
 * @param {import('./fhirRequestInfo').FhirRequestInfo} params.requestInfo
 * @param {string} params.base_version
 * @param {import('./configManager').ConfigManager} params.configManager
 * @param {import('../dataLayer/repositories/mongoGroupMemberRepository').MongoGroupMemberRepository} params.mongoGroupMemberRepository
 * @param {boolean} [params.flush] - see promoteGroup's docstring.
 * @returns {Promise<Map|undefined>} promoteGroup's resolvedMemberWrites, or undefined if doc
 *   wasn't over the limit and nothing was promoted. See promoteGroup's own docstring for how a
 *   `flush: false` caller must use this to roll back on a subsequent failure.
 */
async function promoteExistingGroupIfNeeded ({ doc, requestInfo, base_version, configManager, mongoGroupMemberRepository, flush = true }) {
    if (!isGroupOverLimit({ doc, configManager })) {
        return undefined;
    }
    return promoteGroup({ doc, requestInfo, base_version, mongoGroupMemberRepository, flush });
}

/**
 * Deletes any GroupMember_4_0_0 row left behind by a failed write to an already-extended Group,
 * before this write's own commit proceeds. Needed because, once a Group is extended, nothing
 * else re-examines the roster on every write the way isGroupOverLimit's "still over the limit"
 * check does for a not-yet-extended Group (see promoteGroup's own wipe-before-promote for that
 * case) -- so without this, a plain metadata-only write could advance the Group's version right
 * past a dangling row and make it indistinguishable from a real member.
 *
 * @param {Object} params
 * @param {Resource} params.doc - the resource about to be written, with meta.versionId already
 *   bumped in-memory to the version this write is about to claim.
 * @param {import('./fhirRequestInfo').FhirRequestInfo} params.requestInfo
 * @param {string} params.base_version
 * @param {import('./configManager').ConfigManager} params.configManager
 * @param {import('../dataLayer/repositories/mongoGroupMemberRepository').MongoGroupMemberRepository} params.mongoGroupMemberRepository
 * @returns {Promise<void>}
 */
async function cleanupExtendedGroupOrphansIfNeeded ({ doc, requestInfo, base_version, configManager, mongoGroupMemberRepository }) {
    if (doc.resourceType !== 'Group' || !configManager.enableExtendedGroup || doc[MONGO_GROUP_EXTENDED_FIELD] !== true) {
        return;
    }
    await mongoGroupMemberRepository.removeMembersAsync({
        requestInfo,
        base_version,
        groupUuid: doc._uuid,
        versionId: parseInt(doc.meta.versionId, 10)
    });
}

/**
 * Rejects a brand-new Group (CREATE, PUT-insert) whose member[] already arrives over the limit. A
 * brand-new Group has no addressable identity yet -- a fresh POST always mints a new id/_uuid, so
 * if promotion durably wrote the roster and the Group's own write then failed, no client retry
 * could ever reach those rows to complete or clean up promotion. Every other path -- PUT-update,
 * PATCH, and both $merge branches -- keeps promoting instead of rejecting: all four operate on a
 * Group that already has (or, for $merge-insert, is given by the client rather than
 * server-minted) a stable, addressable identity, so if the roster write durably lands but the
 * Group's own write then fails for any of them, nothing is orphaned -- the Group's version is
 * never bumped, and the next write to that same uuid simply re-enters promotion and resolves
 * cleanly, same as any other crash-recovery case. This is a narrower reject scope
 * than the original epic doc's Task B1 (which rejected any single bulk write, including PUT-update
 * and $merge, promoting only a dedicated incremental-add operation that no longer exists in this
 * codebase) -- scoped down deliberately to just the orphan-risk case, not full doc fidelity.
 *
 * @param {Object} params
 * @param {Resource} params.doc
 * @param {import('./configManager').ConfigManager} params.configManager
 * @returns {void}
 * @throws {BadRequestError} when doc.member[] exceeds configManager.groupMemberLimit
 */
function rejectNewGroupIfOverLimit ({ doc, configManager }) {
    if (!isGroupOverLimit({ doc, configManager })) {
        return;
    }
    const { message, options } = createTooCostlyError({
        actual: doc.member.length,
        limit: configManager.groupMemberLimit,
        operation: 'PUT'
    });
    throw new BadRequestError({ message }, options);
}

module.exports = {
    isGroupOverLimit,
    promoteExistingGroupIfNeeded,
    rejectNewGroupIfOverLimit,
    cleanupExtendedGroupOrphansIfNeeded
};
