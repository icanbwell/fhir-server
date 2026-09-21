const deepEqual = require('fast-deep-equal');

/**
 * @param {{start: string|undefined, end: string|undefined}|undefined} a
 * @param {{start: string|undefined, end: string|undefined}|undefined} b
 * @returns {boolean}
 */
function periodsEqual(a, b) {
    return (a?.start || undefined) === (b?.start || undefined) &&
        (a?.end || undefined) === (b?.end || undefined);
}

/**
 * Resolves a single requested member write (add/remove) against the current membership, if
 * any, into the actual write it requires: create/update/none, plus hard-remove (delete/none).
 *
 * Used exclusively by the Mongo-native (extended) regime, via MongoGroupMemberRepository -- an
 * embedded Group takes membership changes through the standard FHIR PATCH flow (plain JSON Patch
 * add/remove on member[]), which never calls this function at all.
 *
 * groupMemberPatchStrategy.js only ever builds a writeRequest as {entity, period, inactive, op}
 * -- entity/period/inactive are the only fields a write can actually change. Fields it doesn't
 * supply carry forward from the existing row via a plain object spread (new value wins if
 * present, old value survives if not) rather than being wiped, so a bare re-add never erases
 * period/type/display/extension set by an earlier call. This also covers `member`'s own
 * id/extension/modifierExtension -- never client-supplied, so they simply ride forward from
 * existingMember untouched. The one exception on the entity side is _uuid/_sourceId/
 * _sourceAssigningAuthority: enrichMemberReferences always sets these on every writeRequest
 * before this function is ever called, so they always come from the write side, never falling
 * back to a possibly-stale existing value.
 *
 * `inactive` is the one field that does NOT carry forward when omitted: unlike period/type/
 * display, "not supplied" defaults it to `false` rather than keeping the existing value, since
 * adding a member is presumed to mean "make them active" unless the caller explicitly says
 * otherwise -- this is also what lets a bare re-add reactivate a soft-inactive row. An explicit
 * `inactive` is honored as-is and is a genuine live-row state (soft deactivation/reactivation),
 * distinct from a 'remove', which always hard-deletes the row regardless of `inactive` -- the two
 * are independent knobs, not the same mechanism.
 *
 * The resolved write type is an internal routing decision only and is never persisted -- there
 * is no `operation` field on GroupMember. A hard-delete tombstone (from a 'remove' write) is
 * recorded exclusively via the history entry's own `request.method` ('DELETE'), never as a
 * field of the row itself.
 *
 * @param {{id: string|undefined, extension: Object[]|undefined, modifierExtension: Object[]|undefined, entity: Object, period: Object|undefined, inactive: boolean}|undefined} existingMember
 * @param {{entity: {reference:string, id:string|undefined, extension:Object[]|undefined, type:string|undefined, display:string|undefined, _uuid:string, _sourceId:string, _sourceAssigningAuthority:string}, period:Object|undefined, inactive:boolean|undefined, op:'add'|'remove'}} writeRequest
 * @returns {{writeType:'create'|'update'|'delete'|'none', member:Object|undefined}}
 */
function resolveMemberWrite(existingMember, writeRequest) {
    if (writeRequest.op === 'remove') {
        if (!existingMember) {
            return { writeType: 'none' };
        }
        return { writeType: 'delete', member: { ...existingMember } };
    }

    const entity = { ...existingMember?.entity, ...writeRequest.entity };
    const period = writeRequest.period !== undefined ? writeRequest.period : existingMember?.period;
    const inactive = writeRequest.inactive !== undefined ? writeRequest.inactive : false;
    const member = { ...existingMember, entity, period, inactive };

    if (!existingMember) {
        return { writeType: 'create', member };
    }
    const changed = !deepEqual(existingMember.entity, entity) ||
        !periodsEqual(existingMember.period, period) ||
        Boolean(existingMember.inactive) !== inactive;
    if (!changed) {
        return { writeType: 'none' };
    }
    return { writeType: 'update', member };
}

module.exports = { resolveMemberWrite, periodsEqual };
