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
 * Removes undefined-valued keys so the resulting plain object has a clean, consistent shape.
 * @param {Object} obj
 * @returns {Object}
 */
function stripUndefined(obj) {
    return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

/**
 * Resolves a single member event (add/remove) against the current membership, if any, into
 * create/update/none, plus hard-remove (delete/none).
 *
 * Used exclusively by the Mongo-native (extended) regime, via MongoGroupMemberRepository -- an
 * embedded Group takes membership changes through the standard FHIR PATCH flow (plain JSON Patch
 * add/remove on member[]), which never calls this function at all.
 *
 * Fields the event does not supply are carried forward from the existing membership rather
 * than wiped, so a bare re-add never erases period/type/display set by an earlier call.
 * `inactive` is the one exception: unlike period/type/display, "not supplied" defaults it to
 * `false` rather than carrying the existing value forward, since adding a member is presumed to
 * mean "make them active" unless the caller explicitly says otherwise -- this is also what lets a
 * bare re-add reactivate a soft-inactive row. An explicit `inactive` is honored as-is and is a
 * genuine live-row state (soft deactivation/reactivation), distinct from a 'remove', which always
 * hard-deletes the row regardless of `inactive` -- the two are independent knobs, not the same
 * mechanism.
 *
 * The classification is an internal routing decision only and is never persisted -- there is no
 * `operation` field on GroupMember. A hard-delete tombstone (from a 'remove' event) is recorded
 * exclusively via the history entry's own `request.method` ('DELETE'), never as a field of the
 * row itself.
 *
 * @param {{entity: Object, period: Object|undefined, inactive: boolean}|undefined} existingMember
 * @param {{entity: {reference:string, type:string|undefined, display:string|undefined, _uuid:string|undefined, _sourceId:string|undefined, _sourceAssigningAuthority:string|undefined}, period:Object|undefined, inactive:boolean|undefined, op:'add'|'remove'}} event
 * @returns {{classification:'create'|'update'|'delete'|'none', member:Object|undefined}}
 */
function resolveMemberWrite(existingMember, event) {
    if (event.op === 'remove') {
        if (!existingMember) {
            return { classification: 'none' };
        }
        return {
            classification: 'delete',
            member: stripUndefined({
                entity: existingMember.entity,
                period: existingMember.period,
                inactive: true
            })
        };
    }

    const entity = stripUndefined({
        reference: event.entity.reference,
        type: event.entity.type !== undefined ? event.entity.type : existingMember?.entity?.type,
        display: event.entity.display !== undefined ? event.entity.display : existingMember?.entity?.display,
        _uuid: event.entity._uuid !== undefined ? event.entity._uuid : existingMember?.entity?._uuid,
        _sourceId: event.entity._sourceId !== undefined ? event.entity._sourceId : existingMember?.entity?._sourceId,
        _sourceAssigningAuthority: event.entity._sourceAssigningAuthority !== undefined
            ? event.entity._sourceAssigningAuthority
            : existingMember?.entity?._sourceAssigningAuthority
    });
    const period = event.period !== undefined ? event.period : existingMember?.period;
    const inactive = event.inactive !== undefined ? event.inactive : false;
    const member = stripUndefined({ entity, period, inactive });

    if (!existingMember) {
        return { classification: 'create', member };
    }
    const changed = !periodsEqual(existingMember.period, period) ||
        existingMember.entity?.type !== entity.type ||
        existingMember.entity?.display !== entity.display ||
        Boolean(existingMember.inactive) !== inactive;
    if (!changed) {
        return { classification: 'none' };
    }
    return { classification: 'update', member };
}

module.exports = { resolveMemberWrite, periodsEqual, stripUndefined };
