const deepEqual = require('fast-deep-equal');
const { mergeMemberEntry } = require('./groupMemberDedupe');

/**
 * Resolves the requested writes (add/remove) for one member, in request order, against its
 * current row, if any, into the actual write they require: create/update/none, plus hard-remove
 * (delete/none).
 *
 * Used by the Mongo-native (extended) regime, via MongoGroupMemberRepository. An embedded Group
 * merges a member's entries the same way in mergeDuplicateMembers (groupMemberDedupe.js).
 *
 * An add merges onto the member as it stands (see mergeMemberEntry): the add's values win and
 * fields it does not send are kept, so `inactive` changes only when the add sends it. A remove
 * clears the member, so an add after it starts from nothing. The result compares the final
 * member with the stored row: an add equal to the stored member resolves to 'none', so a retried
 * add writes nothing.
 *
 * The caller builds each write request by spreading the client's op.value (plus `op`) after
 * enrichMemberReferences has set entity._uuid/_sourceId/_sourceAssigningAuthority, so the request
 * has the same shape as a stored member and an identical retry deep-equals it.
 *
 * The resolved write type is an internal routing decision only and is never persisted -- there
 * is no `operation` field on GroupMember. A hard-delete tombstone (from a 'remove' write) is
 * recorded exclusively via the history entry's own `request.method` ('DELETE'), never as a
 * field of the row itself.
 *
 * @param {Object|undefined} existingMember - the stored row's member; not modified
 * @param {Array<{entity: Object, op: 'add'|'remove'}>} writeRequests - requests for this one
 *   member, in request order; not modified
 * @returns {{writeType:'create'|'update'|'delete'|'none', member:Object|undefined}}
 */
function resolveMemberWrite(existingMember, writeRequests) {
    let member = existingMember;
    for (const writeRequest of writeRequests) {
        if (writeRequest.op === 'remove') {
            member = undefined;
        } else {
            const { op: _op, ...requestedMember } = writeRequest;
            member = mergeMemberEntry(member, requestedMember);
        }
    }

    if (!member) {
        return existingMember ? { writeType: 'delete', member: { ...existingMember } } : { writeType: 'none' };
    }
    if (!existingMember) {
        return { writeType: 'create', member };
    }
    if (deepEqual(existingMember, member)) {
        return { writeType: 'none' };
    }
    return { writeType: 'update', member };
}

module.exports = { resolveMemberWrite };
