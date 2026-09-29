const { logInfo, logError } = require('../operations/common/logging');
const { RethrownError } = require('./rethrownError');
const { BadRequestError } = require('./httpErrors');
const { enrichMemberReferences } = require('./referenceEnricher');
const { MONGO_GROUP_EXTENDED_FIELD } = require('./mongoGroupExtendedTag');
const { createTooCostlyError } = require('./fhirErrorFactory');
const OperationOutcomeIssue = require('../fhir/classes/4_0_0/backbone_elements/operationOutcomeIssue');
const { PATCH_OPERATIONS } = require('../constants/groupConstants');
const Resource = require('../fhir/classes/4_0_0/resources/resource');
const { isTrue } = require('./isTrue');
const { USE_EXTERNAL_STORAGE_HEADER } = require('./contextDataBuilder');
const { hasExternalStorageMemberTag } = require('./clickHouseGroupPreSave');

/**
 * True when doc is a Group, still in embedded member storage, whose member[] has crossed `limit`.
 * Which limit is the caller's choice: promoteExistingGroupIfNeeded (PATCH) passes
 * configManager.groupMemberPromotionLimit and promotes the Group to MongoDB-native extended member
 * storage (GroupMember_4_0_0); getGroupMemberLimitError (POST, PUT, $merge) passes
 * configManager.groupMemberLimit and rejects the write with too-costly, pointing to PATCH.
 *
 * @param {Object} params
 * @param {Resource} params.doc
 * @param {import('./configManager').ConfigManager} params.configManager
 * @param {number} params.limit - the member-count threshold to compare doc.member.length against;
 *   see the caller-specific configManager getters above.
 * @param {import('./fhirRequestInfo').FhirRequestInfo} [params.requestInfo] - used only to read
 *   the per-request `useexternalstorage` header (see below); safe to omit for callers that can
 *   never reach a ClickHouse-tracked Group (none currently do, but this keeps the parameter
 *   optional rather than forcing every caller to thread it through).
 * @returns {boolean}
 */
function isGroupOverLimit ({ doc, configManager, limit, requestInfo }) {
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
    // enableExtendedGroup docstring), but that exclusivity is a per-REQUEST fact, not a
    // per-SERVER one: GroupMemberPatchStrategy.determineGroupMemberType only routes a given
    // write to ClickHouse when *this* request's own `useexternalstorage` header is truthy --
    // every other write to the same Group (header absent) falls through to the embedded array
    // regardless of server config. Checking enableClickHouse/mongoWithClickHouseResources alone,
    // without the header, would incorrectly disable promotion/rejection for those embedded
    // writes too, letting member[] grow past `limit` with no safety net at all whenever a server
    // merely has ClickHouse+Group configured, whether or not any given caller actually uses it.
    //
    // The header alone isn't enough either, though: addExternalStorageTagIfNeeded's
    // externalStorageFields|member tag is permanent once set (see its own docstring), but a
    // later write to that same Group -- e.g. a plain metadata-only PUT -- has no reason to also
    // resend the useexternalstorage header. Without also checking the persisted tag, such a
    // write would wrongly fall through to the member-limit check below on a Group whose real
    // roster is already ClickHouse's responsibility, not Mongo-native's.
    if (
        configManager.enableClickHouse &&
        configManager.mongoWithClickHouseResources.includes('Group') &&
        (isTrue(requestInfo?.headers?.[USE_EXTERNAL_STORAGE_HEADER]) || hasExternalStorageMemberTag(doc))
    ) {
        return false;
    }
    return (doc.member || []).length > limit;
}

/**
 * Writes doc.member into GroupMember_4_0_0, then strips member[] and sets MONGO_GROUP_EXTENDED_FIELD
 * (`_extended`) on doc -- the caller must not have staged doc for its own write yet, so the
 * strip+flag rides along in the SAME physical write and the SAME meta.versionId bump the caller
 * already intends, instead of a second, separately-versioned write.
 *
 * Only PATCH promotes, and only an existing resource can be patched, so doc._uuid and
 * doc._sourceAssigningAuthority are always already set (carried forward from the loaded Group).
 *
 * @param {Object} params
 * @param {Resource} params.doc - Mutated in place (member deleted, MONGO_GROUP_EXTENDED_FIELD set).
 * @param {import('./fhirRequestInfo').FhirRequestInfo} params.requestInfo
 * @param {string} params.base_version
 * @param {import('../dataLayer/repositories/mongoGroupMemberRepository').MongoGroupMemberRepository} params.mongoGroupMemberRepository
 * @returns {Promise<Map<string, {writeRequest: Object, writeType: 'create'|'update'|'delete'|'none', member: Object|undefined}>>}
 *   the resolvedMemberWrites this call wrote. They are not rolled back if the caller's own write
 *   of doc then fails -- the Group's own version is never bumped on that failure, so the Group is
 *   left exactly as if promotion had crashed mid-flight: still over-limit, not yet marked
 *   extended. The next PATCH that crosses the limit re-enters promotion, which wipes these rows
 *   first.
 * @throws if the roster write fails; doc is left unmodified, so the caller must not write it.
 */
