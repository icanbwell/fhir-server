const scopeChecker = require('@asymmetrik/sof-scope-checker');
const {ForbiddenError} = require('../../utils/httpErrors');
const {authorizationFailedCounter} = require('../../utils/prometheus.utils');
const {assertTypeEquals} = require('../../utils/assertType');
const {ScopesManager} = require('./scopesManager');
const {FhirLoggingManager} = require('../common/fhirLoggingManager');
const {ConfigManager} = require('../../utils/configManager');

class ScopesValidator {
    /**
     * constructor
     * @param {ScopesManager} scopesManager
     * @param {FhirLoggingManager} fhirLoggingManager
     * @param {ConfigManager} configManager
     */
    constructor({scopesManager, fhirLoggingManager, configManager}) {
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
        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
    }

    /**
     * Throws an error if no scope is valid for this request
     * @param {FhirRequestInfo} requestInfo
     * @param {ParsedArgs} parsedArgs
     * @param {string} resourceType
     * @param {number|null} startTime
     * @param {string} action
     * @param {("read"|"write")} accessRequested (can be either 'read' or 'write')
     */
    async verifyHasValidScopesAsync(
        {
            requestInfo,
            parsedArgs,
            resourceType,
            startTime,
            action,
            accessRequested
        }
    ) {
        // eslint-disable-next-line no-useless-catch
        try {
            const {user, scope} = requestInfo;

            if (this.configManager.authEnabled) {
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
                            args: parsedArgs.getRawArgs(),
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
                            args: parsedArgs.getRawArgs(),
                            resourceType,
                            startTime: startTime,
                            action: action,
                            error: forbiddenError1
                        });
                    throw forbiddenError1;
                }
            }
        } catch (e) {
            throw e;
        }
    }
}

module.exports = {
    ScopesValidator
};
