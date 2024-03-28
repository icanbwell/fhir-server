const { COLLECTION } = require('../constants');

/**
 * Check if the input collection name exists in the COLLECTION
 * @param {string} collectionName
 * @returns {boolean}
 */
function isValidResource (collectionName) {
    return Object.keys(
        COLLECTION).some(key => COLLECTION[key].toLowerCase() === collectionName.toLowerCase()
    );
}

module.exports = {
    isValidResource
};
