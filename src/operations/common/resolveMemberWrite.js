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
 * the four-way add state table (create/reactivate/update/none) plus soft-remove (deactivate/
 * none). Shared by both storage regimes -- the Mongo-native Group_Member repository and the
 * embedded Group.member[] array -- so $member-add / $member-remove behave identically
 * regardless of which regime a Group is in.
 *
 * Fields the event does not supply are carried forward from the existing membership rather
 * than wiped, so a bare re-add/remove never erases period/type/display set by an earlier call.
 *
 * @param {{entity: Object, period: Object|undefined, inactive: boolean}|undefined} existingMember
 * @param {{entity: {reference:string, type:string|undefined, display:string|undefined}, period:Object|undefined, op:'add'|'remove'}} event
 * @returns {{classification:'create'|'reactivate'|'update'|'deactivate'|'none', member:Object|undefined}}
 */
function resolveMemberWrite(existingMember, event) {
    if (event.op === 'remove') {
        if (!existingMember || existingMember.inactive) {
            return { classification: 'none' };
        }
        return {
            classification: 'deactivate',
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
        return { classification: 'reactivate', member };
    }
    const changed = !periodsEqual(existingMember.period, period) ||
        existingMember.entity?.type !== entity.type ||
        existingMember.entity?.display !== entity.display;
    return changed ? { classification: 'update', member } : { classification: 'none' };
}

module.exports = { resolveMemberWrite, periodsEqual, stripUndefined };
