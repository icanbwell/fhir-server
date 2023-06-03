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
                    return {
                        alg: 'RS256',
                        e: publicJwk.e,
                        n: publicJwk.n,
                        kty: publicJwk.kty,
                        use: 'sig',
                        kid: cert.kid,
                    };
                }
            ).then((keys) => cb(null, [200, {keys: keys}]));
        });
}

/**
 * creates a mock endpoint for /.well-known/openid-configuration
 * @param {string} host
 * @return {Scope}
 */
function jwksDiscoveryEndpoint(host) {
    return nock(host)
        .get('/.well-known/openid-configuration')
        .reply(200, {
            'id_token_signing_alg_values_supported': ['RS256'],
            'issuer': host,
            'jwks_uri': `${host}/.well-known/jwks.json`,
            'response_types_supported': ['code', 'token'],
            'scopes_supported': ['openid', 'email', 'phone', 'profile'],
            'subject_types_supported': ['public'],
            'userinfo_endpoint': `${host}/userInfo`
        });
}

/**
 * creates a mock endpoint for /.well-known/openid-configuration
 * @param {string} host
 * @param {string} token
 * @param {string} patientId
 * @param {string} personId
 * @return {Scope}
 */
function jwksUserInfoEndpoint({host, token, patientId, personId}) {
    return nock(
        host,
        {
            reqheaders: {
                authorization: `Bearer ${token}`,
            },
        }
    )
        .get('/userInfo')
        .reply(200, () => {
            return {
                'custom:bwellFhirPatientId': patientId,
                'custom:bwellFhirPersonId': personId,
                'sub': 'f559569d-a6c8-4f70-8447-489b42f48b07',
                'email_verified': 'true',
                'custom:clientFhirPersonId': personId,
                'custom:clientFhirPatientId': patientId,
                'email': 'imran@icanbwell.com',
                'username': 'bwell-demo-provider'
            };
        });
}

module.exports = {
    jwksEndpoint,
    jwksDiscoveryEndpoint,
    jwksUserInfoEndpoint
};
