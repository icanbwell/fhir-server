/**
 * This class handles database cursor
 */
const { assertIsValid } = require('../utils/assertType');
const async = require('async');
const { RethrownError } = require('../utils/rethrownError');
const { logTraceSystemEventAsync } = require('../operations/common/systemEventLogging');
const BundleEntry = require('../fhir/classes/4_0_0/backbone_elements/bundleEntry');
const { FhirResourceCreator } = require('../fhir/fhirResourceCreator');
const { FindCursor } = require('mongodb');

class DatabaseCursor {
    /**
     * Constructor
     * @typedef DatabaseCursorOptions
     * @property {string} base_version
     * @property {string} resourceType
     * @property {FindCursor} cursor
     * @property {import('mongodb').Filter<import('mongodb').DefaultSchema>} query
     *
     * @param {DatabaseCursorOptions} options
     */
    constructor({ base_version, resourceType, cursor, query }) {
        assertIsValid(cursor);
        /**
         * @type {FindCursor}
         */
        this.cursor = cursor;

        /**
         * @type {string}
         */
        this.base_version = base_version;
        assertIsValid(base_version);

        /**
         * @type {string}
         */
        this.resourceType = resourceType;
        assertIsValid(resourceType);

        /**
         * @type {import('mongodb').Filter<import('mongodb').DefaultSchema>}
         */
        this.query = query;

        /**
         * @type {number|null}
         */
        this._limit = null;

        /**
         * @type {boolean}
         */
        this._empty = false;
    }

    /**
     * Set a maxTimeMS on the cursor query, allowing for hard timeout limits on queries
     * @param {number} milliSecs
     * @return {DatabaseCursor}
     */
    maxTimeMS({ milliSecs }) {
        this.cursor = this.cursor.maxTimeMS(milliSecs);
        return this;
    }

    /**
     * Check if there is any document available in cursor
     * @return {Promise<boolean>}
     */
    async hasNext() {
        if (!this._empty) {
            await logTraceSystemEventAsync({
                event: 'DatabaseCursor: hasNext',
                message: 'DatabaseCursor: hasNext',
                args: {
                    collections: this.cursor.namespace.collection,
                    query: this.query
                }
            });

            return await this.cursor.hasNext();
        }
        return false;
    }

    /**
     * Get the next available document from the cursor, returns null if no more documents are available
     * @return {Promise<Object|null>}
     */
    async next() {
        await logTraceSystemEventAsync({
            event: 'DatabaseCursor: next',
            message: 'DatabaseCursor: next',
            args: {
                collections: this.cursor.namespace.collection,
                query: this.query
            }
        });

        try {
            const result = await this.cursor.next();
            if (result !== null) {
                // for adding resourceType to _elements case and excluding addition to history resource
                if (!result.resourceType && !result.resource) {
                    result.resourceType = this.resourceType;
                }
                return result;
            }
        } catch (e) {
            throw new RethrownError({
                collections: this.cursor.namespace.collection,
                databases: this.cursor.namespace.db,
                error: e,
                query: this.query
            });
        }
        return null;
    }

    /**
     * Get the next available document from the cursors and return it as a Resource or BundleEntry object.
     * Returns null if no more documents are available.
     * @return {Promise<Resource|BundleEntry|null>}
     */
    async nextObject() {
        try {
            /**
             * @type {Object}
             */
            const result = await this.next();
            if (result !== null) {
                return FhirResourceCreator.mapDocumentToResourceObject(result, this.resourceType);
            }
        } catch (e) {
            throw new RethrownError({
                collections: this.cursor.namespace.collection,
                databases: this.cursor.namespace.db,
                error: e,
                query: this.query
            });
        }
        return null;
    }

    /**
     * Sets a field projection for the query
     * @param { import('mongodb').SchemaMember<import('mongodb').DefaultSchema, any>} projection
     * @return {DatabaseCursor}
     */
    project({ projection }) {
        this.cursor = this.cursor.project(projection);
        return this;
    }

    /**
     * Map all documents using the provided function
     * @param {function({Object}): Object} mapping
     * @return {DatabaseCursor}
     */
    map({ mapping }) {
        this.cursor = this.cursor.map(mapping);
        return this;
    }

