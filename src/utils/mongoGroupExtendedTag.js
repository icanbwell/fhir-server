const { BadRequestError } = require('./httpErrors');

// Internal, non-FHIR marker field on the Group resource (design doc §3.1) -- the actual source
// of truth for routing. A recognized property on the generated Group resource class, the same
// way _uuid/_access are, so it hydrates and round-trips through the normal resource-write
// pipeline automatically; it is never client-writable because standard PATCH already rejects
// any path segment starting with "_" (patchInternalFieldsValidator.js), and PUT/$merge carries
// it forward from the current resource in resourceMerger.overWriteNonWritableFields (there's no
// deterministic recompute for it the way UuidColumnHandler recomputes _uuid). There is no
// meta.tag reflection of this field -- routing (and everything else) must only ever read
// _extended directly; a persisted meta.tag copy would be a second source of truth
// that could drift out of sync with it.
const MONGO_GROUP_EXTENDED_FIELD = '_extended';

/**
 * Rejects a PUT/$merge write against an already-extended Group whose submitted body carries a
 * `member` field (design doc §5.1). An extended Group's real roster lives entirely in
 * GroupMember_4_0_0 -- member[] doesn't exist on the live document at all -- so silently
 * accepting a client-submitted member[] here would be indistinguishable from a no-op (the caller
 * would see no error and no effect) while either dropping their intended change or, worse,
 * reintroducing a stale/bogus member[] alongside the real roster. Rejecting outright makes the
 * wrong call visible immediately and tells the caller to use PATCH instead.
 *
 * Deliberately unconditional on configManager.enableExtendedGroup: this is a data-integrity
 * guardrail, not a feature-availability gate -- an already-extended Group's member[] genuinely
 * doesn't exist on the document regardless of the flag's current value. (Contrast with PATCH's
 * own routing in GroupMemberPatchStrategy.determineGroupMemberType, which does gate on the flag,
 * because PATCH's job there is deciding whether to *activate* the extended write path, not
 * rejecting a shape that's already structurally wrong.) A metadata-only PUT/$merge (no `member`
 * field submitted) is unaffected either way -- Group's other fields remain fully writable.
 *
 * @param {Object} params
 * @param {Resource} params.currentResource - the already-loaded, existing Group
 * @param {boolean} params.hasMemberField - whether the client-submitted body includes a
 *   non-empty `member` array (an explicit `member: []` does not count -- see call sites)
 */
function rejectMemberOnExtendedGroupWrite({ currentResource, hasMemberField }) {
    if (currentResource?.resourceType === 'Group' &&
        currentResource[MONGO_GROUP_EXTENDED_FIELD] === true &&
        hasMemberField
    ) {
        throw new BadRequestError(new Error(
            `Group ${currentResource.id || currentResource._uuid} does not accept member changes via ` +
            'PUT or $merge; use PATCH /4_0_0/Group/{id} with a JSON Patch operation on /member instead. ' +
            'See: https://www.hl7.org/fhir/http.html#patch'
        ));
    }
}

module.exports = {
    rejectMemberOnExtendedGroupWrite,
    MONGO_GROUP_EXTENDED_FIELD
};
