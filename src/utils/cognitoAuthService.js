const request = require('superagent');
const jwt = require('jsonwebtoken');
const jwkToPem = require('jwk-to-pem');
const env = require('var');


// https://janitha000.medium.com/authentication-using-amazon-cognito-and-nodejs-c4485679eed8
module.exports.validate = function (token, callback) {
    let url = `https://cognito-idp.${env.AUTH_COGNITO_POOL_REGION}.amazonaws.com/${env.AUTH_COGNITO_USER_POOL_ID}/.well-known/jwks.json`;
    console.info('keys_url: ' + url);
    request
        .get(url)
        .then(response => {
            if (response.statusCode === 200) {
                const pems = {};
                const keys = response.body['keys'];
                for (let i = 0; i < keys.length; i++) {
                    const key_id = keys[i].kid;
                    const modulus = keys[i].n;
                    const exponent = keys[i].e;
                    const key_type = keys[i].kty;
                    const jwk = {kty: key_type, n: modulus, e: exponent};
                    // console.info('pem: ' + pem);
                    pems[key_id] = jwkToPem(jwk);
                }
                const decodedJwt = jwt.decode(token, {complete: true});
                if (!decodedJwt) {
                    console.log('Not a valid JWT token');
                    callback(new Error('Not a valid JWT token'));
                }
                const kid = decodedJwt.header.kid;
                const pem = pems[kid];
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
            } else {
                console.log('Error! Unable to download JWKs: ' + response);
                callback(response);
            }
        });
};
