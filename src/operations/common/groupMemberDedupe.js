const deepcopy = require('deepcopy');
const { enrichMemberReferences } = require('../../utils/referenceEnricher');
const { mergeObject } = require('../../utils/mergeHelper');
const { logInfo } = require('./logging');

/**
 * Combines two entries of the same Group member into one, the way $merge combines a resource:
 * the newer entry's values win, fields only the older entry has are kept, objects such as
 * `period` are merged field by field, and arrays such as `extension` are merged by `id`.
 * `inactive` is an ordinary field here, so it changes only when the newer entry sends it.
 * Neither argument is modified.
 *
 * @param {Object|undefined} olderEntry
 * @param {Object} newerEntry
 * @returns {Object}
 */
function mergeMemberEntry(olderEntry, newerEntry) {
    if (!olderEntry) {
        return deepcopy(newerEntry);
    }
    // mergeObject leaves both inputs as they are but reuses their objects in its result, so the
    // result is copied once
    return deepcopy(mergeObject(olderEntry, newerEntry));
}

/**
 * Makes each member appear once in a Group's member[]. Entries are the same member when their
 * entity.reference resolves to the same uuid (see memberUuidOf), so the plain, the
 * `|<sourceAssigningAuthority>` and the uuid form of a reference match, and the same id under
 * another owner does not.
 *
 * A member's entries are merged with mergeMemberEntry, oldest first: entries in olderEntries in
 * member[] order, then the others in member[] order. The merged entry takes the position of the
 * member's first entry. Entries with no resolvable entity.reference are kept as they are.
 *
 * @param {Object} params
 * @param {Object[]} params.members - the Group's member[]; not modified
 * @param {string} params.sourceAssigningAuthority - the Group's sourceAssigningAuthority
 * @param {Set<Object>} [params.olderEntries] - entries the others win over, e.g. the stored
 *   entries of a Group a PATCH was applied to
 * @param {string} [params.groupId] - for logging only
 * @returns {Object[]} members itself when no member has more than one entry, else a new array
 */
function mergeDuplicateMembers({ members, sourceAssigningAuthority, olderEntries = new Set(), groupId }) {
    if (!Array.isArray(members)) {
        return members;
    }
    const memberUuids = members.map((entry) => memberUuidOf(entry, sourceAssigningAuthority));
    const entryIndexesByMemberUuid = entryIndexesOfRepeatedMembers(memberUuids);
    if (entryIndexesByMemberUuid.size === 0) {
        return members;
    }

    const entriesWithoutReferenceCount = memberUuids.filter((memberUuid) => !memberUuid).length;
    if (entriesWithoutReferenceCount > 0) {
        logInfo('Group members with no resolvable entity.reference left as is when merging duplicates', {
            groupId,
            entriesWithoutReferenceCount
        });
    }

    const mergedMembers = [...members];
    const mergedAwayIndexes = new Set();
    for (const [firstIndex, ...laterIndexes] of entryIndexesByMemberUuid.values()) {
        const entries = [firstIndex, ...laterIndexes].map((index) => members[index]);
        const entriesOldestFirst = [
            ...entries.filter((entry) => olderEntries.has(entry)),
            ...entries.filter((entry) => !olderEntries.has(entry))
        ];
        mergedMembers[firstIndex] = entriesOldestFirst.reduce(
            (mergedEntry, entry) => mergeMemberEntry(mergedEntry, entry),
            undefined
        );
        laterIndexes.forEach((index) => mergedAwayIndexes.add(index));
    }
    return mergedMembers.filter((_entry, index) => !mergedAwayIndexes.has(index));
}

/**
 * The positions of the entries of each member a Group's member[] lists more than once, as the
 * client sent it. Entries are the same member under the same rule as mergeDuplicateMembers. Only
 * entity.reference is read: the entity fields the server computes are not client input, so a
 * client-sent entity._sourceAssigningAuthority does not change which entries match.
 *
 * @param {Object} params
 * @param {Object[]} params.members - the Group's member[]; not modified
 * @param {string|undefined} params.sourceAssigningAuthority - the Group's sourceAssigningAuthority
 * @returns {number[][]} for each repeated member, the indexes of its entries in member[] order;
 *   empty when every member is listed once
 */
function findRepeatedMemberIndexes({ members, sourceAssigningAuthority }) {
    if (!Array.isArray(members)) {
        return [];
    }
    const memberUuids = members.map((entry) => referenceUuidOf(entry?.entity?.reference, sourceAssigningAuthority));
    return [...entryIndexesOfRepeatedMembers(memberUuids).values()];
}

/**
 * @param {(string|null)[]} memberUuids - the member uuid of each entry, null for an entry with no
 *   resolvable entity.reference
 * @returns {Map<string, number[]>} member uuid -> indexes of all its entries, only for members
 *   with more than one entry. Members listed once are kept in a map of first indexes only, so a
 *   member[] without repeats allocates no array per member.
 */
function entryIndexesOfRepeatedMembers(memberUuids) {
    /** @type {Map<string, number>} member uuid -> index of its first entry */
    const firstIndexByMemberUuid = new Map();
    /** @type {Map<string, number[]>} */
    const entryIndexesByMemberUuid = new Map();
    memberUuids.forEach((memberUuid, index) => {
        if (!memberUuid) {
            return;
        }
        const firstIndex = firstIndexByMemberUuid.get(memberUuid);
        if (firstIndex === undefined) {
            firstIndexByMemberUuid.set(memberUuid, index);
            return;
        }
        const entryIndexes = entryIndexesByMemberUuid.get(memberUuid) ?? [firstIndex];
        entryIndexes.push(index);
        entryIndexesByMemberUuid.set(memberUuid, entryIndexes);
    });
    return entryIndexesByMemberUuid;
}

/**
 * The uuid a member's entity.reference resolves to, computed the way referenceGlobalIdHandler
 * stamps entity._uuid on save, so `Patient/x`, `Patient/x|<owner>` and `Patient/<uuid>` are the
 * same member. As on save, a reference with no `|<owner>` uses the entity's own
 * _sourceAssigningAuthority when it has one, and the Group's otherwise. A stored entity._uuid is
 * not used, since a write may have changed the reference it was computed from.
 *
 * @param {Object} member
 * @param {string} groupSourceAssigningAuthority - the Group's own sourceAssigningAuthority
 * @returns {string|null}
 */
function memberUuidOf(member, groupSourceAssigningAuthority) {
    const entity = member?.entity;
    return referenceUuidOf(entity?.reference, entity?._sourceAssigningAuthority || groupSourceAssigningAuthority);
}

/**
 * @param {unknown} reference - an entity.reference
 * @param {string|undefined} sourceAssigningAuthority - used when the reference has no `|<owner>`
 * @returns {string|null} null when the reference is not a string
 */
function referenceUuidOf(reference, sourceAssigningAuthority) {
    if (typeof reference !== 'string') {
        return null;
    }
    const referenceToEnrich = [{ entity: { reference } }];
    enrichMemberReferences(referenceToEnrich, sourceAssigningAuthority);
    return referenceToEnrich[0].entity._uuid;
}

module.exports = {
    mergeMemberEntry,
    mergeDuplicateMembers,
    findRepeatedMemberIndexes
};
