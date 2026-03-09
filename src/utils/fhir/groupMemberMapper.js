const { DateTimeFormatter } = require('../clickHouse/dateTimeFormatter');

/**
 * Utility class for mapping between query results and FHIR Group.member objects
 *
 * This handles the transformation from database rows to FHIR-compliant member representations.
 */
class GroupMemberMapper {
    /**
     * Maps a single result row to a FHIR Group.member object
     *
     * Result row schema:
     * - entity_reference: String (FHIR reference)
     * - period_start: Database timestamp (nullable)
     * - period_end: Database timestamp (nullable)
     * - inactive: Integer (0 or 1)
     *
     * FHIR Group.member schema:
     * - entity.reference: String (required)
     * - period: { start?, end? } (optional)
     * - inactive: boolean (optional, only if true)
     *
     * @param {Object} row - Query result row
     * @returns {Object} FHIR Group.member object
     *
     * @example
     * const row = {
     *   entity_reference: 'Patient/123',
     *   period_start: '2024-01-01 00:00:00.000',
     *   period_end: null,
     *   inactive: 0
     * };
     * GroupMemberMapper.toFhirMember(row)
     * // Returns: {
     * //   entity: { reference: 'Patient/123' },
     * //   period: { start: '2024-01-01T00:00:00.000Z' }
     * // }
     */
    static toFhirMember(row) {
        if (!row || !row.entity_reference) {
            throw new Error('Row must have entity_reference');
        }

        const member = {
            entity: { reference: row.entity_reference }
        };

        // Add period if start or end exists
        if (row.period_start || row.period_end) {
            member.period = {};

            if (row.period_start) {
                // Convert database timestamp to ISO 8601
                member.period.start = typeof row.period_start === 'string'
                    ? DateTimeFormatter.toISODateTime(row.period_start)
                    : row.period_start; // Already in ISO format
            }

            if (row.period_end) {
                member.period.end = typeof row.period_end === 'string'
                    ? DateTimeFormatter.toISODateTime(row.period_end)
                    : row.period_end;
            }
        }

        // Add inactive flag only if true (FHIR convention: omit false values)
        // Boolean stored as integer: 1 = true, 0 = false
        if (row.inactive === 1 || row.inactive === true) {
            member.inactive = true;
        }

        return member;
    }

    /**
     * Maps an array of result rows to FHIR Group.member array
     *
     * @param {Array<Object>} rows - Array of query result rows
     * @returns {Array<Object>} Array of FHIR Group.member objects
     *
     * @example
     * const rows = [
     *   { entity_reference: 'Patient/1', period_start: null, period_end: null, inactive: 0 },
     *   { entity_reference: 'Patient/2', period_start: '2024-01-01 00:00:00', period_end: null, inactive: 0 }
     * ];
     * GroupMemberMapper.toFhirMembers(rows)
     * // Returns: [
     * //   { entity: { reference: 'Patient/1' } },
     * //   { entity: { reference: 'Patient/2' }, period: { start: '2024-01-01T00:00:00.000Z' } }
     * // ]
     */
    static toFhirMembers(rows) {
        if (!Array.isArray(rows)) {
            return [];
        }

        return rows.map(row => this.toFhirMember(row));
    }

    /**
     * Extracts just the reference strings from an array of FHIR members
     *
     * Useful for set operations (diff, intersection, etc.)
     *
     * @param {Array<Object>} members - Array of FHIR Group.member objects
     * @returns {Array<string>} Array of reference strings
     *
     * @example
     * const members = [
     *   { entity: { reference: 'Patient/1' }, inactive: false },
     *   { entity: { reference: 'Patient/2' } }
     * ];
     * GroupMemberMapper.extractReferences(members)
     * // Returns: ['Patient/1', 'Patient/2']
     */
    static extractReferences(members) {
        if (!Array.isArray(members)) {
            return [];
        }

        return members
            .map(member => member?.entity?.reference)
            .filter(ref => ref); // Remove null/undefined
    }

    /**
     * Creates a Map of reference -> member for efficient lookups
     *
     * @param {Array<Object>} members - Array of FHIR Group.member objects
     * @returns {Map<string, Object>} Map of reference to member object
     *
     * @example
     * const members = [
     *   { entity: { reference: 'Patient/1' }, inactive: false },
     *   { entity: { reference: 'Patient/2' } }
     * ];
     * const map = GroupMemberMapper.toReferenceMap(members);
     * map.get('Patient/1') // Returns: { entity: { reference: 'Patient/1' }, inactive: false }
     */
    static toReferenceMap(members) {
        const map = new Map();

        if (!Array.isArray(members)) {
            return map;
        }

        for (const member of members) {
            const reference = member?.entity?.reference;
            if (reference) {
                map.set(reference, member);
            }
        }

        return map;
    }
}

module.exports = { GroupMemberMapper };
