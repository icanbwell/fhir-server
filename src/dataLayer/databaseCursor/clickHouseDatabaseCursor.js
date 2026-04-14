'use strict';

const { FhirResourceCreator } = require('../../fhir/fhirResourceCreator');
const { RESOURCE_COLUMN_TYPES } = require('../../constants/clickHouseConstants');

/**
 * Database cursor wrapping ClickHouse query results.
 *
 * Implements the same interface as DatabaseCursor (which wraps a MongoDB FindCursor)
 * so callers don't need to know which backend produced the results.
 *
 * Results come as an array of rows from clickHouseClientManager.queryAsync().
 * Each row has a fhirResourceColumn containing the serialized FHIR resource.
 * The cursor reconstructs FHIR resources from that column.
 */
class ClickHouseDatabaseCursor {
    /**
     * @param {Object} params
     * @param {Object[]} params.rows - Raw ClickHouse result rows
     * @param {string} params.resourceType - FHIR resource type
     * @param {string} params.base_version - FHIR version
     * @param {string} params.fhirResourceColumn - Column name holding the FHIR JSON
     * @param {string} params.fhirResourceColumnType - 'string' or 'json'
     * @param {boolean} [params.hasMore=false] - Whether more results exist beyond this page
     */
    constructor ({
        rows,
        resourceType,
        base_version,
        fhirResourceColumn,
        fhirResourceColumnType,
        hasMore = false
    }) {
        /** @type {Object[]} */
        this._rows = rows || [];
        /** @type {number} */
        this._index = 0;
        /** @type {string} */
        this.resourceType = resourceType;
        /** @type {string} */
        this.base_version = base_version;
        /** @type {string} */
        this._fhirResourceColumn = fhirResourceColumn;
        /** @type {string} */
        this._fhirResourceColumnType = fhirResourceColumnType;
        /** @type {boolean} */
        this._hasMore = hasMore;
    }

    /**
     * @param {number} milliSecs
     * @return {ClickHouseDatabaseCursor}
     */
    maxTimeMS (milliSecs) {
        // No-op for ClickHouse — timeout is set at query execution time
        return this;
    }

    /**
     * @returns {Promise<boolean>}
     */
    async hasNext () {
        return this._index < this._rows.length;
    }

    /**
     * Returns the next raw row.
     * @returns {Promise<Object|null>}
     */
    async next () {
        if (this._index >= this._rows.length) {
            return null;
        }
        return this._rows[this._index++];
    }

    /**
     * Returns the next row as a FHIR Resource object.
     * @returns {Promise<Resource|null>}
     */
    async nextObject () {
        const row = await this.next();
        if (!row) return null;
        const doc = this._extractFhirDocument(row);
        return FhirResourceCreator.mapDocumentToResourceObject(doc, this.resourceType);
    }

    /**
     * Sets a field projection. For ClickHouse results this filters
     * which fields are returned from the already-fetched rows.
     * @param {{ projection: Object }} params
     * @return {ClickHouseDatabaseCursor}
     */
    project ({ projection }) {
        if (projection) {
            this._rows = this._rows.map(row => {
                const projected = {};
                for (const [key, include] of Object.entries(projection)) {
                    if (include && row[key] !== undefined) {
                        projected[key] = row[key];
                    }
                }
                return projected;
            });
        }
        return this;
    }

    /**
     * Map all rows using the provided function.
     * @param {{ mapping: Function }} params
     * @return {ClickHouseDatabaseCursor}
     */
    map ({ mapping }) {
        this._rows = this._rows.map(mapping);
        return this;
    }

    /**
     * Returns all remaining rows as raw objects.
     * @returns {Promise<Object[]>}
     */
    async toArrayAsync () {
        const remaining = this._rows.slice(this._index);
        this._index = this._rows.length;
        return remaining.map(row => this._extractFhirDocument(row));
    }

    /**
     * Returns all remaining rows as FHIR Resource objects.
     * @returns {Promise<Resource[]>}
     */
    async toObjectArrayAsync () {
        const docs = await this.toArrayAsync();
        return docs.map(doc =>
            FhirResourceCreator.mapDocumentToResourceObject(doc, this.resourceType)
        );
    }

    /**
     * Sort — no-op for ClickHouse cursor (sorting done in SQL).
     * @param {{ sortOption: * }} params
     * @return {ClickHouseDatabaseCursor}
     */
    sort ({ sortOption }) {
        return this;
    }

    /**
     * Batch size — no-op for ClickHouse cursor (all rows already fetched).
     * @param {{ size: number }} params
     * @return {ClickHouseDatabaseCursor}
     */
    batchSize ({ size }) {
        return this;
    }

    /**
     * Hint — no-op for ClickHouse cursor (indexes managed by ClickHouse).
     * @param {{ indexHint: string|null }} params
     * @return {ClickHouseDatabaseCursor}
     */
    hint ({ indexHint }) {
        return this;
    }

    /**
     * Extracts the FHIR document from a ClickHouse row.
     * Handles both 'string' (JSON.parse) and 'json' (native CH JSON, already parsed) column types.
     *
     * @param {Object} row
     * @returns {Object} Parsed FHIR document
     * @private
     */
    _extractFhirDocument (row) {
        const rawValue = row[this._fhirResourceColumn];
        if (!rawValue) return row;

        if (this._fhirResourceColumnType === RESOURCE_COLUMN_TYPES.JSON) {
            // Native ClickHouse JSON — already a parsed object
            return typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
        }

        // String column — opaque JSON blob, needs parsing
        return typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
    }
}

module.exports = { ClickHouseDatabaseCursor };
