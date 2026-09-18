const Coding = require('../fhir/classes/4_0_0/complex_types/coding');
const Resource = require('../fhir/classes/4_0_0/resources/resource');
const { generateUUIDv5 } = require('./uid.util');

// Deliberately a different system/code pair than clickHouseGroupPreSave's
// externalStorageFields|member tag -- the two external-storage mechanisms for Group.member
// share no tag value, so a Group is never ambiguously tracked by both at once.
const MONGO_GROUP_MEMBER_TAG_SYSTEM = 'https://www.icanbwell.com/groupSize';
const MONGO_GROUP_MEMBER_TAG_CODE = 'extended';

// Internal, non-FHIR marker field on the raw Group_4_0_0 document (design doc §3.1) -- the
// actual source of truth for routing. Never declared as a recognized property on the generated
// Group resource class, so a client PUT/PATCH/$merge body can never set or clear it (the same
// reason a client can't forge _uuid or _sourceAssigningAuthority); only a raw collection write
// (markGroupExtendedAsync) can. meta.tag's groupSize|extended entry above is only a derived,
// read-only reflection of this field and must never be read back to make a routing decision --
// a client PUT/$merge that omits it from a submitted meta.tag array would otherwise silently
// flip an extended Group back to looking embedded.
const MONGO_GROUP_EXTENDED_FIELD = '_extendedGroupMember';

/**
 * Checks whether a Group has been promoted to MongoDB-native extended storage, i.e. its roster
 * lives in GroupMember_4_0_0 rather than inline in member[]. Reads the internal field (above)
 * directly -- never meta.tag.
 *
 * @param {Object} doc - The raw Group document to inspect. Must be a raw document, not a
 *   hydrated Group resource instance -- the field isn't a recognized FHIR property, so it never
 *   survives construction through the Group class and would always read as absent there.
 * @returns {boolean}
 */
function isGroupExtended(doc) {
    return doc?.[MONGO_GROUP_EXTENDED_FIELD] === true;
}

/**
 * Raw, minimal lookup of the internal extended-storage marker for one Group, by uuid. A separate
 * round trip from the hydrated Group resource already loaded for the request, since the marker
 * intentionally isn't a recognized property on the Group class and so can't be read off that
 * instance directly (see isGroupExtended).
 *
 * @param {Object} params
 * @param {import('../operations/common/resourceLocatorFactory').ResourceLocatorFactory} params.resourceLocatorFactory
 * @param {string} params.base_version
 * @param {string} params.groupUuid
 * @returns {Promise<boolean>}
 */
async function isGroupExtendedAsync({ resourceLocatorFactory, base_version, groupUuid }) {
    const resourceLocator = resourceLocatorFactory.createResourceLocator({
        resourceType: 'Group',
        base_version
    });
    const collection = await resourceLocator.getCollectionAsync({});
    const doc = await collection.findOne(
        { _uuid: groupUuid },
        { projection: { [MONGO_GROUP_EXTENDED_FIELD]: 1 } }
    );
    return isGroupExtended(doc);
}

/**
 * Sets the internal extended-storage marker directly on a Group's raw document, via the
 * smallest correct primitive: a raw collection update, never the resource-write pipeline (which
 * wouldn't accept the field in the first place, since it isn't a recognized property on the
 * Group class). Idempotent.
 *
 * NOT wired into any production trigger yet -- the real "promotion" business logic (detecting
 * when a Group crosses the size threshold and migrating its roster into GroupMember_4_0_0,
 * design doc §4) is separate, follow-up work. Today this exists so tests and the manual
 * verification script can put a Group into the extended regime directly, per the design doc's
 * own guidance that tests should set the internal extended field directly in setup.
 *
 * @param {Object} params
 * @param {import('../operations/common/resourceLocatorFactory').ResourceLocatorFactory} params.resourceLocatorFactory
 * @param {string} params.base_version
 * @param {string} params.groupUuid
 * @returns {Promise<void>}
 */
async function markGroupExtendedAsync({ resourceLocatorFactory, base_version, groupUuid }) {
    const resourceLocator = resourceLocatorFactory.createResourceLocator({
        resourceType: 'Group',
        base_version
    });
    const collection = await resourceLocator.getCollectionAsync({});
    await collection.updateOne(
        { _uuid: groupUuid },
        { $set: { [MONGO_GROUP_EXTENDED_FIELD]: true } }
    );
}

/**
 * Adds the groupSize|extended tag to meta.tag on a Group resource if not already present.
 * Permanent -- once set, never removed. Idempotent.
 *
 * Not the source of truth, and not currently called from anywhere in the write path -- this is a
 * placeholder for the design's separate, not-yet-built response-time reflection (meta.tag should
 * be computed fresh from the internal field on every GET/_history response, never stored
 * verbatim). Routing must never call this to decide anything; use isGroupExtended/
 * isGroupExtendedAsync against the internal field instead.
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
    isGroupExtended,
    isGroupExtendedAsync,
    markGroupExtendedAsync,
    addExtendedTagIfNeeded,
    MONGO_GROUP_MEMBER_TAG_SYSTEM,
    MONGO_GROUP_MEMBER_TAG_CODE,
    MONGO_GROUP_EXTENDED_FIELD
};
