const jwt = require('jsonwebtoken');

/**
 * Creates and signs a token
 * @param {string} key
 * @param {string} kid
 * @param {{noTimestamp: boolean, algorithm: string, header: { alg: string, kid: string}}} payload
 * @return {string}
 */
function createToken(key, kid, payload) {
    return jwt.sign(payload, key, {noTimestamp: true, algorithm: 'RS256', header: {alg: 'RS256', kid}});
}

/**
 * Creates and signs a symmetric token
 * @param {string} key
 * @param {{noTimestamp: boolean, algorithm: string, header: { alg: string, kid: string}}} payload
 * @return {string}
 */
function createSymmetricToken(key, payload) {
    return jwt.sign(payload, key, {noTimestamp: true, algorithm: 'HS256', header: {alg: 'HS256'}});
}

module.exports = {
    createToken,
    createSymmetricToken
};
