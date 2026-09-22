const { logInfo, logError } = require('../operations/common/logging');
const { RethrownError } = require('./rethrownError');
const { enrichMemberReferences } = require('./referenceEnricher');
const { isUuid } = require('./uid.util');
const { MONGO_GROUP_EXTENDED_FIELD } = require('./mongoGroupExtendedTag');

/**
 * True when doc is a Group whose member[] has crossed configManager.groupMemberLimit and still
 * needs promoting to MongoDB-native extended member storage (GroupMember_4_0_0). There is no
 * member-count reject anywhere (see DCON-5528): a Group that arrives already over the limit (via
 * POST, PUT-insert, or $merge-insert) is promoted on its first save, same as one that crosses the
 * limit later via PUT/$merge/PATCH.
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
 * Callers must have already ensured doc._uuid and doc._sourceAssigningAuthority are set (either
 * because doc is an existing resource carrying them forward, or via the early handler calls in
 * promoteNewGroupIfNeeded below for a brand-new resource).
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
 * @returns {Promise<void>}
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

        const writeRequests = members
            .map((member) => ({
                entity: {
                    reference: member.entity?.reference,
                    type: member.entity?.type,
                    display: member.entity?.display,
                    _uuid: member.entity?._uuid,
                    _sourceId: member.entity?._sourceId,
                    _sourceAssigningAuthority: member.entity?._sourceAssigningAuthority
                },
                period: member.period,
                inactive: member.inactive,
                op: 'add'
            }))
            .filter((writeRequest) => writeRequest.entity.reference);

        const groupUuid = doc._uuid;

        // Resolve against the current GroupMember_4_0_0 roster first (same two-phase API
        // GroupMemberPatchStrategy's extended-regime PATCH uses) -- on a retry after a prior
        // crash, rows already written resolve to 'none'/'update' instead of blindly re-creating
        // them.
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
 * @returns {Promise<void>}
 */
async function promoteExistingGroupIfNeeded ({ doc, requestInfo, base_version, configManager, mongoGroupMemberRepository, flush = true }) {
    if (!isGroupOverLimit({ doc, configManager })) {
        return;
    }
    await promoteGroup({ doc, requestInfo, base_version, mongoGroupMemberRepository, flush });
}

/**
 * Promotes a brand-new Group (CREATE, PUT-insert, $merge-insert) whose member[] already arrives
 * over the limit. A new resource has no _uuid/_sourceAssigningAuthority yet -- those are normally
 * computed by SourceAssigningAuthorityColumnHandler/UuidColumnHandler inside preSaveManager, which
 * itself only runs later, inside the caller's own insertOneAsync call. Since the roster write
 * needs both fields now, this runs the same two handlers early, mirroring the established
 * "compute _uuid ahead of the normal pre-save pipeline" pattern already used by
 * MergeResourceValidator and the bulk-import handler. Both handlers are idempotent (guarded by
 * "already set?" checks), so preSaveManager running them again later, inside insertOneAsync, is
 * harmless.
 *
 * @param {Object} params
 * @param {Resource} params.doc
 * @param {import('./fhirRequestInfo').FhirRequestInfo} params.requestInfo
 * @param {string} params.base_version
 * @param {import('./configManager').ConfigManager} params.configManager
 * @param {import('../dataLayer/repositories/mongoGroupMemberRepository').MongoGroupMemberRepository} params.mongoGroupMemberRepository
 * @param {import('../preSaveHandlers/handlers/sourceAssigningAuthorityColumnHandler').SourceAssigningAuthorityColumnHandler} params.sourceAssigningAuthorityColumnHandler
 * @param {import('../preSaveHandlers/handlers/uuidColumnHandler').UuidColumnHandler} params.uuidColumnHandler
 * @returns {Promise<void>}
 */
async function promoteNewGroupIfNeeded ({
    doc,
    requestInfo,
    base_version,
    configManager,
    mongoGroupMemberRepository,
    sourceAssigningAuthorityColumnHandler,
    uuidColumnHandler
}) {
    if (!isGroupOverLimit({ doc, configManager })) {
        return;
    }
    // Order matters: UuidColumnHandler's hash-based branch (id isn't already a uuid) reads
    // _sourceAssigningAuthority, so it must run second -- same order preSaveManager itself
    // registers them in.
    await sourceAssigningAuthorityColumnHandler.preSaveAsync({ resource: doc });
    if (isUuid(doc.id)) {
        doc._uuid = doc.id;
    } else {
        await uuidColumnHandler.preSaveAsync({ resource: doc });
    }
    await promoteGroup({ doc, requestInfo, base_version, mongoGroupMemberRepository });
}

module.exports = { isGroupOverLimit, promoteExistingGroupIfNeeded, promoteNewGroupIfNeeded };
