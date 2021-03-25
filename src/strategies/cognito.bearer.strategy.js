const JwtStrategy = require('passport-jwt').Strategy;
const ExtractJwt = require('passport-jwt').ExtractJwt;
const jwksRsa = require('jwks-rsa');
const env = require('var');

const verify = (jwt_payload, done) => {
    console.log('Verify user:', jwt_payload);

    if (jwt_payload && jwt_payload.sub) {
        return done(null, jwt_payload);
    }

    return done(null, false);
};

/**
 * Bearer Strategy
 *
 * This strategy will handle requests with BearerTokens.  This is only a template and should be configured to
 * your AuthZ server specifications.
 *
 * Requires ENV variables for introspecting the token
 */
module.exports.strategy = new JwtStrategy({
        // Dynamically provide a signing key based on the kid in the header and the signing keys provided by the JWKS endpoint.
        secretOrKeyProvider: jwksRsa.passportJwtSecret({
            cache: true,
            rateLimit: true,
            jwksRequestsPerMinute: 5,
            jwksUri: `https://cognito-idp.${env.AUTH_COGNITO_POOL_REGION}.amazonaws.com/${env.AUTH_COGNITO_USER_POOL_ID}/.well-known/jwks.json`
        }),
        jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),

        // Validate the audience and the issuer.
        audience: 'urn:my-resource-server',
        issuer: 'https://my-authz-server/',
        algorithms: ['RS256']
    },
    verify);
