const env = require('var');
const scopeChecker = require('@asymmetrik/sof-scope-checker');
const {ForbiddenError} = require('../../utils/httpErrors');
const {authorizationFailedCounter} = require('../../utils/prometheus.utils');
const {assertTypeEquals} = require('../../utils/assertType');
const {ScopesManager} = require('./scopesManager');
const {FhirLoggingManager} = require('../common/fhirLoggingManager');

class ScopesValidator {
    /**
     * constructor
     * @param {ScopesManager} scopesManager
     * @param {FhirLoggingManager} fhirLoggingManager
     */
    constructor({scopesManager, fhirLoggingManager}) {
        /**
         * @type {ScopesManager}
         */
        this.scopesManager = scopesManager;
        assertTypeEquals(scopesManager, ScopesManager);
        /**
         * @type {FhirLoggingManager}
         */
        this.fhirLoggingManager = fhirLoggingManager;
        assertTypeEquals(fhirLoggingManager, FhirLoggingManager);
    }

    /**
     * Throws an error if no scope is valid for this request
     * @param {FhirRequestInfo} requestInfo
     * @param {Object} args
     * @param {string} resourceType
     * @param {number|null} startTime
     * @param {string} action
     * @param {string} accessRequested
     */
    async verifyHasValidScopesAsync(
        {
            requestInfo,
            args,
            resourceType,
            startTime,
            action,
            accessRequested
        }
    ) {
        const {user, scope} = requestInfo;

        if (env.AUTH_ENABLED === '1') {
            // http://www.hl7.org/fhir/smart-app-launch/scopes-and-launch-context/index.html
            if (scope) {
                /**
                 * @type {string[]}
                 */
                let scopes = this.scopesManager.parseScopes(scope);
                let {error, success} = scopeChecker(resourceType, accessRequested, scopes);

                if (success) {
                    return;
                }
                let errorMessage = 'user ' + user + ' with scopes [' + scopes + '] failed access check to [' + resourceType + '.' + accessRequested + ']';
                const forbiddenError = new ForbiddenError(error.message + ': ' + errorMessage);
                authorizationFailedCounter.inc({action: action, resourceType: resourceType});
                await this.fhirLoggingManager.logOperationFailureAsync(
                    {
                        requestInfo,
                        args,
                        resourceType,
                        startTime: startTime,
                        action: action,
                        error: forbiddenError
                    });
                throw forbiddenError;
            } else {
                let errorMessage = 'user ' + user + ' with no scopes failed access check to [' + resourceType + '.' + accessRequested + ']';
                const forbiddenError1 = new ForbiddenError(errorMessage);
                authorizationFailedCounter.inc({action: action, resourceType: resourceType});
                await this.fhirLoggingManager.logOperationFailureAsync(
                    {
                        requestInfo,
                        args,
                        resourceType,
                        startTime: startTime,
                        action: action,
                        error: forbiddenError1
                    });
                throw forbiddenError1;
            }
        }
    }
}

module.exports = {
    ScopesValidator
};
