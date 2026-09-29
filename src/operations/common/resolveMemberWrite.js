const deepEqual = require('fast-deep-equal');
const { mergeObject } = require('../../utils/mergeHelper');

/**
 * `inactive` has three "unset" outcomes rather than one, per its FHIR cardinality (0..1: "if
 * missing, members are considered active unless explicitly specified otherwise" -- absence is a
 * valid, meaningful state, not shorthand for `false`): no explicit value on the write always
 * wins; failing that, `false` if the existing row already had this field set at all (omission on
 * a re-add means "make them active," which is what lets a bare re-add reactivate a soft-inactive
 * row); otherwise genuinely unset (nothing to reactivate, and stamping an explicit `false` would
 * claim a precision -- "explicitly active" -- the request never asserted).
 *
 * @param {boolean|undefined} writeInactive - writeRequest.inactive
 * @param {boolean|undefined} existingInactive - existingMember?.inactive
 * @returns {boolean|undefined}
 */
function resolveInactive(writeInactive, existingInactive) {
    if (writeInactive !== undefined) {
        return writeInactive;
    }
    return existingInactive !== undefined ? false : undefined;
}

/**
 * Resolves a single requested member write (add/remove) against the current membership, if
 * any, into the actual write it requires: create/update/none, plus hard-remove (delete/none).
 *
 * Used exclusively by the Mongo-native (extended) regime, via MongoGroupMemberRepository -- an
 * embedded Group takes membership changes through the standard FHIR PATCH flow (plain JSON Patch
 * add/remove on member[]), which never calls this function at all.
 *
 * groupMemberPatchStrategy.js is this function's only caller (via
 * MongoGroupMemberRepository.resolveMemberWritesAsync), and it builds writeRequest by spreading
 * the client's parsed-JSON op.value wholesale (plus its own `op` routing field) rather than
 * naming entity/period/inactive individually -- Group.member is a full backbone element
 * (id/extension/modifierExtension/entity/period/inactive per the FHIR spec), so any of those
 * fields the client actually sends arrives here.
 *
 * `inactive` is the one field excluded from the generic merge below and resolved separately
 * (resolveInactive), because -- unlike every other field -- "the write doesn't mention it" isn't
 * always "carry the existing value forward": its resolved value can itself be genuinely
 * `undefined` (no existing row, or an existing row that never had the field set either), so it's
 * only assigned onto `member` when defined, rather than as a plain merge input that would carry
 * forward whatever the existing row happened to have.
 *
 * The resolved write type is an internal routing decision only and is never persisted -- there
 * is no `operation` field on GroupMember. A hard-delete tombstone (from a 'remove' write) is
 * recorded exclusively via the history entry's own `request.method` ('DELETE'), never as a
 * field of the row itself.
 *
 * @param {{id: string|undefined, extension: Object[]|undefined, modifierExtension: Object[]|undefined, entity: Object, period: Object|undefined, inactive: boolean}|undefined} existingMember
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

    const inactive = resolveInactive(writeRequest.inactive, existingMember?.inactive);

    const { op: _op, inactive: _inactive, ...restOfWriteRequest } = writeRequest;
    const member = mergeObject(existingMember, restOfWriteRequest);
    if (inactive !== undefined) {
        member.inactive = inactive;
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
