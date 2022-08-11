/**
 * @typedef VerifyScopesParameters
 * @type {object}
 * @property {import('../../utils/requestInfo').RequestInfo} requestInfo
 * @property {Object} args
 * @property {string} resourceType
 * @property {number|null} startTime
 * @property {string} action
 * @property {string} accessRequested
 */

const env = require('var');
const scopeChecker = require('@asymmetrik/sof-scope-checker');
const {ForbiddenError} = require('../../utils/httpErrors');
const {authorizationFailedCounter} = require('../../utils/prometheus.utils');
const {logOperation} = require('../common/logging');
const {parseScopes} = require('./scopes');
/**
 * Throws an error if no scope is valid for this request
 * @param {VerifyScopesParameters} options
 */
const verifyHasValidScopes = (options) => {
    const {requestInfo, args, resourceType, startTime, action, accessRequested} = options;
    const {user, scope} = requestInfo;

    if (env.AUTH_ENABLED === '1') {
        // http://www.hl7.org/fhir/smart-app-launch/scopes-and-launch-context/index.html
        if (scope) {
            /**
             * @type {string[]}
             */
            let scopes = parseScopes(scope);
            let {error, success} = scopeChecker(resourceType, accessRequested, scopes);

            if (success) {
                return;
            }
            let errorMessage = 'user ' + user + ' with scopes [' + scopes + '] failed access check to [' + resourceType + '.' + accessRequested + ']';
            const forbiddenError = new ForbiddenError(error.message + ': ' + errorMessage);
            authorizationFailedCounter.inc({action: action, resourceType: resourceType});
            logOperation({
                requestInfo,
                args,
                resourceType,
                startTime: startTime,
                message: 'AuthorizationFailed',
                action: action,
                error: forbiddenError
            });
            throw forbiddenError;
        } else {
            let errorMessage = 'user ' + user + ' with no scopes failed access check to [' + resourceType + '.' + accessRequested + ']';
            const forbiddenError1 = new ForbiddenError(errorMessage);
            authorizationFailedCounter.inc({action: action, resourceType: resourceType});
            logOperation({
                requestInfo,
                args,
                resourceType,
                startTime: startTime,
                message: 'AuthorizationFailed',
                action: action,
                error: forbiddenError1
            });
            throw forbiddenError1;
        }
    }
};

module.exports = {
    verifyHasValidScopes
};
