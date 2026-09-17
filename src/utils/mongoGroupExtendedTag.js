const Coding = require('../fhir/classes/4_0_0/complex_types/coding');
const Resource = require('../fhir/classes/4_0_0/resources/resource');
const { generateUUIDv5 } = require('./uid.util');

// Deliberately a different system/code pair than clickHouseGroupPreSave's
// externalStorageFields|member tag -- the two external-storage mechanisms for Group.member
// share no tag value, so a Group is never ambiguously tracked by both at once.
const MONGO_GROUP_MEMBER_TAG_SYSTEM = 'https://www.icanbwell.com/groupSize';
const MONGO_GROUP_MEMBER_TAG_CODE = 'extended';

/**
 * Checks whether a Group resource has been promoted to MongoDB-native extended storage,
 * i.e. its roster lives in GroupMember_4_0_0 rather than inline in member[].
 *
 * @param {Object} doc - The Group resource (or plain doc) to inspect
 * @returns {boolean}
 */
function isGroupExtended(doc) {
    return (doc?.meta?.tag || []).some(
        t => t.system === MONGO_GROUP_MEMBER_TAG_SYSTEM && t.code === MONGO_GROUP_MEMBER_TAG_CODE
    );
}

/**
 * Adds the groupSize|extended tag to meta.tag on a Group resource if not already
 * present. Permanent -- once set, never removed. Idempotent.
 *
 * @param {Resource} doc - The Group resource being promoted
 */
function addExtendedTagIfNeeded(doc) {
    if (!doc || doc.resourceType !== 'Group' || !doc.meta) {
        return;
    }

    if (isGroupExtended(doc)) {
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
    addExtendedTagIfNeeded,
    MONGO_GROUP_MEMBER_TAG_SYSTEM,
    MONGO_GROUP_MEMBER_TAG_CODE
};
