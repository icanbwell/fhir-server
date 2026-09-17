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
 * the four-way add state table (create/update/none) plus hard-remove (delete/none).
 *
 * Add semantics are shared by both storage regimes -- the Mongo-native GroupMember repository
 * and the embedded Group.member[] array. The 'delete' classification is only used by the
 * Mongo-native regime: MongoGroupMemberRepository.applyMemberEventsAsync writes a final
 * 'delete' history entry (a tombstone) for the row, then hard-deletes the live document --
 * removal is not a soft inactive:true flag. The embedded regime hard-removes the array entry
 * directly instead, bypassing this function entirely for remove events -- see
 * embeddedGroupMemberWriter.js.
 *
 * Fields the event does not supply are carried forward from the existing membership rather
 * than wiped, so a bare re-add never erases period/type/display set by an earlier call.
 *
 * A reactivation (existing row was inactive:true) and a plain field update are distinguished
 * internally -- this function needs to know whether to flip inactive back to false -- but both
 * write the same member shape via the same replaceOneAsync path, and nothing downstream ever
 * needs to tell them apart, so both are classified 'update'. The returned vocabulary is
 * therefore only create/update/delete/none -- 'reactivate' is never a value this function
 * returns.
 *
 * This classification is an internal routing decision only (it picks insertOneAsync vs.
 * replaceOneAsync vs. a direct history-tombstone write) and is never itself persisted -- there
 * is no `operation` field on GroupMember or anywhere in this design (design doc §3.2). The one
 * lifecycle event that matters downstream, a hard-delete tombstone, is recorded exclusively on
 * the corresponding history entry's own `request.method` ('DELETE', overridden at write time
 * by MongoGroupMemberRepository.applyMemberEventsAsync), never as a field of the row itself.
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
    return changed ? { classification: 'update', member } : { classification: 'none' };
}

module.exports = { resolveMemberWrite, periodsEqual, stripUndefined };
