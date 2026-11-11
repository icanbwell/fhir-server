const { enrichMemberReferences } = require('../../utils/referenceEnricher');
const { logInfo } = require('./logging');

/**
 * The entries of member[] of a Group a PATCH is about to be applied to. fast-json-patch applies
 * ops to that same object in place, so after the PATCH an entry still in this set is a stored
 * entry (possibly edited by an op), and any other entry is one the PATCH created.
 *
 * @param {Object} groupToPatch - the object the PATCH will be applied to
 * @returns {Set<Object>}
 */
function storedMemberEntriesOf(groupToPatch) {
    return new Set(Array.isArray(groupToPatch?.member) ? groupToPatch.member : []);
}

/**
 * Makes a member the PATCH added appear once in an embedded Group's member[].
 *
 * Runs on the Group after the PATCH has been applied as plain JSON Patch, where an add of a member
 * already in member[] has left a second entry for it. For each member (matched by the uuid its
 * entity.reference resolves to) that has more than one entry, one of them created by the PATCH:
 * the last entry the PATCH created, as later ops left it, replaces all of the member's entries in
 * the position of its first entry. The add replaces the whole member, so its stored entry, any
 * edit made to that entry, and any earlier entry the PATCH created for it are not kept.
 * Members with no entry created by the PATCH, and entries with no resolvable entity.reference (each
 * one logged), are left as they are.
 *
 * @param {Object} params
 * @param {Object} params.patchedGroup - the Group with the PATCH applied; member[] is replaced
 * @param {Set<Object>} params.storedMemberEntries - from storedMemberEntriesOf, before the PATCH
 * @returns {Object} patchedGroup
 */
function consolidateAddedMembers({ patchedGroup, storedMemberEntries }) {
    if (!Array.isArray(patchedGroup.member)) {
        return patchedGroup;
    }
    const memberUuidOf = memberUuidResolver(patchedGroup._sourceAssigningAuthority);

    /** @type {Map<string, number>} member uuid -> number of its entries */
    const entryCountByMemberUuid = new Map();
    /** @type {Map<string, Object>} member uuid -> its last entry the PATCH created */
    const lastCreatedEntryByMemberUuid = new Map();
    for (const [memberIndex, entry] of patchedGroup.member.entries()) {
        const memberUuid = memberUuidOf(entry);
        if (!memberUuid) {
            logInfo('Group member with no resolvable entity.reference skipped in consolidation', {
                groupId: patchedGroup.id,
                memberIndex
            });
            continue;
        }
        entryCountByMemberUuid.set(memberUuid, (entryCountByMemberUuid.get(memberUuid) ?? 0) + 1);
        if (!storedMemberEntries.has(entry)) {
            lastCreatedEntryByMemberUuid.set(memberUuid, entry);
        }
    }

    /** @type {Map<string, Object>} member uuid -> the entry all of its entries are replaced by */
    const keptEntryByMemberUuid = new Map();
    for (const [memberUuid, lastCreatedEntry] of lastCreatedEntryByMemberUuid) {
        if (entryCountByMemberUuid.get(memberUuid) > 1) {
            keptEntryByMemberUuid.set(memberUuid, lastCreatedEntry);
        }
    }
    if (keptEntryByMemberUuid.size === 0) {
        return patchedGroup;
    }

    const placedMemberUuids = new Set();
    patchedGroup.member = patchedGroup.member.flatMap((entry) => {
        const memberUuid = memberUuidOf(entry);
        if (!keptEntryByMemberUuid.has(memberUuid)) {
            return [entry];
        }
        if (placedMemberUuids.has(memberUuid)) {
            return [];
        }
        placedMemberUuids.add(memberUuid);
        return [keptEntryByMemberUuid.get(memberUuid)];
    });
    return patchedGroup;
}

/**
 * Returns a function giving the uuid a member's entity.reference resolves to, computed the way
 * referenceGlobalIdHandler stamps entity._uuid on save, so `Patient/x`, `Patient/x|<owner>` and
 * `Patient/<uuid>` are the same member. A stored entity._uuid is not used, since an op in the
 * PATCH may have changed the reference it was computed from. Results are cached per reference.
 *
 * @param {string} sourceAssigningAuthority - the Group's own sourceAssigningAuthority
 * @returns {function(*): (string|null)}
 */
function memberUuidResolver(sourceAssigningAuthority) {
    /** @type {Map<string, string>} entity.reference -> member uuid */
    const memberUuidByReference = new Map();
    return (member) => {
        const reference = member?.entity?.reference;
        if (typeof reference !== 'string') {
            return null;
        }
        if (!memberUuidByReference.has(reference)) {
            const referenceToEnrich = [{ entity: { reference } }];
            enrichMemberReferences(referenceToEnrich, sourceAssigningAuthority);
            memberUuidByReference.set(reference, referenceToEnrich[0].entity._uuid);
        }
        return memberUuidByReference.get(reference);
    };
}

module.exports = {
    storedMemberEntriesOf,
    consolidateAddedMembers
};
