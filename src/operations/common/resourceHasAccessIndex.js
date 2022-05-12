const env = require('var');
/**
 * whether this collection has access index
 * @param {string} collection_name
 * @returns {boolean}
 */
const resourceHasAccessIndex = (collection_name) => {
    const resourcesWithAccessIndex = (env.COLLECTIONS_ACCESS_INDEX && env.COLLECTIONS_ACCESS_INDEX.split(',').map((col) => col.trim())) || [];
    return resourcesWithAccessIndex.includes(collection_name);
};

module.exports = {
    resourceHasAccessIndex: resourceHasAccessIndex
};
