const deepEqual = require('fast-deep-equal');

/**
 * Resolves a single requested member write (add/remove) against the current membership, if
 * any, into the actual write it requires: create/update/none, plus hard-remove (delete/none).
 *
 * Used by the Mongo-native (extended) regime, via MongoGroupMemberRepository, and by
 * groupMemberDedupe.js, which applies the same rules when an embedded Group's PATCH adds a member
 * already in member[].
 *
 * An add replaces the member: the resolved member is exactly the write request without its `op`
 * routing field. Fields the client does not send are not kept, so a re-add without `id`,
 * `period` or `inactive` clears them. This matches JSON Patch, where an add or replace sets the
 * whole value at the target. An add equal to the stored member resolves to 'none', so a retried
 * add writes nothing.
 *
 * Both callers build writeRequest by spreading the client's op.value (plus `op`) after
 * enrichMemberReferences has set entity._uuid/_sourceId/_sourceAssigningAuthority, so the request
 * has the same shape as a stored member and an identical retry deep-equals it.
 *
 * The resolved write type is an internal routing decision only and is never persisted -- there
 * is no `operation` field on GroupMember. A hard-delete tombstone (from a 'remove' write) is
 * recorded exclusively via the history entry's own `request.method` ('DELETE'), never as a
 * field of the row itself.
 *
 * @param {{id: string|undefined, extension: Object[]|undefined, modifierExtension: Object[]|undefined, entity: Object, period: Object|undefined, inactive: boolean|undefined}|undefined} existingMember
 * @param {{id: string|undefined, extension: Object[]|undefined, modifierExtension: Object[]|undefined, entity: {reference:string, id:string|undefined, extension:Object[]|undefined, type:string|undefined, display:string|undefined, _uuid:string, _sourceId:string, _sourceAssigningAuthority:string}, period:Object|undefined, inactive:boolean|undefined, op:'add'|'remove'}} writeRequest
 * @returns {{writeType:'create'|'update'|'delete'|'none', member:Object|undefined}}
 */
function resolveMemberWrite(existingMember, writeRequest) {
    if (writeRequest.op === 'remove') {
        if (!existingMember) {
            return { writeType: 'none' };
        }
        return { writeType: 'delete', member: { ...existingMember } };
    }

    const { op: _op, ...member } = writeRequest;

    if (!existingMember) {
        return { writeType: 'create', member };
    }
    if (deepEqual(existingMember, member)) {
        return { writeType: 'none' };
    }
    return { writeType: 'update', member };
}

module.exports = { resolveMemberWrite };
