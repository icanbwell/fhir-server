const Coding = require('../fhir/classes/4_0_0/complex_types/coding');
const Resource = require('../fhir/classes/4_0_0/resources/resource');
const { generateUUIDv5 } = require('./uid.util');

const EXTERNAL_STORAGE_TAG_SYSTEM = 'https://www.icanbwell.com/externalStorageFields';
const EXTERNAL_STORAGE_TAG_CODE = 'member';

/**
 * Adds the externalStorageFields tag to meta.tag on a Group resource if not already present.
 * This tag is permanent — once set, it's never removed, even if all members are deleted.
 * Indicates that this Group's member field is tracked in ClickHouse.
 *
 * @param {Resource} doc - The Group resource being saved
 * @param {Object|null} contextData - Context data with useExternalStorage flag
 */
function addExternalStorageTagIfNeeded(doc, contextData) {
    if (!contextData?.useExternalStorage || doc.resourceType !== 'Group') {
        return;
    }

    if (!doc.meta) {
        return;
    }

    // Check if tag already exists
    const existingTags = doc.meta.tag || [];
    const hasTag = existingTags.some(
        t => t.system === EXTERNAL_STORAGE_TAG_SYSTEM && t.code === EXTERNAL_STORAGE_TAG_CODE
    );
    if (hasTag) {
        return;
    }

    const newTag = {
        id: generateUUIDv5(`${EXTERNAL_STORAGE_TAG_SYSTEM}|${EXTERNAL_STORAGE_TAG_CODE}`),
        system: EXTERNAL_STORAGE_TAG_SYSTEM,
        code: EXTERNAL_STORAGE_TAG_CODE
    };

    // Set meta.tag with existing tags + new tag
    // Cannot push to empty array on FHIR Resource class (setter converts [] to undefined)
    if (doc instanceof Resource) {
        doc.meta.tag = [...existingTags, new Coding(newTag)];
    } else {
        doc.meta.tag = [...existingTags, newTag];
    }
}

/**
 * Returns true when a stored Group document is marked as having its member field
 * held in ClickHouse (the permanent externalStorageFields tag). This is the read-side
 * signal that the Mongo document is metadata-only and its roster lives in ClickHouse.
 *
 * @param {Resource|Object|null} doc - A stored Group resource (or its plain form)
 * @returns {boolean}
 */
function hasExternalStorageMemberTag(doc) {
    const tags = doc?.meta?.tag;
    if (!Array.isArray(tags)) {
        return false;
    }
    return tags.some(
        t => t?.system === EXTERNAL_STORAGE_TAG_SYSTEM && t?.code === EXTERNAL_STORAGE_TAG_CODE
    );
}

/**
 * Strips member field from Group when ClickHouse manages members.
 * Skipped for PATCH (groupMemberEventsWritten) and $merge smartMerge=true
 * because those preserve existing MongoDB members.
 *
 * @param {Resource} doc - The Group resource being saved
 * @param {Object|null} contextData - Context data with flags
 */
function stripMembersIfNeeded(doc, contextData) {
    if (wasMemberStrippedForExternalStorage(contextData) &&
        doc.resourceType === 'Group') {
        delete doc.member;
    }
}

/**
 * Returns true when, for this write, Group.member was (or would be) stripped from the
 * MongoDB document because ClickHouse is the authoritative store for membership.
 *
 * This is the exact precondition used by {@link stripMembersIfNeeded}. It is exported so the
 * dual-write executor can recognise the split-brain case (members stripped from Mongo, but the
 * ClickHouse member write failed) and run the inverse compensation. Keeping the predicate next
 * to the strip keeps the two halves of the invariant in one place.
 *
 * Note: PATCH (groupMemberEventsWritten) and smartMerge $merge are excluded because those paths
 * never strip members from Mongo, so there is nothing to lose if their ClickHouse write fails.
 *
 * @param {Object|null} contextData - Context data with flags
 * @returns {boolean}
 */
