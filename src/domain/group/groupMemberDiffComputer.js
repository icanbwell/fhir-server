/**
 * Domain logic for computing differences between Group member sets
 *
 * Pure computation class (no I/O, no side effects) that implements set difference logic
 * for FHIR Group.member arrays. This is domain logic, not infrastructure logic.
 *
 * Design: Single Responsibility Principle + Clean Architecture
 * - Separates domain logic (diff computation) from infrastructure (persistence)
 * - Makes diff logic testable without database mocks
 * - Can be used by any component that needs to compute member changes
 */
class GroupMemberDiffComputer {
    /**
     * Computes additions and removals between current and incoming member sets
     *
     * Algorithm: Set difference
     * - Additions: members in incoming but not in current
     * - Removals: members in current but not in incoming
     *
     * @param {Set<string>} currentReferences - Set of current member entity references
     * @param {Array<{entity: {reference: string}, period?: Object, inactive?: boolean}>} incomingMembers - Incoming member array
     * @returns {{additions: Array<Object>, removals: Array<{entity: {reference: string}}>}}
     */
    static compute(currentReferences, incomingMembers) {
        const incomingReferences = new Set(
            (incomingMembers || [])
                .filter(m => m.entity?.reference)
                .map(m => m.entity.reference)
        );

        // Compute additions (in incoming, not in current)
        const additions = (incomingMembers || []).filter(m =>
            m.entity?.reference && !currentReferences.has(m.entity.reference)
        );

        // Compute removals (in current, not in incoming)
        const removals = Array.from(currentReferences)
            .filter(ref => !incomingReferences.has(ref))
            .map(ref => ({ entity: { reference: ref } }));

        return { additions, removals };
    }
}

module.exports = {
    GroupMemberDiffComputer
};
