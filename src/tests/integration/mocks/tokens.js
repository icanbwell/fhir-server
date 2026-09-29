const jwt = require('jsonwebtoken');

/**
 * Creates and signs a token
 * @param {string} key
 * @param {string} kid
 * @param {string | Buffer | object} payload
 * @return {string}
 */
function createToken (key, kid, payload) {
    return jwt.sign(payload, key, {
        noTimestamp: true,
        algorithm: 'RS256',
        issuer: 'http://foo:80',
        header: { alg: 'RS256', kid }
    });
}

module.exports = {
    createToken
};
