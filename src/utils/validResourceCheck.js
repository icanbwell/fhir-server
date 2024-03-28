const { COLLECTION } = require('../constants');

/**
 * Check if the input collection name exists in the COLLECTION
 * @param {string} collectionName
 * @returns {boolean}
 */
function isValidResource (collectionName) {
    return Object.values(COLLECTION).some(value => value === collectionName);
}

module.exports = {
    isValidResource
};
