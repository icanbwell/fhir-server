const request = require('superagent');
const jwt = require('jsonwebtoken');
const jwkToPem = require('jwk-to-pem');
const env = require('var');
// const jwksClient = require('jwks-rsa');

let auth_pem_keys = {};

function validateToken(token, callback, pem_keys) {
    const decodedJwt = jwt.decode(token, {complete: true});
    if (!decodedJwt) {
        console.log('Not a valid JWT token');
        callback(new Error('Not a valid JWT token'));
    }
    const kid = decodedJwt.header.kid;
    const pem = pem_keys[kid];
    if (!pem) {
        console.log('Invalid token');
        callback(new Error('Invalid token'));
    }
    jwt.verify(token, pem, function (err, payload) {
        if (err) {
            console.log('Invalid Token.');
            callback(new Error('Invalid token'));
        } else {
            // console.log('Valid Token.');
            callback(null, 'Valid token', payload);
        }
    });
}

// https://janitha000.medium.com/authentication-using-amazon-cognito-and-nodejs-c4485679eed8
module.exports.validate = function (token, callback) {
    // first see if we have the JWT keys in the cache
    if (Object.keys(auth_pem_keys).length) {
        validateToken(token, callback, auth_pem_keys);
    } else {
        // get keys from Auth server
        let url = `https://cognito-idp.${env.AUTH_COGNITO_POOL_REGION}.amazonaws.com/${env.AUTH_COGNITO_USER_POOL_ID}/.well-known/jwks.json`;
        console.info('Getting JWT keys from: ' + url);
        request
            .get(url)
            .then(response => {
                if (response.statusCode === 200) {
                    const keys = response.body['keys'];
                    for (let i = 0; i < keys.length; i++) {
                        const key_id = keys[i].kid;
                        const modulus = keys[i].n;
                        const exponent = keys[i].e;
                        const key_type = keys[i].kty;
                        const jwk = {kty: key_type, n: modulus, e: exponent};
                        // console.info('pem: ' + pem);
                        auth_pem_keys[key_id] = jwkToPem(jwk);
                    }
                    validateToken(token, callback, auth_pem_keys);
                } else {
                    console.log('Error! Unable to download JWKs: ' + response);
                    callback(response);
                }
            });
    }
};
