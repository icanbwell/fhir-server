'use strict';

const { AuditEventTransformer } = require('./auditEventTransformer');

/**
 * Field extractor for AuditEvent ClickHouse-only storage.
 *
 * Wraps the existing AuditEventTransformer (used by the write path)
 * to implement the extract(resource) interface expected by the
 * ClickHouse schema registry and generic repository.
 */
class AuditEventFieldExtractor {
    constructor () {
        this._transformer = new AuditEventTransformer();
    }

    /**
     * Extracts a flat ClickHouse row from a FHIR AuditEvent resource.
     * Throws (via AuditEventTransformer) when mandatory fields are absent —
     * see the transformer for the invariants.
     *
     * @param {Object} resource - FHIR AuditEvent resource
     * @returns {Object} Flat row keyed by ClickHouse column names
     */
    extract (resource) {
        const doc = typeof resource.toJSONInternal === 'function'
            ? resource.toJSONInternal()
            : resource;
        return this._transformer.transformDocument(doc);
    }
}

module.exports = { AuditEventFieldExtractor };
