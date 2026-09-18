const Coding = require('../fhir/classes/4_0_0/complex_types/coding');
const Resource = require('../fhir/classes/4_0_0/resources/resource');
const { generateUUIDv5 } = require('./uid.util');

// Deliberately a different system/code pair than clickHouseGroupPreSave's
// externalStorageFields|member tag -- the two external-storage mechanisms for Group.member
// share no tag value, so a Group is never ambiguously tracked by both at once.
const MONGO_GROUP_MEMBER_TAG_SYSTEM = 'https://www.icanbwell.com/groupSize';
const MONGO_GROUP_MEMBER_TAG_CODE = 'extended';

// Internal, non-FHIR marker field on the Group resource (design doc §3.1) -- the actual source
// of truth for routing. A recognized property on the generated Group resource class, the same
// way _uuid/_access are, so it hydrates and round-trips through the normal resource-write
// pipeline automatically; it is never client-writable because standard PATCH already rejects
// any path segment starting with "_" (patchInternalFieldsValidator.js), and PUT/$merge carries
// it forward from the current resource in resourceMerger.overWriteNonWritableFields (there's no
// deterministic recompute for it the way UuidColumnHandler recomputes _uuid). meta.tag's
// groupSize|extended entry above is only a derived, read-only reflection of this field and must
// never be read back to make a routing decision -- a client PUT/$merge that omits it from a
// submitted meta.tag array would otherwise silently flip an extended Group back to looking
// embedded.
const MONGO_GROUP_EXTENDED_FIELD = '_extendedGroupMember';

/**
 * Adds the groupSize|extended tag to meta.tag on a Group resource if not already present.
 * Permanent -- once set, never removed. Idempotent.
 *
 * Not the source of truth, and not currently called from anywhere in the write path -- this is a
 * placeholder for the design's separate, not-yet-built response-time reflection (meta.tag should
 * be computed fresh from the internal field on every GET/_history response, never stored
 * verbatim). Routing must never call this to decide anything; read the resource's own
 * _extendedGroupMember property (MONGO_GROUP_EXTENDED_FIELD) instead.
 *
 * @param {Resource} doc - The Group resource being promoted
 */
function addExtendedTagIfNeeded(doc) {
    if (!doc || doc.resourceType !== 'Group' || !doc.meta) {
        return;
    }

    const alreadyTagged = (doc.meta.tag || []).some(
        t => t.system === MONGO_GROUP_MEMBER_TAG_SYSTEM && t.code === MONGO_GROUP_MEMBER_TAG_CODE
    );
    if (alreadyTagged) {
        return;
    }

    const existingTags = doc.meta.tag || [];
    const newTag = {
        id: generateUUIDv5(`${MONGO_GROUP_MEMBER_TAG_SYSTEM}|${MONGO_GROUP_MEMBER_TAG_CODE}`),
        system: MONGO_GROUP_MEMBER_TAG_SYSTEM,
        code: MONGO_GROUP_MEMBER_TAG_CODE
    };

    // Cannot push to an empty array on the FHIR Resource class (its setter converts [] to
    // undefined), so always assign a fresh array.
    if (doc instanceof Resource) {
        doc.meta.tag = [...existingTags, new Coding(newTag)];
    } else {
        doc.meta.tag = [...existingTags, newTag];
    }
}

module.exports = {
    addExtendedTagIfNeeded,
    MONGO_GROUP_MEMBER_TAG_SYSTEM,
    MONGO_GROUP_MEMBER_TAG_CODE,
    MONGO_GROUP_EXTENDED_FIELD
};
