class DatabasePartitionedCursor {
    /**
     * @param {import('mongodb').Cursor<import('mongodb').DefaultSchema>[]} cursors
     */
    constructor(cursors) {
        /**
         * @type {import('mongodb').Cursor<import('mongodb').DefaultSchema>[]}
         * @private
         */
        this._cursors = cursors;
    }

    /**
     * @param {number} milliSecs
     * @return {DatabasePartitionedCursor}
     */
    maxTimeMS(milliSecs) {
        for (const index in this._cursors) {
            this._cursors[`${index}`] = this._cursors[`${index}`].maxTimeMS(milliSecs);
        }
        return this;
    }

    /**
     * @return {Promise<boolean>}
     */
    async hasNext() {
        return await this._cursors[0].hasNext();
    }

    /**
     * @return {Promise<Resource>}
     */
    async next() {
        return await this._cursors[0].next();
    }

    /**
     * @param { import('mongodb').SchemaMember<import('mongodb').DefaultSchema, any>} projection
     * @return {DatabasePartitionedCursor}
     */
    project(projection) {
        for (const index in this._cursors) {
            this._cursors[`${index}`] = this._cursors[`${index}`].project(projection);
        }
        return this;
    }

    /**
     * @param mapping
     * @return {DatabasePartitionedCursor}
     */
    map(mapping) {
        for (const index in this._cursors) {
            this._cursors[`${index}`] = this._cursors[`${index}`].map(mapping);
        }
        return this;
    }

    /**
     * @return {Promise<import('mongodb').DefaultSchema[]>}
     */
    async toArray() {
        /**
         * @type {import('mongodb').DefaultSchema[]}
         */
        let result = [];
        for (const cursor of this._cursors) {
            result = result.concat(cursor.toArray());
        }
        return result;
    }

    /**
     * @param {string | Array<[string, number]> | import('mongodb').SortOptionObject<import('mongodb').DefaultSchema>} sortOption
     * @return {DatabasePartitionedCursor}
     */
    sort(sortOption) {
        for (const index in this._cursors) {
            this._cursors[`${index}`] = this._cursors[`${index}`].sort(sortOption);
        }
        return this;
    }

    /**
     * @param {number} size
     * @return {DatabasePartitionedCursor}
     */
    batchSize(size) {
        for (const index in this._cursors) {
            this._cursors[`${index}`] = this._cursors[`${index}`].batchSize(size);
        }
        return this;
    }

    /**
     * @param {string|null} indexHint
     * @return {DatabasePartitionedCursor}
     */
    hint(indexHint) {
        for (const index in this._cursors) {
            this._cursors[`${index}`] = this._cursors[`${index}`].hint(indexHint);
        }
        return this;
    }
}

module.exports = {
    DatabasePartitionedCursor
};
