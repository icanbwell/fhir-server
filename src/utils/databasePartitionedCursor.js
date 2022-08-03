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

        /**
         * @type {number | null}
         * @private
         */
        this._maxTimeMS = null;

        /**
         * @type { import('mongodb').SchemaMember<import('mongodb').DefaultSchema, any>}
         * @private
         */
        this._projection = null;
    }

    /**
     * @param {number} milliSecs
     * @return {DatabasePartitionedCursor}
     */
    maxTimeMS(milliSecs) {
        this._maxTimeMS = milliSecs;
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
        this._projection = projection;
        return this;
    }

    /**
     * @param mapping
     * @return {DatabasePartitionedCursor}
     */
    map(mapping) {
        this._mapping = mapping;
        // this._cursors[0].map(mapping);
        return this;
    }

    /**
     * @return {Promise<any[]>}
     */
    async toArray() {
        return [];
    }

    /**
     * @param {string | Array<[string, number]> | import('mongodb').SortOptionObject<import('mongodb').DefaultSchema>} sortOption
     * @return {DatabasePartitionedCursor}
     */
    sort(sortOption) {
        this._sortOption = sortOption;
        // this._cursors[0].sort(sortOption);
        return this;
    }

    /**
     * @param {number} size
     * @return {DatabasePartitionedCursor}
     */
    batchSize(size){
        this._batchSize = size;
        return this;
    }

    /**
     * @param {string|null} indexHint
     * @return {DatabasePartitionedCursor}
     */
    hint(indexHint) {
        this._indexHint = indexHint;
        return this;
    }
}


module.exports = {
    DatabasePartitionedCursor
};
