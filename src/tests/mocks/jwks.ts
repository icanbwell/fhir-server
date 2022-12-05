const nock = require('nock');
const jose = require('jose');
const async = require('async');

/**
 * creates a mock endpoint for /.well-known/jwks.json
 * @param {string} host
 * @param {string} path
 * @param {[{pub: string, kid: string}]} certs
 * @return {Scope}
 */
function jwksEndpoint(host, path, certs) {
    return nock(host)
        .persist()
        .get(`${path}`)
        .reply((uri, requestBody, cb) => {
            async.map(
                certs,
                async (cert) => {
                    const parsed = await jose.importSPKI(cert.pub, 'ES256');
                    const publicJwk = await jose.exportJWK(parsed);
                    const result = {
                        alg: 'RS256',
                        e: publicJwk.e,
                        n: publicJwk.n,
                        kty: publicJwk.kty,
                        use: 'sig',
                        kid: cert.kid,
                    };
                    return result;
                }
            ).then((keys) => cb(null, [200, {keys: keys}]));
        });
}

module.exports = {
    jwksEndpoint,
};