    /**
     * Returns an array of raw documents.
     * The caller is responsible for making sure that there is enough memory to store the results.
     * Note that the array only contains partial results when this cursor had been previously accessed.
     * In that case, cursor.rewind() can be used to reset the cursor.
     * @return {Promise<import('mongodb').DefaultSchema[]>}
     */
    async toArrayAsync() {
        try {
            await logTraceSystemEventAsync({
                event: 'DatabaseCursor: toArrayAsync',
                message: 'DatabaseCursor: toArrayAsync',
                args: {
                    collections: this.cursor.namespace.collection,
                    query: this.query
                }
            });

            return await this.cursor.toArray();
        } catch (e) {
            throw new RethrownError({
                collections: this.cursor.namespace.collection,
                databases: this.cursor.namespace.db,
                error: e,
                query: this.query
            });
        }
    }

    /**
     * Returns an array of resources.
     * The caller is responsible for making sure that there is enough memory to store the results.
     * Note that the array only contains partial results when this cursor had been previously accessed.
     * In that case, cursor.rewind() can be used to reset the cursor.
     * @return {Promise<Resource[]>}
     */
    async toObjectArrayAsync() {
        try {
            await logTraceSystemEventAsync({
                event: 'DatabaseCursor: toObjectArrayAsync',
                message: 'DatabaseCursor: toObjectArrayAsync',
                args: {
                    collections: this.cursor.namespace.collection,
                    query: this.query
                }
            });

            const docs = await this.toArrayAsync();
            return await async.map(docs, async (doc) => FhirResourceCreator.mapDocumentToResourceObject(doc, this.resourceType));
        } catch (e) {
            throw new RethrownError({
                collections: this.cursor.namespace.collection,
                databases: this.cursor.namespace.db,
                error: e,
                query: this.query
            });
        }
    }

    /**
     * Sets the sort order of the cursor query
     * @param {string | [string, number][] | import('mongodb').SortOptionObject<import('mongodb').DefaultSchema>} sortOption
     * @return {DatabaseCursor}
     */
    sort({ sortOption }) {
        this.cursor = this.cursor.sort(sortOption, 1);
        return this;
    }

    /**
     * Set the batch size for the cursor. The number of documents to return per batch.
     * @param {number} size
     * @return {DatabaseCursor}
     */
    batchSize({ size }) {
        this.cursor = this.cursor.batchSize(size);
        return this;
    }

    /**
     * Set the cursor hint
     * @param {string|null} indexHint
     * @return {DatabaseCursor}
     */
    hint({ indexHint }) {
        this.cursor = this.cursor.hint(indexHint);
        return this;
    }

    /**
     * @return {Promise<import('mongodb').Document[]>}
     */
    async explainAsync() {
        try {
            await logTraceSystemEventAsync({
                event: 'DatabaseCursor: explain',
                message: 'DatabaseCursor: explain',
                args: {
                    collections: this.cursor.namespace.collection,
                    query: this.query
                }
            });
            if (this.resourceType === 'AuditEvent') {
                // due to online archiving, default of 'allPlansExecution' not available
                return [this.cursor.explain('queryPlanner')];
            } else {
                return [this.cursor.explain()];
            }
        } catch (e) {
            throw new RethrownError({
                collections: this.cursor.namespace.collection,
                databases: this.cursor.namespace.db,
                error: e,
                query: this.query
            });
        }
    }

    setEmpty() {
        this._empty = true;
    }

    /**
     * returns the query
     * @return {import('mongodb').Filter<import('mongodb').DefaultSchema>}
     */
    getQuery() {
        return this.query;
    }

    /**
     * @param {number} count
     * @return {DatabaseCursor}
     */
    limit(count) {
        this._limit = count;
        this.cursor = this.cursor.limit(count);
        return this;
    }

    /**
     * @returns {number|null}
     */
    getLimit() {
        return this._limit;
    }

    /**
     * Gets the cursor collection
     * @return {string}
     */
    getCollection() {
        return this.cursor.namespace.collection;
    }

    /**
     * Gets the cursor database
     * @return {string}
     */
    getDatabase() {
        return this.cursor.namespace.db;
    }
}

module.exports = {
    DatabaseCursor
};
