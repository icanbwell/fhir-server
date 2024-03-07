const scopeChecker = require('@asymmetrik/sof-scope-checker');
const { ForbiddenError } = require('../../utils/httpErrors');
const { authorizationFailedCounter } = require('../../utils/prometheus.utils');
const { assertTypeEquals } = require('../../utils/assertType');
const { ScopesManager } = require('./scopesManager');
const { FhirLoggingManager } = require('../common/fhirLoggingManager');
const { ConfigManager } = require('../../utils/configManager');
const { PatientScopeManager } = require('./patientScopeManager');
const { PreSaveManager } = require('../../preSaveHandlers/preSave');

class ScopesValidator {
    /**
     * constructor
     * @param {ScopesManager} scopesManager
     * @param {FhirLoggingManager} fhirLoggingManager
     * @param {ConfigManager} configManager
     * @param {PatientScopeManager} patientScopeManager
     * @param {PreSaveManager} preSaveManager
     */
    constructor ({
        scopesManager,
        fhirLoggingManager,
        configManager,
        patientScopeManager,
        preSaveManager
    }) {
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
        /**
         * @type {PatientScopeManager}
         */
        this.patientScopeManager = patientScopeManager;
        assertTypeEquals(patientScopeManager, PatientScopeManager);
        /**
         * @type {PreSaveManager}
         */
        this.preSaveManager = preSaveManager;
        assertTypeEquals(preSaveManager, PreSaveManager);
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
    async verifyHasValidScopesAsync (
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
            const { user, scope } = requestInfo;
            let errorMessage, forbiddenError;

            // http://www.hl7.org/fhir/smart-app-launch/scopes-and-launch-context/index.html
            if (scope) {
                /**
                 * @type {string[]}
                 */
                const scopes = this.scopesManager.parseScopes(scope);
                const { error, success } = scopeChecker(resourceType, accessRequested, scopes);

                if (success) {
                    const hasPatientScope = this.scopesManager.hasPatientScope({ scope });
                    // add any access codes from scopes
                    const accessCodes = this.scopesManager.getAccessCodesFromScopes(accessRequested, user, scope);
                    // check if atleast one access code with requested access is present or patient scope is present
                    if (accessCodes.length > 0 || hasPatientScope) {
                        return;
                    }
                }

                if (!success) {
                    errorMessage = 'user ' + user + ' with scopes [' + scopes + '] failed access check to [' + resourceType + '.' + accessRequested + ']';
                    forbiddenError = new ForbiddenError(error.message + ': ' + errorMessage);
                } else {
                    const errorMessage = 'user ' + user + ' with scopes [' + scope + '] has no access scopes';
                    forbiddenError = new ForbiddenError(errorMessage);
                }
            } else {
                errorMessage = 'user ' + user + ' with no scopes failed access check to [' + resourceType + '.' + accessRequested + ']';
                forbiddenError = new ForbiddenError(errorMessage);
            }

            authorizationFailedCounter.inc({ action, resourceType });
            await this.fhirLoggingManager.logOperationFailureAsync({
                requestInfo,
                args: parsedArgs.getRawArgs(),
                resourceType,
                startTime,
                action,
                error: forbiddenError
            });
            throw forbiddenError;
        } catch (e) {
            throw e;
        }
    }

    /**
     * Throws forbidden error when access through access scope is not allowed
     * @typedef {Object} IsAccessToResourceAllowedByAccessScopesParams
     * @property {import('../../utils/fhirRequestInfo').FhirRequestInfo} requestInfo
     * @property {Resource} resource
     * @property {string} accessRequested
     *
     * @param {IsAccessToResourceAllowedByAccessScopesParams}
     */
    isAccessToResourceAllowedByAccessScopes ({ requestInfo, resource, accessRequested = 'write' }) {
        // eslint-disable-next-line no-useless-catch
        try {
            const { user, scope } = requestInfo;
            if (
                !this.scopesManager.isAccessToResourceAllowedBySecurityTags({
                    resource,
                    user,
                    scope,
                    accessRequested
                })
            ) {
                throw new ForbiddenError(
                    `user ${user} with scopes [${scope}] has no ${accessRequested} access ` +
                    ` to resource ${resource.resourceType} with id ${resource.id}`
                );
            }
        } catch (e) {
            throw e;
        }
    }

    /**
     * Throws forbidden error when access through patient scope is not allowed
     * @typedef {Object} IsAccessToResourceAllowedByPatientScopesParams
     * @property {import('../../utils/fhirRequestInfo').FhirRequestInfo} requestInfo
     * @property {Resource} resource
     * @property {string} base_version
     *
     * @param {IsAccessToResourceAllowedByPatientScopesParams}
     */
    async isAccessToResourceAllowedByPatientScopes ({ requestInfo, resource, base_version }) {
        // eslint-disable-next-line no-useless-catch
        try {
            if (
                !(await this.patientScopeManager.canWriteResourceAsync({
                    resource,
                    ...requestInfo,
                    base_version
                }))
            ) {
                throw new ForbiddenError(
                    'The current patient scope and person id in the JWT token do not allow writing this resource.'
                );
            }
        } catch (e) {
            throw e;
        }
    }

    /**
     * Throws forbidden error when access through patient scope or access scope is not allowed
     * @typedef {Object} IsAccessToResourceAllowedByAccessAndPatientScopesParams
     * @property {import('../../utils/fhirRequestInfo').FhirRequestInfo} requestInfo
     * @property {Resource} resource
     * @property {string} base_version
     * @property {string} accessRequested
     *
     * @param {IsAccessToResourceAllowedByAccessAndPatientScopesParams}
     */
    async isAccessToResourceAllowedByAccessAndPatientScopes ({
        requestInfo,
        resource,
        base_version,
        accessRequested = 'write'
    }) {
        // eslint-disable-next-line no-useless-catch
        try {
            try {
                // Run preSave to generate _uuid values for references and resource
                resource = await this.preSaveManager.preSaveAsync({ base_version, requestInfo, resource });
            } catch (err) {
                // ignore this error as it might be due to incomplete resource body in merge
            }
            // validate access scopes for resource
            this.isAccessToResourceAllowedByAccessScopes({ requestInfo, resource, accessRequested });
            // validate patient scopes for resource
            await this.isAccessToResourceAllowedByPatientScopes({ requestInfo, resource, base_version });
        } catch (e) {
            throw e;
        }
    }
}

module.exports = {
    ScopesValidator
};
