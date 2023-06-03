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

/**
 * creates a mock endpoint for /.well-known/jwks.json
 * @param {string} host
 * @return {Scope}
 */
function jwksDiscoveryEndpoint(host) {
    return nock(host)
        .persist()
        .get('/.well-known/openid-configuration')
        .reply((uri, requestBody, cb) => {
            return cb(null, {
                'authorization_endpoint': 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_D7pB7BggI/authorize',
                'id_token_signing_alg_values_supported': ['RS256'],
                'issuer': 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_D7pB7BggI',
                'jwks_uri': 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_D7pB7BggI/.well-known/jwks.json',
                'response_types_supported': ['code', 'token'],
                'scopes_supported': ['openid', 'email', 'phone', 'profile'],
                'subject_types_supported': ['public'],
                'token_endpoint': 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_D7pB7BggI/token',
                'token_endpoint_auth_methods_supported': ['client_secret_basic', 'client_secret_post'],
                'userinfo_endpoint': 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_D7pB7BggI/userInfo'
            });
        });
}

module.exports = {
    jwksEndpoint,
    jwksDiscoveryEndpoint
};
