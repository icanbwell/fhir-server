const { assertIsValid } = require('../utils/assertType');
const async = require('async');
const { FhirResourceCreator } = require('../fhir/fhirResourceCreator');
const { logTraceSystemEventAsync } = require('../operations/common/systemEventLogging');

/**
 * This class wraps an array of ClickHouse result rows and implements the
 * same interface as DatabaseCursor so the search pipeline can use it
 * interchangeably with the MongoDB-backed cursor.
 */
class ClickHouseDatabaseCursor {
    /**
     * @typedef ClickHouseDatabaseCursorOptions
     * @property {string} base_version
     * @property {string} resourceType
     * @property {Object[]} results - Array of ClickHouse row objects (each has a `resource` field)
     * @property {Object} query - The original query (for diagnostics)
     * @property {string} [database] - ClickHouse database name (defaults to 'fhir')
     *
     * @param {ClickHouseDatabaseCursorOptions} options
     */
    constructor ({ base_version, resourceType, results, query, database }) {
        assertIsValid(base_version);
        assertIsValid(resourceType);

        /**
         * @type {string}
         */
        this.base_version = base_version;

        /**
         * @type {string}
         */
        this.resourceType = resourceType;

        /**
         * @type {Object[]}
         */
        this._results = results || [];

        /**
         * @type {Object}
         */
        this.query = query;

        /**
         * @type {number}
         */
        this._index = 0;

        /**
         * @type {number|null}
         */
        this._limit = null;

        /**
         * @type {boolean}
         */
        this._empty = false;

        /**
         * @type {string}
         */
        this._database = database || 'fhir';
    }

    /**
     * No-op for ClickHouse — query has already executed with its own timeout
     * @param {number} _milliSecs
     * @return {ClickHouseDatabaseCursor}
     */
    maxTimeMS ({ milliSecs: _milliSecs }) {
        return this;
    }

    /**
     * @return {Promise<boolean>}
     */
    async hasNext () {
        if (this._empty) {
            return false;
        }
        return this._index < this._results.length;
    }

    /**
     * Returns the FHIR resource document from the current row.
     * Sets resourceType if missing (matching DatabaseCursor behavior).
     * @return {Promise<Object|null>}
     */
    async next () {
        await logTraceSystemEventAsync({
            event: 'ClickHouseDatabaseCursor: next',
            message: 'ClickHouseDatabaseCursor: next',
            args: { query: this.query }
        });

        if (this._index >= this._results.length) {
            return null;
        }

        const row = this._results[this._index++];
        const doc = row.resource || row;

        // Match DatabaseCursor behavior: set resourceType if missing
        if (doc && !doc.resourceType && !doc.resource) {
            doc.resourceType = this.resourceType;
        }
        return doc;
    }

    /**
     * Get the next document as a FHIR Resource object.
     * @return {Promise<Resource|null>}
     */
    async nextObject () {
        const result = await this.next();
        if (!result) {
            return null;
        }
        return FhirResourceCreator.mapDocumentToResourceObject(result, this.resourceType);
    }

    /**
     * No-op — projection is handled in the SQL SELECT clause
     * @return {ClickHouseDatabaseCursor}
     */
    project ({ projection: _projection }) {
        return this;
    }

    /**
     * No-op — mapping is applied in-memory if needed
     * @return {ClickHouseDatabaseCursor}
     */
    map ({ mapping: _mapping }) {
        return this;
    }

    /**
     * Returns all remaining FHIR resource documents as raw objects.
     * @return {Promise<Object[]>}
     */
    async toArrayAsync () {
        await logTraceSystemEventAsync({
            event: 'ClickHouseDatabaseCursor: toArrayAsync',
            message: 'ClickHouseDatabaseCursor: toArrayAsync',
            args: { query: this.query }
        });

        const docs = [];
        for (let i = this._index; i < this._results.length; i++) {
            const row = this._results[i];
            const doc = row.resource || row;
            if (doc && !doc.resourceType && !doc.resource) {
                doc.resourceType = this.resourceType;
            }
            docs.push(doc);
        }
        this._index = this._results.length;
        return docs;
    }

    /**
     * Returns all remaining documents as FHIR Resource objects.
     * @return {Promise<Resource[]>}
     */
    async toObjectArrayAsync () {
        await logTraceSystemEventAsync({
            event: 'ClickHouseDatabaseCursor: toObjectArrayAsync',
            message: 'ClickHouseDatabaseCursor: toObjectArrayAsync',
            args: { query: this.query }
        });

        const docs = await this.toArrayAsync();
        return await async.map(docs, async (doc) => FhirResourceCreator.mapDocumentToResourceObject(doc, this.resourceType));
    }

    /**
     * No-op — sort is handled in the ClickHouse ORDER BY clause
     * @return {ClickHouseDatabaseCursor}
     */
    sort ({ sortOption: _sortOption }) {
        return this;
    }

    /**
     * No-op — batch size is a MongoDB streaming concept; ClickHouse results are already loaded
     * @return {ClickHouseDatabaseCursor}
     */
    batchSize ({ size: _size }) {
        return this;
    }

    /**
     * No-op — index hints are MongoDB-specific
     * @return {ClickHouseDatabaseCursor}
     */
    hint ({ indexHint: _indexHint }) {
        return this;
    }

    /**
     * @return {Promise<Object[]>}
     */
    async explainAsync () {
        return [{
            source: 'ClickHouse',
            table: 'fhir.AuditEvent_4_0_0',
            query: this.query,
            resultCount: this._results.length
        }];
    }

    setEmpty () {
        this._empty = true;
    }

    /**
     * @return {Object}
     */
    getQuery () {
        return this.query;
    }

    /**
     * @param {number} count
     * @return {ClickHouseDatabaseCursor}
     */
    limit (count) {
        this._limit = count;
        return this;
    }

    /**
     * @return {number|null}
     */
    getLimit () {
        return this._limit;
    }

    /**
     * @return {string}
     */
    getCollection () {
        return `${this.resourceType}_${this.base_version}`;
    }

    /**
     * @return {string}
     */
    getDatabase () {
        return this._database;
    }
}

module.exports = {
    ClickHouseDatabaseCursor
};
