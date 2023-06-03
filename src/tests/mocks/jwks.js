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
 * creates a mock endpoint for /.well-known/openid-configuration
 * @param {string} host
 * @return {Scope}
 */
function jwksDiscoveryEndpoint(host) {
    return nock(host)
        .persist()
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
 * @return {Scope}
 */
function jwksUserInfoEndpoint(host) {
    return nock(
        host,
        {
            reqheaders: {
                authorization: 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IjEyMyJ9.eyJzdWIiOiJmNTU5NTY5ZC1hNmM4LTRmNzAtODQ0Ny00ODliNDJmNDhiMDciLCJjdXN0b21fY2xpZW50X2lkIjoibXlfY3VzdG9tX2NsaWVudF9pZCIsInRva2VuX3VzZSI6ImFjY2VzcyIsInNjb3BlIjoibGF1bmNoL3BhdGllbnQgcGF0aWVudC9QYXRpZW50LnJlYWQgcGF0aWVudC8qLnJlYWQgcGhvbmUgb3BlbmlkIHByb2ZpbGUgZW1haWwiLCJ1c2VybmFtZSI6ImJ3ZWxsLWRlbW8tcHJvdmlkZXIiLCJpc3MiOiJodHRwOi8vZm9vOjgwIn0.kmxA_VVAhZoC7dk8k14YglyLP7LRJKY-Z0xXXQlhHtXaFqhR2AicsSnR31hnD6ZFotrw_9obC1N3zqRfJikKBQMpE3BQegH1m-BriaUgiNgUHGF5SXveOweRcvMtJjoSPDFezupMeOkqghYF7ZYFEXum-VcfIOwyqmtzi6sgnQAAW6pGw1klqzIV4ZjByaN2YW3X8f5gsEe7C0s_9e70ZjABxF_UMrSNlthNakjrI2G9JiKxS9Og9JtIu9QJ5Y-ML0wMkuPcCX3PGYoq05e7jlnhpuH8whIQRc1-H7uD-D5-riscOuCmZtsOKPAtbg75prRu-_RfukXafh6YQe0RVg',
            },
        }
    )
        .persist()
        .get('/userInfo')
        .reply(200, () => {
            return {
                'custom:bwellFhirPatientId': '9b49adf4-58ee-4b51-a707-9e48843d007b',
                'custom:bwellFhirPersonId': '6957d214-a621-4082-aa1b-659b15c3a617',
                'sub': 'f559569d-a6c8-4f70-8447-489b42f48b07',
                'email_verified': 'true',
                'custom:clientFhirPersonId': '6957d214-a621-4082-aa1b-659b15c3a617',
                'custom:clientFhirPatientId': '9b49adf4-58ee-4b51-a707-9e48843d007b',
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
