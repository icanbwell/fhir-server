/**
 * Transforms AccessLogger documents into ClickHouse rows for the
 * fhir.AccessLog table (see clickhouse-init/04-access-log.sql).
 *
 * The doc shape (see src/utils/accessLogger.js logEntry) is preserved
 * verbatim in three JSON columns (agent, details, request). Materialized
 * columns (agent_altId, origin_service, request_id) are derived by
 * ClickHouse from the JSON and do not appear here.
 */

class AccessLogTransformer {
    /**
     * Converts a Date or ISO 8601 string to ClickHouse DateTime64 format.
     * @param {string|Date} date
     * @returns {string}
     */
    toClickHouseDateTime(date) {
        const iso = typeof date === 'string' ? date : date.toISOString();
        return iso.replace('T', ' ').replace('Z', '');
    }

    /**
     * Coerces a scopes value to an array of strings.
     * AccessLogger stores requestInfo.scope, which may be a space-delimited
     * string or an array.
     * @param {string|string[]|undefined} scopes
     * @returns {string[]}
     */
    normalizeScopes(scopes) {
        if (Array.isArray(scopes)) return scopes.filter((s) => typeof s === 'string');
        if (typeof scopes === 'string') return scopes.split(/\s+/).filter(Boolean);
        return [];
    }

    /**
     * Transforms a single access-log document to a ClickHouse row.
     * Skips documents missing required fields.
     * @param {Object} doc - AccessLogger logEntry
     * @returns {Object|null}
     */
    transformDocument(doc) {
        if (!doc || !doc.timestamp || !doc.request?.id) {
            return null;
        }

        const agent = doc.agent ? { ...doc.agent, scopes: this.normalizeScopes(doc.agent.scopes) } : {};

        return {
            timestamp: this.toClickHouseDateTime(doc.timestamp),
            outcome_desc: doc.outcomeDesc || '',
            agent,
            details: doc.details || {},
            request: doc.request
        };
    }

    /**
     * Transforms a batch of documents, skipping malformed ones.
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

module.exports = { AccessLogTransformer };
