/**
 * This class provides a cursor that can span multiple partitioned collections
 */
const {assertIsValid, assertFail} = require('../utils/assertType');
const {getResource} = require('../operations/common/getResource');
const async = require('async');
const {RethrownError} = require('../utils/rethrownError');
const {partitionedCollectionsCount} = require('../utils/prometheus.utils');

/**
 * @typedef CursorInfo
 * @property {string} db
 * @property {string} collection
 * @property {import('mongodb').FindCursor<import('mongodb').WithId<import('mongodb').DefaultSchema>>} cursor
 */

class DatabasePartitionedCursor {
    /**
     * Constructor
     * @param {string} base_version
     * @param {string} resourceType
     * @param {CursorInfo[]} cursors
     * @param {import('mongodb').Filter<import('mongodb').DefaultSchema>} query
     */
    constructor({base_version, resourceType, cursors, query}) {
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
        console.log(JSON.stringify({
            message: 'Created DatabasePartitionedCursor',
            collections: this._cursors.map(c => c.collection),
            query: query
        }));

        partitionedCollectionsCount.labels(resourceType).observe(cursors.length);
    }

    /**
     * Set a maxTimeMS on the cursor query, allowing for hard timeout limits on queries
     * @param {number} milliSecs
     * @return {DatabasePartitionedCursor}
     */
    maxTimeMS({milliSecs}) {
        for (const index in this._cursors) {
            this._cursors[`${index}`].cursor = this._cursors[`${index}`].cursor.maxTimeMS(milliSecs);
        }
        return this;
    }

    /**
     * Check if there is any document still available in any of the cursors
     * @return {Promise<boolean>}
     */
    async hasNext() {
        while (this._cursors.length > 0) {
            console.log(JSON.stringify({
                message: 'DatabasePartitionedCursor: hasNext',
                collections: this._cursors.map(c => c.collection),
                query: this.query
            }));

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
     * Get the next available document from the cursors, returns null if no more documents are available
     * @return {Promise<Resource|null>}
     */
    async next() {
        while (this._cursors.length > 0) {
            console.log(JSON.stringify({
                message: 'DatabasePartitionedCursor: next',
                collections: this._cursors.map(c => c.collection),
                query: this.query
            }));

            // check if the first cursor has next.  If not, remove that cursor from the list
            try {
                // return Promise.reject(new Error('woops'));
                const result = await this._cursors[0].cursor.next();
                if (result !== null) {
                    const ResourceCreator = getResource(this.base_version, this.resourceType);
                    return new ResourceCreator(result);
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
     * Sets a field projection for the query
     * @param { import('mongodb').SchemaMember<import('mongodb').DefaultSchema, any>} projection
     * @return {DatabasePartitionedCursor}
     */
    project({projection}) {
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
    map({mapping}) {
        for (const index in this._cursors) {
            this._cursors[`${index}`].cursor = this._cursors[`${index}`].cursor.map(mapping);
        }
        return this;
    }

    /**
     * Returns an array of documents.
     * The caller is responsible for making sure that there is enough memory to store the results.
     * Note that the array only contains partial results when this cursor had been previously accessed.
     * In that case, cursor.rewind() can be used to reset the cursor.
     * @return {Promise<import('mongodb').DefaultSchema[]>}
     */
    async toArray() {
        try {
            console.log(JSON.stringify({
                message: 'DatabasePartitionedCursor: toArray',
                collections: this._cursors.map(c => c.collection),
                query: this.query
            }));

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
     * Sets the sort order of the cursor query
     * @param {string | [string, number][] | import('mongodb').SortOptionObject<import('mongodb').DefaultSchema>} sortOption
     * @return {DatabasePartitionedCursor}
     */
    sort({sortOption}) {
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
    batchSize({size}) {
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
    hint({indexHint}) {
        for (const index in this._cursors) {
            this._cursors[`${index}`].cursor = this._cursors[`${index}`].cursor.hint(indexHint);
        }
        return this;
    }

    /**
     * @return {import('mongodb').Document[]}
     */
    async explainAsync() {
        try {
            console.log(JSON.stringify({
                message: 'DatabasePartitionedCursor: explain',
                collections: this._cursors.map(c => c.collection),
                query: this.query
            }));
            // explanation is needed only from the first collection
            return this._cursors.length > 0 ? [(await this._cursors[0].cursor.explain())] : [];
        } catch (e) {
            throw new RethrownError({
                collections: this._cursors.map(c => c.collection),
                databases: this._cursors.map(c => c.db),
                error: e,
                query: this.query
            });
        }
    }

    clear() {
        this._cursors = [];
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
     * @return {DatabasePartitionedCursor}
     */
    limit(count) {
        for (const index in this._cursors) {
            this._cursors[`${index}`].cursor = this._cursors[`${index}`].cursor.limit(count);
        }
        return this;
    }

    /**
     * Gets first collection
     * @return {string}
     */
    getFirstCollection() {
        return this._cursors.length > 0 ? this._cursors[0].collection : 'No cursor';
    }

    /**
     * Gets first database
     * @return {string}
     */
    getFirstDatabase() {
        return this._cursors.length > 0 ? this._cursors[0].db : 'No cursor';
    }

    /**
     * Gets all collections to be queried by this class
     * @return {string[]}
     */
    getAllCollections() {
        return this._cursors.map(c => c.collection);
    }
}

module.exports = {
    DatabasePartitionedCursor
};
