const Strategy = require('passport-http-bearer').Strategy;
const cognitoAuthService = require('../utils/cognitoAuthService');
const {UnauthorizedError} = require('../../utils/httpErrors');

/**
 * Bearer Strategy
 *
 * This strategy will handle requests with BearerTokens.  This is only a template and should be configured to
 * your AuthZ server specifications.
 *
 * Requires ENV variables for introspecting the token
 */
module.exports.strategy = new Strategy(function (token, done) {
    // https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-tokens-verifying-a-jwt.html
    cognitoAuthService.validate(token, function (err, result, decodedToken) {
        if (err) {
            return done(new UnauthorizedError(Error('Invalid token')));
        }
        const client_id = decodedToken.client_id;
        const scope = decodedToken.scope;
        console.info('client_id: ' + client_id + 'scope: ' + scope);
        const context = null;
        return done(null, client_id, {scope, context});
    });
});
