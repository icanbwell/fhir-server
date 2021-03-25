const jwt = require('jsonwebtoken');
const env = require('var');
const jwksClient = require('jwks-rsa');

// eslint-disable-next-line no-unused-vars
const validateToken = async function (token) {
    const client = jwksClient({
        cache: true, // Default Value
        cacheMaxEntries: 5, // Default value
        cacheMaxAge: 600000, // Defaults to 10m
        jwksUri: `https://cognito-idp.${env.AUTH_COGNITO_POOL_REGION}.amazonaws.com/${env.AUTH_COGNITO_USER_POOL_ID}/.well-known/jwks.json`
    });
    const decodedJwt = jwt.decode(token, {complete: true});
    if (!decodedJwt) {
        console.log('Not a valid JWT token');
        throw new Error('Not a valid JWT token');
    }
    /**
     * @type {string}
     */
    const kid = decodedJwt.header.kid;
    /**
     * @type {import('jwks-rsa').JwksRsa.CertSigningKey | import('jwks-rsa').JwksRsa.RsaSigningKey}
     */
    const key = await client.getSigningKey(kid);
    /**
     * @type {string}
     */
    const signingKey = key.getPublicKey();
    if (!signingKey) {
        console.log('Invalid token');
        throw new Error('Invalid token');
    }
    // noinspection UnnecessaryLocalVariableJS
    const payload = jwt.verify(token, signingKey);
    console.log('Valid Token.' + payload);
    return payload;
};

// https://janitha000.medium.com/authentication-using-amazon-cognito-and-nodejs-c4485679eed8
// eslint-disable-next-line no-unused-vars
module.exports.validate = async function (token) {
    return Promise.resolve({
        client_id: 'foo',
        scope: 'bar'
    });
    // return await validateToken(token);
};
