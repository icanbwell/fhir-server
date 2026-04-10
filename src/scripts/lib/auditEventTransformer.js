/**
 * Flattens MongoDB AuditEvent documents into ClickHouse columnar rows.
 *
 * All FHIR search parameters are extracted into native ClickHouse columns
 * for efficient querying. The full FHIR JSON is stored in `raw` for
 * response serialization.
 *
 * Agent and entity arrays are flattened into parallel ClickHouse arrays:
 *   agent[0].who = "Practitioner/123", agent[1].who = "Device/456"
 *   -> agent_who = ['Practitioner/123', 'Device/456']
 */

class AuditEventTransformer {
    /**
     * Converts ISO 8601 date to ClickHouse DateTime64 format
     * @param {string|Date} date
     * @returns {string}
     */
    toClickHouseDateTime(date) {
        const iso = typeof date === 'string' ? date : date.toISOString();
        return iso.replace('T', ' ').replace('Z', '');
    }

    /**
     * Safely extracts a reference string from a FHIR Reference object
     * @param {Object|undefined} ref
     * @returns {string}
     */
    extractReference(ref) {
        if (!ref) return '';
        return ref.reference || '';
    }

    /**
     * Collects non-empty values from an array using an extractor function
     * @param {Array} arr
     * @param {Function} extractor
     * @returns {string[]}
     */
    collectFromArray(arr, extractor) {
        if (!Array.isArray(arr)) return [];
        const values = [];
        for (const item of arr) {
            const val = extractor(item);
            if (val) values.push(val);
        }
        return values;
    }

    /**
     * Flattens nested coding arrays (e.g. agent[*].role[*].coding[*].code)
     * @param {Array} items - Array of agent/entity objects
     * @param {Function} roleExtractor - Returns the role/type field from each element
     * @param {string} codingField - 'system' or 'code'
     * @returns {string[]}
     */
    flattenNestedCodings(items, roleExtractor, codingField) {
        if (!Array.isArray(items)) return [];
        const values = [];
        for (const item of items) {
            const roles = roleExtractor(item);
            if (!roles) continue;
            const roleArray = Array.isArray(roles) ? roles : [roles];
            for (const role of roleArray) {
                const codings = role?.coding || [];
                for (const coding of codings) {
                    if (coding[codingField]) {
                        values.push(coding[codingField]);
                    }
                }
            }
        }
        return values;
    }

    /**
     * Transforms a single MongoDB AuditEvent document to a ClickHouse row
     * @param {Object} doc - MongoDB AuditEvent document
     * @returns {Object|null} ClickHouse row or null if malformed
     */
    transformDocument(doc) {
        const id = doc._uuid || doc._sourceId || doc.id;
        if (!id) {
            return null;
        }

        const recorded = doc.recorded;
        if (!recorded) {
            return null;
        }

        const lastUpdated = doc.meta?.lastUpdated || recorded;
        const agents = doc.agent || [];
        const entities = doc.entity || [];
        const subtypes = doc.subtype || [];

        const entityTypeSystems = [];
        const entityTypeCodes = [];
        const entityRoleSystems = [];
        const entityRoleCodes = [];
        for (const entity of entities) {
            if (entity.type?.system) entityTypeSystems.push(entity.type.system);
            if (entity.type?.code) entityTypeCodes.push(entity.type.code);
            if (entity.role?.system) entityRoleSystems.push(entity.role.system);
            if (entity.role?.code) entityRoleCodes.push(entity.role.code);
        }

        return {
            mongo_id: doc._id.toString(),
            last_updated: this.toClickHouseDateTime(lastUpdated),

            recorded: this.toClickHouseDateTime(recorded),
            action: doc.action || '',
            outcome: doc.outcome || '',

            type_system: doc.type?.system || '',
            type_code: doc.type?.code || '',

            subtype_system: this.collectFromArray(subtypes, s => s.system),
            subtype_code: this.collectFromArray(subtypes, s => s.code),

            source_observer: this.extractReference(doc.source?.observer),
            source_site: doc.source?.site || '',

            agent_who: this.collectFromArray(agents, a => this.extractReference(a.who)),
            agent_name: this.collectFromArray(agents, a => a.name),
            agent_altid: this.collectFromArray(agents, a => a.altId),
            agent_role_system: this.flattenNestedCodings(agents, a => a.role, 'system'),
            agent_role_code: this.flattenNestedCodings(agents, a => a.role, 'code'),
            agent_policy: agents.flatMap(a => a.policy || []),
            agent_network_address: this.collectFromArray(agents, a => a.network?.address),

            entity_what: this.collectFromArray(entities, e => this.extractReference(e.what)),
            entity_name: this.collectFromArray(entities, e => e.name),
            entity_type_system: entityTypeSystems,
            entity_type_code: entityTypeCodes,
            entity_role_system: entityRoleSystems,
            entity_role_code: entityRoleCodes,

            raw: JSON.stringify(doc)
        };
    }

    /**
     * Transforms a batch of documents, skipping malformed ones
     * @param {Object[]} docs
     * @returns {{rows: Object[], skipped: number}}
     */
    transformBatch(docs) {
        const rows = [];
        let skipped = 0;
        for (const doc of docs) {
            const row = this.transformDocument(doc);
            if (row) {
                rows.push(row);
            } else {
                skipped++;
            }
        }
        return { rows, skipped };
    }
}

module.exports = { AuditEventTransformer };
