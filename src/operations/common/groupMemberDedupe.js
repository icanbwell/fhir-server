const deepcopy = require('deepcopy');
const deepEqual = require('fast-deep-equal');
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
 * member's first entry. Entries whose entity.reference is missing or not a relative `Type/id`
 * reference (see referenceUuidOf) are kept as they are.
 *
 * @param {Object} params
 * @param {Object[]} params.members - the Group's member[]; not modified
 * @param {string} params.sourceAssigningAuthority - the Group's sourceAssigningAuthority
 * @param {{has: function(Object): boolean}} [params.olderEntries] - entries the others win
 *   over, e.g. unchangedStoredEntries of the Group a write was applied to
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
 * The entries of a written Group's member[] that are still as stored, for mergeDuplicateMembers'
 * olderEntries: an entry counts when it equals an entry of storedMembers. A stored entry the write
 * changed and a new entry do not count, so they merge after the member's stored entries and the
 * values the write sent win.
 *
 * Only asked about entries of members with more than one entry, so the stored entries are grouped
 * by entity.reference on first use, and an entry is compared only with those of its reference.
 *
 * @param {Object[]|undefined} storedMembers - the Group's member[] before the write; not modified
 * @returns {{has: function(Object): boolean}}
 */
function unchangedStoredEntries(storedMembers) {
    /** @type {Map<string|undefined, Object[]>|undefined} */
    let storedEntriesByReference;
    return {
        has(entry) {
            if (!Array.isArray(storedMembers)) {
                return false;
            }
            storedEntriesByReference ??= Map.groupBy(storedMembers, (storedEntry) => storedEntry?.entity?.reference);
            const storedEntries = storedEntriesByReference.get(entry?.entity?.reference) ?? [];
            return storedEntries.some((storedEntry) => deepEqual(storedEntry, entry));
        }
    };
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
 * @returns {string|null} null when the reference is not a relative `Type/id` or `Type/id|<owner>`
 *   reference
 */
function referenceUuidOf(reference, sourceAssigningAuthority) {
    if (typeof reference !== 'string') {
        return null;
    }
    // The uuid is computed from the first and the last segment of the reference, so it names one
    // member only for a relative `Type/id` reference: `Patient/x/_history/2` and
    // `Patient/y/_history/2`, or `https://h/Patient/x` and `https://h/Practitioner/x`, would share one
    const [resourceType, id, ...otherSegments] = reference.split('/');
    if (!resourceType || !id || otherSegments.length > 0) {
        return null;
    }
    const referenceToEnrich = [{ entity: { reference } }];
    enrichMemberReferences(referenceToEnrich, sourceAssigningAuthority);
    return referenceToEnrich[0].entity._uuid;
}

module.exports = {
    mergeMemberEntry,
    mergeDuplicateMembers,
    unchangedStoredEntries
};
