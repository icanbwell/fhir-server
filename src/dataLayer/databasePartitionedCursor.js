/**
 * This class provides a cursor that can span multiple partitioned collections
 */
const { assertIsValid, assertFail } = require('../utils/assertType');
const async = require('async');
const { RethrownError } = require('../utils/rethrownError');
const { logTraceSystemEventAsync } = require('../operations/common/systemEventLogging');
const BundleEntry = require('../fhir/classes/4_0_0/backbone_elements/bundleEntry');
const { FhirResourceCreator } = require('../fhir/fhirResourceCreator');

/**
 * @typedef CursorInfo
 * @property {string} db
 * @property {string} collection
 * @property {import('mongodb').AbstractCursor<import('mongodb').WithId<import('mongodb').DefaultSchema>>} cursor
 */

class DatabasePartitionedCursor {
    /**
     * Constructor
     * @param {string} base_version
     * @param {string} resourceType
     * @param {CursorInfo[]} cursors
     * @param {import('mongodb').Filter<import('mongodb').DefaultSchema>} query
     */
    constructor ({ base_version, resourceType, cursors, query }) {
        /**
         * @type {CursorInfo[]}
         * @private
         */
        this._cursors = cursors;
        assertIsValid(cursors);
        assertIsValid(Array.isArray(cursors));
        /**
         * @type {string}
         * @private
         */
        this.base_version = base_version;
        assertIsValid(base_version);
        /**
         * @type {string}
         * @private
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
    }

    /**
     * Set a maxTimeMS on the cursor query, allowing for hard timeout limits on queries
     * @param {number} milliSecs
     * @return {DatabasePartitionedCursor}
     */
    maxTimeMS ({ milliSecs }) {
        for (const index in this._cursors) {
            this._cursors[`${index}`].cursor = this._cursors[`${index}`].cursor.maxTimeMS(milliSecs);
        }
        return this;
    }

    /**
     * Check if there is any document still available in any of the cursors
     * @return {Promise<boolean>}
     */
    async hasNext () {
        while (this._cursors.length > 0) {
            await logTraceSystemEventAsync(
                {
                    event: 'DatabasePartitionedCursor: hasNext',
                    message: 'DatabasePartitionedCursor: hasNext',
                    args: {
                        collections: this._cursors.map(c => c.collection),
                        query: this.query
                    }
                }
            );

            // check if the first cursor has next.  If not, remove that cursor from the list
            try {
                const result = await this._cursors[0].cursor.hasNext();
                if (result) {
                    return result;
                }
                this._cursors.shift();
            } catch (e) {
                throw new RethrownError({
                    collections: this._cursors.map(c => c.collection),
                    databases: this._cursors.map(c => c.db),
                    error: e,
                    query: this.query
                });
            }
        }
        return false; // ran out of data in all the cursors
    }

    /**
     * maps a doc from the database into a Resource
     * @param {Object} doc
     * @return {Promise<Resource|BundleEntry>}
     */
    async mapDocumentToResourceAsync ({ doc }) {
        const resourceType = doc.resource ? 'BundleEntry' : doc.resourceType || this.resourceType;
        try {
            if (resourceType === 'BundleEntry') {
                // noinspection JSCheckFunctionSignatures
                return new BundleEntry(doc);
            }
            return FhirResourceCreator.createByResourceType(doc, resourceType);
        } catch (e) {
            throw new RethrownError({
                message: `Error hydrating resource from database: ${resourceType}/${doc.id}`,
                collections: this._cursors.map(c => c.collection),
                databases: this._cursors.map(c => c.db),
                error: e,
                query: this.query,
                id: doc.id
            });
        }
    }

    /**
     * Get the next available document from the cursors, returns null if no more documents are available
     * @return {Promise<Resource|BundleEntry|null>}
     */
    async next () {
        while (this._cursors.length > 0) {
            await logTraceSystemEventAsync(
                {
                    event: 'DatabasePartitionedCursor: next',
                    message: 'DatabasePartitionedCursor: next',
                    args: {
                        collections: this._cursors.map(c => c.collection),
                        query: this.query
                    }
                }
            );

            // check if the first cursor has next.  If not, remove that cursor from the list
            try {
                // return Promise.reject(new Error('woops'));
                /**
                 * @type {Object}
                 */
                const result = await this._cursors[0].cursor.next();
                if (result !== null) {
                    return await this.mapDocumentToResourceAsync({ doc: result });
                } else {
                    assertFail({
                        source: 'DatabasePartitionedCursor.next',
                        message: 'Data is null',
                        args: {
                            value: result,
                            query: this.query
                        }
                    });
                }
            } catch (e) {
                throw new RethrownError({
                    collections: this._cursors.map(c => c.collection),
                    databases: this._cursors.map(c => c.db),
                    error: e,
                    query: this.query
                });
            }
            this._cursors.shift();
        }
        return null;
    }

    /**
     * Get the next available document from the cursors, returns null if no more documents are available
     * Unlike next() this returns raw documents and not resources.
     * This can be used when you're doing projections and the document fields you get back may not validate
     *  as a full FHIR resource
     * @return {Promise<Object|null>}
     */
    async nextRaw () {
        while (this._cursors.length > 0) {
            await logTraceSystemEventAsync(
                {
                    event: 'DatabasePartitionedCursor: nextRaw',
                    message: 'DatabasePartitionedCursor: nextRaw',
                    args: {
                        collections: this._cursors.map(c => c.collection),
                        query: this.query
                    }
                }
            );

            // check if the first cursor has next.  If not, remove that cursor from the list
            try {
                const result = await this._cursors[0].cursor.next();
                if (result !== null) {
                    try {
                        // for adding resourceType to _elements case and excluding addition to history resource
                        if (!result.resourceType && !result.resource){
                            result.resourceType = this.resourceType
                        }
                        return result;
                    } catch (e) {
                        const resourceType = result.resource ? 'BundleEntry' : result.resourceType || this.resourceType;
                        throw new RethrownError({
                            message: `Error hydrating resource from database: ${resourceType}/${result.id}`,
                            collections: this._cursors.map(c => c.collection),
                            databases: this._cursors.map(c => c.db),
                            error: e,
                            query: this.query,
                            id: result.id
                        });
                    }
                } else {
                    assertFail({
                        source: 'DatabasePartitionedCursor.nextRaw',
                        message: 'Data is null',
                        args: {
                            value: result,
                            query: this.query
                        }
                    });
                }
            } catch (e) {
                throw new RethrownError({
                    collections: this._cursors.map(c => c.collection),
                    databases: this._cursors.map(c => c.db),
                    error: e,
                    query: this.query
                });
            }
            this._cursors.shift();
        }
        return null;
    }

    /**
     * Sets a field projection for the query
     * @param { import('mongodb').SchemaMember<import('mongodb').DefaultSchema, any>} projection
     * @return {DatabasePartitionedCursor}
     */
    project ({ projection }) {
        for (const index in this._cursors) {
            this._cursors[`${index}`].cursor = this._cursors[`${index}`].cursor.project(projection);
        }
        return this;
    }

    /**
     * Map all documents using the provided function
     * @param {function({Object}): Object} mapping
     * @return {DatabasePartitionedCursor}
     */
    map ({ mapping }) {
        for (const index in this._cursors) {
            this._cursors[`${index}`].cursor = this._cursors[`${index}`].cursor.map(mapping);
        }
        return this;
    }

    /**
     * Returns an array of raw documents.
     * The caller is responsible for making sure that there is enough memory to store the results.
     * Note that the array only contains partial results when this cursor had been previously accessed.
     * In that case, cursor.rewind() can be used to reset the cursor.
     * @return {Promise<import('mongodb').DefaultSchema[]>}
     */
    async toArrayRawAsync () {
        try {
            await logTraceSystemEventAsync(
                {
                    event: 'DatabasePartitionedCursor: toArrayRawAsync',
                    message: 'DatabasePartitionedCursor: toArrayRawAsync',
                    args: {
                        collections: this._cursors.map(c => c.collection),
                        query: this.query
                    }
                }
            );

            return await async.flatMap(this._cursors, async (c) => await c.cursor.toArray());
        } catch (e) {
            throw new RethrownError({
                collections: this._cursors.map(c => c.collection),
                databases: this._cursors.map(c => c.db),
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
    async toArrayAsync () {
        try {
            await logTraceSystemEventAsync(
                {
                    event: 'DatabasePartitionedCursor: toArrayAsync',
                    message: 'DatabasePartitionedCursor: toArrayAsync',
                    args: {
                        collections: this._cursors.map(c => c.collection),
                        query: this.query
                    }
                }
            );

            /**
             * @type {import('mongodb').DefaultSchema[]}
             */
            const docs = await this.toArrayRawAsync();
            return await async.map(docs, async doc => await this.mapDocumentToResourceAsync({ doc }));
        } catch (e) {
            throw new RethrownError({
                collections: this._cursors.map(c => c.collection),
                databases: this._cursors.map(c => c.db),
                error: e,
                query: this.query
            });
        }
    }

    /**
     * Sets the sort order of the cursor query
     * @param {string | [string, number][] | import('mongodb').SortOptionObject<import('mongodb').DefaultSchema>} sortOption
     * @return {DatabasePartitionedCursor}
     */
    sort ({ sortOption }) {
        for (const index in this._cursors) {
            // noinspection JSCheckFunctionSignatures
            this._cursors[`${index}`].cursor = this._cursors[`${index}`].cursor.sort(sortOption, 1);
        }
        return this;
    }

    /**
     * Set the batch size for the cursor. The number of documents to return per batch.
     * @param {number} size
     * @return {DatabasePartitionedCursor}
     */
    batchSize ({ size }) {
        for (const index in this._cursors) {
            this._cursors[`${index}`].cursor = this._cursors[`${index}`].cursor.batchSize(size);
        }
        return this;
    }

    /**
     * Set the cursor hint
     * @param {string|null} indexHint
     * @return {DatabasePartitionedCursor}
     */
    hint ({ indexHint }) {
        for (const index in this._cursors) {
            this._cursors[`${index}`].cursor = this._cursors[`${index}`].cursor.hint(indexHint);
        }
        return this;
    }

    /**
     * @return {Promise<import('mongodb').Document[]>}
     */
    async explainAsync () {
        try {
            await logTraceSystemEventAsync(
                {
                    event: 'DatabasePartitionedCursor: explain',
                    message: 'DatabasePartitionedCursor: explain',
                    args: {
                        collections: this._cursors.map(c => c.collection),
                        query: this.query
                    }
                }
            );
            if (this.resourceType === 'AuditEvent') {
                // due to online archiving, default of 'allPlansExecution' not available
                return this._cursors.length > 0 ? [(await this._cursors[0].cursor.explain('queryPlanner'))] : [];
            } else {
                // explanation is needed only from the first collection
                return this._cursors.length > 0 ? [(await this._cursors[0].cursor.explain())] : [];
            }
        } catch (e) {
            throw new RethrownError({
                collections: this._cursors.map(c => c.collection),
                databases: this._cursors.map(c => c.db),
                error: e,
                query: this.query
            });
        }
    }

    clear () {
        this._cursors = [];
    }

    /**
     * returns the query
     * @return {import('mongodb').Filter<import('mongodb').DefaultSchema>}
     */
    getQuery () {
        return this.query;
    }

    /**
     * @param {number} count
     * @return {DatabasePartitionedCursor}
     */
    limit (count) {
        this._limit = count;
        for (const index in this._cursors) {
            this._cursors[`${index}`].cursor = this._cursors[`${index}`].cursor.limit(count);
        }
        return this;
    }

    /**
     * @returns {number|null}
     */
    getLimit () {
        return this._limit;
    }

    /**
     * Gets first collection
     * @return {string}
     */
    getFirstCollection () {
        return this._cursors.length > 0 ? this._cursors[0].collection : 'No cursor';
    }

    /**
     * Gets first database
     * @return {string}
     */
    getFirstDatabase () {
        return this._cursors.length > 0 ? this._cursors[0].db : 'No cursor';
    }

    /**
     * Gets all collections to be queried by this class
     * @return {string[]}
     */
    getAllCollections () {
        return this._cursors.map(c => c.collection);
    }
}

module.exports = {
    DatabasePartitionedCursor
};
