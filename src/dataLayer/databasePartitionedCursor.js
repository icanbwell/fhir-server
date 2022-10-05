/**
 * This class provides a cursor that can span multiple partitioned collections
 */
const {assertIsValid, assertFail} = require('../utils/assertType');
const {getResource} = require('../operations/common/getResource');
const async = require('async');

class DatabasePartitionedCursor {
    /**
     * Constructor
     * @param {string} base_version
     * @param {string} resourceType
     * @param {(import('mongodb').FindCursor<import('mongodb').WithId<import('mongodb').DefaultSchema>>)[]} cursors
     * @param {import('mongodb').Filter<import('mongodb').DefaultSchema>} query
     */
    constructor({base_version, resourceType, cursors, query}) {
        /**
         * @type {(import('mongodb').FindCursor<import('mongodb').WithId<import('mongodb').DefaultSchema>>)[]}
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
    }

    /**
     * Set a maxTimeMS on the cursor query, allowing for hard timeout limits on queries
     * @param {number} milliSecs
     * @return {DatabasePartitionedCursor}
     */
    maxTimeMS({milliSecs}) {
        for (const index in this._cursors) {
            this._cursors[`${index}`] = this._cursors[`${index}`].maxTimeMS(milliSecs);
        }
        return this;
    }

    /**
     * Check if there is any document still available in any of the cursors
     * @return {Promise<boolean>}
     */
    async hasNext() {
        while (this._cursors.length > 0) {
            // check if the first cursor has next.  If not, remove that cursor from the list
            const result = await this._cursors[0].hasNext();
            if (result) {
                return result;
            }
            this._cursors.shift();
        }
        return false; // ran out of data in all the cursors
    }

    /**
     * Get the next available document from the cursors, returns null if no more documents are available
     * @return {Promise<Resource|null>}
     */
    async next() {
        while (this._cursors.length > 0) {
            // check if the first cursor has next.  If not, remove that cursor from the list
            const result = await this._cursors[0].next();
            if (result !== null) {
                const ResourceCreator = getResource(this.base_version, this.resourceType);
                return new ResourceCreator(result);
            } else {
                assertFail({
                    source: 'DatabasePartitionedCursor.next',
                    message: 'Data is null',
                    args: {value: result}
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
            this._cursors[`${index}`] = this._cursors[`${index}`].project(projection);
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
            this._cursors[`${index}`] = this._cursors[`${index}`].map(mapping);
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
        return await async.map(this._cursors, async (c) => await c.toArray());
    }

    /**
     * Sets the sort order of the cursor query
     * @param {string | [string, number][] | import('mongodb').SortOptionObject<import('mongodb').DefaultSchema>} sortOption
     * @return {DatabasePartitionedCursor}
     */
    sort({sortOption}) {
        for (const index in this._cursors) {
            // noinspection JSCheckFunctionSignatures
            this._cursors[`${index}`] = this._cursors[`${index}`].sort(sortOption, 1);
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
            this._cursors[`${index}`] = this._cursors[`${index}`].batchSize(size);
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
            this._cursors[`${index}`] = this._cursors[`${index}`].hint(indexHint);
        }
        return this;
    }

    /**
     * @return {import('mongodb').Document[]}
     */
    async explainAsync() {
        return await async.map(this._cursors, async (c) => await c.explain());
    }
}

module.exports = {
    DatabasePartitionedCursor
};