async function promoteGroup ({ doc, requestInfo, base_version, mongoGroupMemberRepository }) {
    const members = doc.member;
    try {
        // Members appended via a standard JSON-Patch op on the embedded array never go through
        // referenceGlobalIdHandler (that only runs later, inside patch.js's own replaceOneAsync
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
            resolvedMemberWrites
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
 * Promotes a Group whose member[] a PATCH has pushed over groupMemberPromotionLimit. PATCH is the
 * only write that promotes; POST, PUT and $merge reject an over-limit member[] instead (see
 * getGroupMemberLimitError).
 *
 * @param {Object} params
 * @param {Resource} params.doc
 * @param {import('./fhirRequestInfo').FhirRequestInfo} params.requestInfo
 * @param {string} params.base_version
 * @param {import('./configManager').ConfigManager} params.configManager
 * @param {import('../dataLayer/repositories/mongoGroupMemberRepository').MongoGroupMemberRepository} params.mongoGroupMemberRepository
 * @returns {Promise<Map|undefined>} promoteGroup's resolvedMemberWrites, or undefined if doc
 *   wasn't over the limit and nothing was promoted.
 */
async function promoteExistingGroupIfNeeded ({ doc, requestInfo, base_version, configManager, mongoGroupMemberRepository }) {
    if (!isGroupOverLimit({ doc, configManager, limit: configManager.groupMemberPromotionLimit, requestInfo })) {
        return undefined;
    }
    return promoteGroup({ doc, requestInfo, base_version, mongoGroupMemberRepository });
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
 * too-costly error for a POST, PUT or $merge whose Group member[] exceeds
 * configManager.groupMemberLimit, or undefined when the write is allowed. Large rosters go
 * through PATCH, which promotes the Group to extended member storage once it crosses
 * groupMemberPromotionLimit, so these writes never touch GroupMember_4_0_0. For $merge, doc is
 * the merged result, so the count includes the members the Group already has.
 *
 * @param {Object} params
 * @param {Resource} params.doc
 * @param {import('./configManager').ConfigManager} params.configManager
 * @param {import('./fhirRequestInfo').FhirRequestInfo} [params.requestInfo] - see
 *   isGroupOverLimit's own docstring for why this matters.
 * @returns {BadRequestError|undefined}
 */
function getGroupMemberLimitError ({ doc, configManager, requestInfo }) {
    if (!isGroupOverLimit({ doc, configManager, limit: configManager.groupMemberLimit, requestInfo })) {
        return undefined;
    }
    const { message, options } = createTooCostlyError({
        actual: doc.member.length,
        limit: configManager.groupMemberLimit,
        operation: 'PUT'
    });
    return new BadRequestError({ message }, options);
}

/**
 * Throwing form of getGroupMemberLimitError, for POST and PUT.
 *
 * @param {Object} params
 * @param {Resource} params.doc
 * @param {import('./configManager').ConfigManager} params.configManager
 * @param {import('./fhirRequestInfo').FhirRequestInfo} [params.requestInfo]
 * @returns {void}
 * @throws {BadRequestError} when doc.member[] exceeds configManager.groupMemberLimit
 */
function rejectGroupOverMemberLimit ({ doc, configManager, requestInfo }) {
    const error = getGroupMemberLimitError({ doc, configManager, requestInfo });
    if (error) {
        throw error;
    }
}

module.exports = {
    isGroupOverLimit,
    promoteExistingGroupIfNeeded,
    getGroupMemberLimitError,
    rejectGroupOverMemberLimit,
    cleanupExtendedGroupOrphansIfNeeded
};
