const { resolveMemberWrite } = require('./resolveMemberWrite');

/**
 * Applies $member-add / $member-remove events to an embedded Group.member[] array.
 *
 * Add semantics reuse resolveMemberWrite's four-way state table (create/reactivate/update/none),
 * shared with the Mongo-native regime. Remove semantics deliberately diverge by regime: the
 * embedded regime hard-removes the entry from member[] (splice), matching this codebase's
 * pre-existing Group.member manipulation behavior (a standard JSON Patch "remove" op already
 * deletes the array entry outright) -- there's no GroupMember history collection backing an
 * embedded Group, so there's nothing that needs the row retained. The Mongo-native regime still
 * soft-removes (inactive: true, row + history retained) via resolveMemberWrite's 'deactivate'
 * classification, since GroupMember_4_0_0_History's point-in-time reconstruction (DCON-5530)
 * depends on every row surviving indefinitely.
 *
 * Returns plain objects, not GroupMember backbone-element instances: Group.member's own setter
 * already normalizes plain objects via FhirResourceCreator, so pre-wrapping here would just be
 * reconstructed a second time.
 *
 * @param {Array<Object>|undefined} existingMembers
 * @param {Array<{entity: {reference:string, type:string|undefined, display:string|undefined}, period:Object|undefined, op:'add'|'remove'}>} events
 * @returns {{members: Array<Object>, outcomes: Array<{reference:string, operation:'create'|'reactivate'|'update'|'remove'|'none'}>}}
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
