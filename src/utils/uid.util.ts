/**
 * This file implement helper functions for generate uuids
 */

const hash = require('object-hash');
const crypto = require('crypto');


/**
 * Make a hash of the object for use as a UUID.
 * TODO Improve this. Stuck this in just because it's more of a uniqueness guarantee than the above 'getUID' function.
 * TODO If we're actually going to generate hashes, we should probably do it in a more secure manner.
 * @param obj
 * @returns {string}
 */
const getHash = (obj) => {
    return hash(obj);
};

/**
 * Generates a UUID
 * @return {string}
 */
const generateUUID = () => crypto.randomUUID();

const uuidRegex = new RegExp('[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}');

/**
 * Checks whether the provided string is a uuid using regex
 * @param {string} text
 * @return {boolean}
 */
function isUuid(text) {
    return uuidRegex.test(text);
}


module.exports = {
    getHash,
    generateUUID,
    isUuid
};
