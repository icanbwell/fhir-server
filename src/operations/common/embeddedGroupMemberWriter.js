const { resolveMemberWrite } = require('./resolveMemberWrite');

/**
 * Applies $member-add / $member-remove events to an embedded Group.member[] array.
 *
 * Add semantics reuse resolveMemberWrite's four-way state table (create/update/none), shared
 * with the Mongo-native regime -- the returned classification only ever says create/update,
 * never a separate reactivate value (see resolveMemberWrite's own docstring). This function's
 * own `outcomes[].operation` is a per-call return value for the caller only -- it is never
 * persisted anywhere; there is no GroupMember history collection backing an embedded Group at
 * all. Remove is a hard delete in both regimes, but the embedded regime does it directly here
 * (splice out of member[]), matching this codebase's pre-existing Group.member manipulation
 * behavior (a standard JSON Patch "remove" op already deletes the array entry outright) --
 * so a removed entry leaves no trace at all. The Mongo-native regime also hard-deletes its row
 * (via resolveMemberWrite's 'delete' classification), but writes a tombstone
 * GroupMember_4_0_0_History entry first -- identified by that entry's own request.method being
 * overridden to 'DELETE', not a stored field -- since point-in-time reconstruction (DCON-5530)
 * needs a durable record that the removal happened even though the live row is gone.
 *
 * Returns plain objects, not GroupMember backbone-element instances: Group.member's own setter
 * already normalizes plain objects via FhirResourceCreator, so pre-wrapping here would just be
 * reconstructed a second time.
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
