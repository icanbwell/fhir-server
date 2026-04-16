const { SECURITY_TAG_SYSTEMS } = require('../../constants/securityTagSystems');

/**
 * Transforms MongoDB AuditEvent documents into ClickHouse rows matching the
 * lean RFC schema (see clickhouse-init/02-audit-event.sql).
 *
 * Dedicated columns are extracted for frequently-queried fields.
 * The full FHIR document is stored in the `resource` Native JSON column
 * so all remaining search params are queryable via resource.{path}.
 *
 * References prefer _uuid over reference for globally unique identifiers:
 *   agent[0].who._uuid = "Practitioner/uuid-123"
 *   -> agent_who = ['Practitioner/uuid-123']
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
     * Safely extracts a reference string from a FHIR Reference object.
     * Prefers _uuid (globally unique) over reference (local id).
     * @param {Object|undefined} ref
     * @returns {string}
     */
    extractReference(ref) {
        if (!ref) return '';
        return ref._uuid || ref.reference || '';
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
     * Extracts the who reference from the agent where requestor === true.
     * Prefers _uuid over reference.
     * @param {Array} agents
     * @returns {string}
     */
    extractRequestorWho(agents) {
        if (!Array.isArray(agents)) return '';
        const requestor = agents.find((a) => a.requestor === true);
        if (!requestor?.who) return '';
        return requestor.who._uuid || requestor.who.reference || '';
    }

    /**
     * Extracts meta.security as array of named tuples for ClickHouse
     * Array(Tuple(system, code)) column.
     * ClickHouse JSONEachRow format requires named objects, not positional arrays.
     * @param {Array|undefined} securityArray - doc.meta.security
     * @returns {Array<{system: string, code: string}>}
     */
    extractMetaSecurity(securityArray) {
        if (!Array.isArray(securityArray)) return [];
        const tuples = [];
        for (const tag of securityArray) {
            if (tag.system && tag.code) {
                tuples.push({ system: tag.system, code: tag.code });
            }
        }
        return tuples;
    }

    /**
     * Extracts purposeOfEvent codings as array of named tuples.
     * AuditEvent.purposeOfEvent is Array(CodeableConcept), each with .coding[].
     * Flattens all codings into a single Array(Tuple(system, code)).
     * @param {Array|undefined} purposeOfEventArray - doc.purposeOfEvent
     * @returns {Array<{system: string, code: string}>}
     */
    extractPurposeOfEvent(purposeOfEventArray) {
        if (!Array.isArray(purposeOfEventArray)) return [];
        const tuples = [];
        for (const concept of purposeOfEventArray) {
            if (!Array.isArray(concept.coding)) continue;
            for (const coding of concept.coding) {
                if (coding.system && coding.code) {
                    tuples.push({ system: coding.system, code: coding.code });
                }
            }
        }
        return tuples;
    }

    /**
     * Transforms a single MongoDB AuditEvent document to a ClickHouse row
     * @param {Object} doc - MongoDB AuditEvent document
     * @returns {Object|null} ClickHouse row or null if malformed
     */
    transformDocument(doc) {
        if (!doc._uuid) {
            return null;
        }

        if (!doc.recorded) {
            return null;
        }

        const agents = doc.agent || [];
        const entities = doc.entity || [];

        return {
            id: doc.id || '',
            _uuid: doc._uuid,
            recorded: this.toClickHouseDateTime(doc.recorded),
            action: doc.action || '',
            agent_who: this.collectFromArray(agents, (a) => this.extractReference(a.who)),
            agent_altid: this.collectFromArray(agents, (a) => a.altId),
            entity_what: this.collectFromArray(entities, (e) => this.extractReference(e.what)),
            agent_requestor_who: this.extractRequestorWho(agents),
            purpose_of_event: this.extractPurposeOfEvent(doc.purposeOfEvent),
            meta_security: this.extractMetaSecurity(doc.meta?.security),
            access_tags: (doc.meta?.security || []).filter(s => s.system === SECURITY_TAG_SYSTEMS.ACCESS).map(s => s.code),
            _sourceAssigningAuthority: doc._sourceAssigningAuthority || '',
            _sourceId: doc._sourceId || '',
            resource: doc
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
