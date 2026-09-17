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
 * The 'delete' classification is only used by the Mongo-native regime -- the embedded regime
 * hard-removes the array entry directly instead, bypassing this function for remove events (see
 * embeddedGroupMemberWriter.js).
 *
 * Fields the event does not supply are carried forward from the existing membership rather
 * than wiped, so a bare re-add never erases period/type/display set by an earlier call.
 *
 * Reactivating an inactive row is still classified 'update', not a separate value -- nothing
 * downstream needs to tell it apart from a plain field update.
 *
 * The classification is an internal routing decision only and is never persisted -- there is no
 * `operation` field on GroupMember. The one thing that matters downstream, a hard-delete
 * tombstone, is recorded exclusively via the history entry's own `request.method` ('DELETE'),
 * never as a field of the row itself.
 *
 * @param {{entity: Object, period: Object|undefined, inactive: boolean}|undefined} existingMember
 * @param {{entity: {reference:string, type:string|undefined, display:string|undefined}, period:Object|undefined, op:'add'|'remove'}} event
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
        _sourceId: event.entity._sourceId !== undefined ? event.entity._sourceId : existingMember?.entity?._sourceId
    });
    const period = event.period !== undefined ? event.period : existingMember?.period;
    const member = stripUndefined({ entity, period, inactive: false });

    if (!existingMember) {
        return { classification: 'create', member };
    }
    if (existingMember.inactive) {
        // A reactivation, not a fresh create -- but tagged 'update' like any other real change,
        // since nothing downstream distinguishes it from a plain field update (see docstring above).
        return { classification: 'update', member };
    }
    const changed = !periodsEqual(existingMember.period, period) ||
        existingMember.entity?.type !== entity.type ||
        existingMember.entity?.display !== entity.display;
    if (!changed) {
        return { classification: 'none' };
    }
    return { classification: 'update', member };
}

module.exports = { resolveMemberWrite, periodsEqual, stripUndefined };
