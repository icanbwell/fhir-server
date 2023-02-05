/**
 * This file implement helper functions for generate uuids
 */

const hash = require('object-hash');
const crypto = require('crypto');
const {v5: uuidv5, validate: uuidValidate} = require('uuid');
const OID_NAMESPACE = '6ba7b812-9dad-11d1-80b4-00c04fd430c8';


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
 * Generates a v5 UUID.  A v5 UUID is a deterministic uuid based on name so everytime the name is used
 * the same uuid will be generated.
 * We use the OID namespace: {6ba7b812-9dad-11d1-80b4-00c04fd430c8}
 * https://www.rfc-editor.org/rfc/rfc4122#appendix-C
 *
 * Info about UUID v5
 * https://www.sohamkamani.com/uuid-versions-explained/
 * Probability of collision of UUID5: https://en.wikipedia.org/wiki/Birthday_problem#Probability_table
 * UUID are 32 hex characters so for 2.6 x 10^10 number of elements the probability is 10^-18
 * https://stackoverflow.com/questions/10867405/generating-v5-uuid-what-is-name-and-namespace
 * For 128-bits, hashing 26 billion keys this way has a probability of collision of p=10^-18 (negligible),
 * but 26 trillion keys, increases the probability of at least one collision to p=10^-12 (one in a trillion),
 * and hashing 26*10^15 keys, increases the probability of at least one collision to p=10^-6 (one in a million).
 * Adjusting for 5 bits that encode the UUID type, it will run out somewhat faster, so a trillion keys have
 * roughly a 1-in-a-trillion chance of having a single collision.
 * @param {string} name
 * @return {string}
 */
const generateUUIDv5 = (name) => uuidv5(name, OID_NAMESPACE);
/**
 * Generates a UUID
 * @return {string}
 */
const generateUUID = () => crypto.randomUUID();

// const uuidRegex = new RegExp('[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}');

/**
 * Checks whether the provided string is a uuid using regex
 * @param {string|undefined|null} text
 * @return {boolean}
 */
function isUuid(text) {
    return text && uuidValidate(text);
}


module.exports = {
    getHash,
    generateUUID,
    isUuid,
    generateUUIDv5
};
