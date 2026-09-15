const { resolveMemberWrite } = require('./resolveMemberWrite');

/**
 * Applies $member-add / $member-remove events to an embedded Group.member[] array, using the
 * same four-way state table as the Mongo-native regime (create/reactivate/update/none, plus
 * soft deactivate) so callers see identical semantics regardless of which storage regime a
 * given Group is in.
 *
 * Returns plain objects, not GroupMember backbone-element instances: Group.member's own setter
 * already normalizes plain objects via FhirResourceCreator, so pre-wrapping here would just be
 * reconstructed a second time.
 *
 * @param {Array<Object>|undefined} existingMembers
 * @param {Array<{entity: {reference:string, type:string|undefined, display:string|undefined}, period:Object|undefined, op:'add'|'remove'}>} events
 * @returns {{members: Array<Object>, outcomes: Array<{reference:string, operation:'create'|'reactivate'|'update'|'deactivate'|'none'}>}}
 */
function applyEventsToEmbeddedMembers(existingMembers, events) {
    const members = (existingMembers || []).map((m) => (m.toJSONInternal ? m.toJSONInternal() : m));
    const indexByReference = new Map(members.map((m, i) => [m.entity?.reference, i]));

    const outcomes = [];
    for (const event of events) {
        const reference = event.entity.reference;
        const index = indexByReference.get(reference);
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
