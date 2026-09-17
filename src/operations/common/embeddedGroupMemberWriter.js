const { resolveMemberWrite } = require('./resolveMemberWrite');

/**
 * Applies $member-add / $member-remove events to an embedded Group.member[] array.
 *
 * Shares resolveMemberWrite's create/update/none state table with the Mongo-native regime.
 * `outcomes[].operation` is a per-call return value only -- never persisted, since an embedded
 * Group has no history collection. Remove is a hard delete here (splice out of member[]), same
 * as this codebase's existing JSON Patch "remove" behavior, so a removed entry leaves no trace.
 * The Mongo-native regime also hard-deletes its row, but writes a tombstone history entry first
 * (identified by that entry's own request.method being 'DELETE', not a stored field).
 *
 * Returns plain objects, not GroupMember backbone-element instances -- Group.member's own setter
 * already normalizes plain objects via FhirResourceCreator.
 *
 * @param {Array<Object>|undefined} existingMembers
 * @param {Array<{entity: {reference:string, type:string|undefined, display:string|undefined}, period:Object|undefined, op:'add'|'remove'}>} events
 * @returns {{members: Array<Object>, outcomes: Array<{reference:string, operation:'create'|'update'|'remove'|'none'}>}}
 */
function applyEventsToEmbeddedMembers(existingMembers, events) {
    const members = (existingMembers || []).map((m) => (m.toJSONInternal ? m.toJSONInternal() : m));
    const indexByReference = new Map(members.map((m, i) => [m.entity?.reference, i]));

    const outcomes = [];
    for (const event of events) {
        const reference = event.entity.reference;
        const index = indexByReference.get(reference);

        if (event.op === 'remove') {
            if (index === undefined) {
                outcomes.push({ reference, operation: 'none' });
                continue;
            }
            members.splice(index, 1);
            indexByReference.delete(reference);
            for (const [ref, i] of indexByReference) {
                if (i > index) {
                    indexByReference.set(ref, i - 1);
                }
            }
            outcomes.push({ reference, operation: 'remove' });
            continue;
        }

        const existingMember = index !== undefined ? members[index] : undefined;
        const { classification, member } = resolveMemberWrite(existingMember, event);
        outcomes.push({ reference, operation: classification });

        if (classification === 'none') {
            continue;
        }

        if (index !== undefined) {
            members[index] = member;
        } else {
            indexByReference.set(reference, members.length);
            members.push(member);
        }
    }

    return { members, outcomes };
}

module.exports = { applyEventsToEmbeddedMembers };
