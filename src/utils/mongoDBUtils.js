/**
 * Check if a collection is a valid collection and not a system collection
 * @param {String} collectionName
 * @returns {boolean}
 */
const isNotSystemCollection = (collectionName) => {
    const systemCollectionNames = ['system.', 'fs.files', 'fs.chunks'];
    return !systemCollectionNames.some((systemCollectionName) => collectionName.indexOf(systemCollectionName) !== -1);
};

module.exports = {
    isNotSystemCollection
};
