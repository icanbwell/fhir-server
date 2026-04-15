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
 * @param {Object|null} contextData - Context data with useExternalMemberStorage flag
 */
function addExternalStorageTagIfNeeded(doc, contextData) {
    if (!contextData?.useExternalMemberStorage || doc.resourceType !== 'Group') {
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
 * Strips member field from Group when ClickHouse manages members.
 * Skipped for PATCH (groupMemberEventsWritten) and $merge smartMerge=true
 * because those preserve existing MongoDB members.
 *
 * @param {Resource} doc - The Group resource being saved
 * @param {Object|null} contextData - Context data with flags
 */
function stripMembersIfNeeded(doc, contextData) {
    if (contextData?.useExternalMemberStorage &&
        !contextData?.groupMemberEventsWritten &&
        !contextData?.smartMerge &&
        doc.resourceType === 'Group') {
        delete doc.member;
    }
}

/**
 * Handles all ClickHouse-related pre-save modifications for Group resources.
 * Called from both DatabaseBulkInserter and FastDatabaseBulkInserter after preSaveManager runs.
 *
 * @param {Resource} doc - The Group resource being saved
 * @param {Object|null} contextData - Context data with useExternalMemberStorage and other flags
 */
function handleClickHouseGroupPreSave(doc, contextData) {
    addExternalStorageTagIfNeeded(doc, contextData);
    stripMembersIfNeeded(doc, contextData);
}

module.exports = {
    handleClickHouseGroupPreSave,
    addExternalStorageTagIfNeeded,
    stripMembersIfNeeded,
    EXTERNAL_STORAGE_TAG_SYSTEM,
    EXTERNAL_STORAGE_TAG_CODE
};
