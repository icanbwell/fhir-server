const {assertTypeEquals} = require('../utils/assertType');
const {IndexProvider} = require('./indexProvider');

/**
 * This file implements adding index hints to mongo db queries
 */
class IndexHinter {
    /**
     * constructor
     * @param {IndexProvider} indexProvider
     */
    constructor(
        {
            indexProvider
        }
    ) {
        /**
         * @type {IndexProvider}
         */
        this.indexProvider = indexProvider;
        assertTypeEquals(indexProvider, IndexProvider);
    }

    /**
     * returns whether two sets are the same (regardless of sorting)
     * @param {Set} as
     * @param {Set} bs
     * @return {boolean}
     */
    eqSet(as, bs) {
        if (as.size !== bs.size) {
            return false;
        }
        for (const a of as) {
            if (!bs.has(a)) {
                return false;
            }
        }
        for (const b of bs) {
            if (!as.has(b)) {
                return false;
            }
        }
        return true;
    }

    /**
     * find index for given collection and fields
     * @param {string} collectionName
     * @param {string[]} fields
     * @return {string|null}
     */
    findIndexForFields(collectionName, fields) {
        if (!fields || fields.length === 0) {
            return null;
        }
        if (collectionName.includes('_History')) {
            // don't index history collections
            return null;
        }
        const fieldsSet = new Set(fields);

        const baseCollectionName = collectionName.endsWith('_4_0_0') ?
            collectionName : collectionName.substring(0, collectionName.indexOf('_4_0_0') + 6);

        const indexes = this.indexProvider.getIndexes();
        for (const [indexCollectionName,
            /** @type {{keys:Object, options:Object, exclude: string[]}[]} */ indexConfigs]
            of Object.entries(indexes)) {
            if (indexCollectionName === '*' || baseCollectionName === indexCollectionName) {
                for (const /** @type {{keys:Object, options:Object, exclude: string[]}} */ indexConfig of indexConfigs) {
                    if (!indexConfig.exclude || !indexConfig.exclude.includes(baseCollectionName)) {
                        const indexColumns = Object.keys(indexConfig.keys);
                        if (this.eqSet(new Set(indexColumns), fieldsSet)) {
                            return indexConfig.options.name;
                        }
                    }
                }
            }
        }
        return null;
    }
}

module.exports = {
    IndexHinter
};