function wasMemberStrippedForExternalStorage(contextData) {
    return Boolean(
        contextData?.useExternalStorage &&
        !contextData?.groupMemberEventsWritten &&
        !contextData?.smartMerge
    );
}

/**
 * Compensation for a failed ClickHouse member write on the Group dual-write path.
 *
 * Context: For a Group create/PUT with useExternalStorage, MongoDB is committed first with
 * member[] stripped, then member events are written to ClickHouse in the post-save handler.
 * If that ClickHouse write fails, MongoDB already holds a Group with no members and ClickHouse
 * holds no events: a silently-empty (orphaned) Group. (EA-2322)
 *
 * This restores the original member array onto the just-committed MongoDB document so the
 * submitted membership is not lost. The caller still surfaces the original error to the client
 * (HTTP 500) so the operation is reported as failed and can be retried.
 *
 * Why restore-into-Mongo rather than delete/rollback the document:
 * - It is uniformly safe for both CREATE and PUT. Deleting would be acceptable for a brand-new
 *   CREATE, but for a PUT it would destroy a pre-existing Group (a worse outcome than the bug).
 * - It never discards data the client already submitted and we already acknowledged to Mongo.
 *
 * Known limitation (flagged for human review): after compensation the Group has members inline
 * in MongoDB while meta.tag still marks membership as ClickHouse-managed, so a member-scoped read
 * sent with useExternalStorage will still route to the (empty) ClickHouse store. Compensation
 * therefore prevents data loss, not read availability. Replaying the restored members back into
 * ClickHouse (full reconciliation) is intentionally out of scope here to avoid building a saga.
 *
 * @param {Object} params
 * @param {import('mongodb').Collection} params.collection - Open collection for the Group's resource table
 * @param {string} params.uuid - _uuid of the committed document
 * @param {Array<Object>} params.members - Original Group.member entries (FHIR class instances or plain objects)
 * @returns {Promise<boolean>} true if a document was updated, false if there was nothing to restore
 */
async function restoreStrippedMembersInMongo({ collection, uuid, members }) {
    // Type-guard the query values before they reach Mongo: uuid must be a non-empty string so a
    // query-operator object (e.g. { $ne: null }) can never be injected into the filter (NoSQL injection).
    if (!collection || typeof uuid !== 'string' || uuid.length === 0 || !Array.isArray(members) || members.length === 0) {
        return false;
    }

    // Serialize to the internal JSON shape that MongoDB stores (members may be FHIR class
    // instances captured in contextData before the strip).
    const memberDocs = members.map(m => (typeof m?.toJSONInternal === 'function' ? m.toJSONInternal() : m));

    const result = await collection.updateOne(
        { _uuid: uuid },
        { $set: { member: memberDocs } }
    );

    return Boolean(result?.matchedCount);
}

/**
 * Handles all ClickHouse-related pre-save modifications for Group resources.
 * Called from both DatabaseBulkInserter and FastDatabaseBulkInserter after preSaveManager runs.
 *
 * @param {Resource} doc - The Group resource being saved
 * @param {Object|null} contextData - Context data with useExternalStorage and other flags
 * @param {Object} configManager - ConfigManager instance to check ClickHouse enablement
 */
function handleClickHouseGroupPreSave(doc, contextData, configManager) {
    if (!configManager?.enableClickHouse ||
        !configManager?.mongoWithClickHouseResources?.includes(doc.resourceType)) {
        return;
    }
    addExternalStorageTagIfNeeded(doc, contextData);
    stripMembersIfNeeded(doc, contextData);
}

module.exports = {
    handleClickHouseGroupPreSave,
    addExternalStorageTagIfNeeded,
    stripMembersIfNeeded,
    wasMemberStrippedForExternalStorage,
    hasExternalStorageMemberTag,
    restoreStrippedMembersInMongo,
    EXTERNAL_STORAGE_TAG_SYSTEM,
    EXTERNAL_STORAGE_TAG_CODE
};
