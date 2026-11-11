const { enrichMemberReferences } = require('../../utils/referenceEnricher');
const { logInfo } = require('./logging');

/** A single-member add: `/member/-`, `/member/<i>`, or `/member/` (which fast-json-patch treats as 0). */
const SINGLE_MEMBER_ADD_PATH = /^\/member\/(\d*|-)$/;

/**
 * The member values of the single-member adds in the ops a PATCH is about to apply. fast-json-patch
 * puts an add's value object itself into member[] and does not copy the ops, so after the PATCH an
 * entry in this set is one an add created, as later ops in the PATCH left it. Pass the same op
 * objects that are then applied.
 *
 * @param {Object[]} patchContent - the ops that will be applied to the Group
 * @returns {Set<Object>}
 */
function memberEntriesAddedBy(patchContent) {
    return new Set(
        (Array.isArray(patchContent) ? patchContent : [])
            .filter(
                (operation) =>
                    operation?.op === 'add' &&
                    typeof operation.path === 'string' &&
                    SINGLE_MEMBER_ADD_PATH.test(operation.path) &&
                    operation.value !== null &&
                    typeof operation.value === 'object'
            )
            .map((operation) => operation.value)
    );
}

/**
 * Makes a member the PATCH added appear once in an embedded Group's member[].
 *
 * Runs on the Group after the PATCH has been applied as plain JSON Patch, where an add of a member
 * already in member[] has left a second entry for it. For each member (matched by the uuid its
 * entity.reference resolves to) that has more than one entry, one of them created by a
 * single-member add: the last entry an add created, as later ops left it, replaces all of the
 * member's entries in the position of its first entry. The add replaces the whole member, so its
 * stored entry, any edit made to that entry, and any earlier entry an add created for it are not
 * kept. Members with no entry created by an add, and entries with no resolvable entity.reference,
 * are left as they are.
 *
 * Only adds are consolidated, because a retried add is how a duplicate is written by mistake. Every
 * other op (replace of a member or of member[], copy, move, remove, ops inside a member) is left as
 * plain JSON Patch left it, even if it puts a member in member[] twice.
 *
 * @param {Object} params
 * @param {Object} params.patchedGroup - the Group with the PATCH applied; member[] is replaced
 * @param {Set<Object>} params.addedMemberEntries - from memberEntriesAddedBy, on the applied ops
 * @returns {Object} patchedGroup
 */
function consolidateAddedMembers({ patchedGroup, addedMemberEntries }) {
    if (!Array.isArray(patchedGroup.member)) {
        return patchedGroup;
    }
    if (!patchedGroup.member.some((entry) => addedMemberEntries.has(entry))) {
        return patchedGroup;
    }
    const memberUuidOf = memberUuidResolver(patchedGroup._sourceAssigningAuthority);

    /** @type {Map<string, number>} member uuid -> number of its entries */
    const entryCountByMemberUuid = new Map();
    /** @type {Map<string, Object>} member uuid -> its last entry an add created */
    const lastCreatedEntryByMemberUuid = new Map();
    let entriesWithoutReferenceCount = 0;
    for (const entry of patchedGroup.member) {
        const memberUuid = memberUuidOf(entry);
        if (!memberUuid) {
            entriesWithoutReferenceCount++;
            continue;
        }
        entryCountByMemberUuid.set(memberUuid, (entryCountByMemberUuid.get(memberUuid) ?? 0) + 1);
        if (addedMemberEntries.has(entry)) {
            lastCreatedEntryByMemberUuid.set(memberUuid, entry);
        }
    }
    if (entriesWithoutReferenceCount > 0) {
        logInfo('Group members with no resolvable entity.reference skipped in consolidation', {
            groupId: patchedGroup.id,
            entriesWithoutReferenceCount
        });
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
 * `Patient/<uuid>` are the same member. As on save, a reference with no `|<owner>` uses the
 * entity's own _sourceAssigningAuthority when it has one, and the Group's otherwise. A stored
 * entity._uuid is not used, since an op in the PATCH may have changed the reference it was
 * computed from. Results are cached per reference and sourceAssigningAuthority.
 *
 * @param {string} groupSourceAssigningAuthority - the Group's own sourceAssigningAuthority
 * @returns {function(*): (string|null)}
 */
function memberUuidResolver(groupSourceAssigningAuthority) {
    /** @type {Map<string, string>} entity.reference and sourceAssigningAuthority -> member uuid */
    const memberUuidByReferenceKey = new Map();
    return (member) => {
        const entity = member?.entity;
        const reference = entity?.reference;
        if (typeof reference !== 'string') {
            return null;
        }
        const sourceAssigningAuthority = entity._sourceAssigningAuthority || groupSourceAssigningAuthority;
        const referenceKey = `${reference}\u0000${sourceAssigningAuthority}`;
        if (!memberUuidByReferenceKey.has(referenceKey)) {
            const referenceToEnrich = [{ entity: { reference } }];
            enrichMemberReferences(referenceToEnrich, sourceAssigningAuthority);
            memberUuidByReferenceKey.set(referenceKey, referenceToEnrich[0].entity._uuid);
        }
        return memberUuidByReferenceKey.get(referenceKey);
    };
}

module.exports = {
    memberEntriesAddedBy,
    consolidateAddedMembers
};
