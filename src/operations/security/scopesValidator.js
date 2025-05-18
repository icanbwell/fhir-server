const scopeChecker = require('@asymmetrik/sof-scope-checker');
const {ForbiddenError} = require('../../utils/httpErrors');
const {assertTypeEquals} = require('../../utils/assertType');
const {ScopesManager} = require('./scopesManager');
const {FhirLoggingManager} = require('../common/fhirLoggingManager');
const {ConfigManager} = require('../../utils/configManager');
const {PatientScopeManager} = require('./patientScopeManager');
const {PreSaveManager} = require('../../preSaveHandlers/preSave');
const {RESOURCE_RESTRICTION_TAG} = require('../../constants');

class ScopesValidator {
    /**
     * constructor
     * @param {ScopesManager} scopesManager
     * @param {FhirLoggingManager} fhirLoggingManager
     * @param {ConfigManager} configManager
     * @param {PatientScopeManager} patientScopeManager
     * @param {PreSaveManager} preSaveManager
     */
    constructor({
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
     * @param {string} resourceType
     * @param {("read"|"write")} accessRequested (can be either 'read' or 'write')
     * @returns {ForbiddenError}
     */
    verifyHasValidScopes({requestInfo, resourceType, accessRequested}) {
        // eslint-disable-next-line no-useless-catch
        try {
            const {user, scope} = requestInfo;
            let errorMessage, forbiddenError;

            // http://www.hl7.org/fhir/smart-app-launch/scopes-and-launch-context/index.html
            if (scope) {
                /**
                 * @type {string[]}
                 */
                let scopes;
                const accessViaPatientScopes = this.scopesManager.isAccessAllowedByPatientScopes({
                    scope, resourceType
                });

                let error, success;
                if (accessViaPatientScopes) {
                    scopes = this.scopesManager.getPatientScopes({scope});
                    ({error, success} = scopeChecker(resourceType, accessRequested, scopes));
                } else {
                    scopes = this.scopesManager.getUserScopes({scope});
                    // if patient scopes are present then only read is allowed to non patient resources
                    if (!this.scopesManager.hasPatientScope({scope}) || accessRequested === 'read') {
                        ({error, success} = scopeChecker(resourceType, accessRequested, scopes));
                    } else {
                        error = 'Write not allowed using user scopes if patient scope is present';
                    }
                }

                if (success) {
                    // add any access codes from scopes
                    const accessCodes = this.scopesManager.getAccessCodesFromScopes(accessRequested, user, scope);
                    // check if atleast one access code with requested access is present or patient scope is present
                    if (accessCodes.length > 0 || accessViaPatientScopes) {
                        return;
                    }
                }

                if (!success) {
                    errorMessage = 'user ' + user + ' with scopes [' + scopes + '] failed access check to [' + resourceType + '.' + accessRequested + ']';
                    forbiddenError = new ForbiddenError((error.message || error) + ': ' + errorMessage);
                } else {
                    const errorMessage = 'user ' + user + ' with scopes [' + scope + '] has no access scopes';
                    forbiddenError = new ForbiddenError(errorMessage);
                }
            } else {
                errorMessage = 'user ' + user + ' with no scopes failed access check to [' + resourceType + '.' + accessRequested + ']';
                forbiddenError = new ForbiddenError(errorMessage);
            }

            return forbiddenError;
        } catch (err) {
            throw err;
        }
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
            // Verify if scopes are valid
            const forbiddenError = this.verifyHasValidScopes({requestInfo, resourceType, accessRequested});

            if (forbiddenError) {
                await this.fhirLoggingManager.logOperationFailureAsync({
                    requestInfo,
                    args: parsedArgs?.getRawArgs(),
                    resourceType,
                    startTime,
                    action,
                    error: forbiddenError
                });
                throw forbiddenError;
            }
        } catch (e) {
            throw e;
        }
    }

    /**
     * Returns whether the scopes allow access to this resource
     * @param {FhirRequestInfo} requestInfo
     * @param {ParsedArgs} parsedArgs
     * @param {string} resourceType
     * @param {number|null} startTime
     * @param {string} action
     * @param {("read"|"write")} accessRequested (can be either 'read' or 'write')
     * @returns {Promise<boolean>}
     */
    async hasValidScopesAsync(
        {
            requestInfo,
            parsedArgs,
            resourceType,
            startTime,
            action,
            accessRequested
        }
    ) {
         const forbiddenError = this.verifyHasValidScopes({requestInfo, resourceType, accessRequested});

         return !forbiddenError;
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
    isAccessToResourceAllowedByAccessScopes({requestInfo, resource, accessRequested = 'write'}) {
        // eslint-disable-next-line no-useless-catch
        try {
            const {user, scope} = requestInfo;
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
                    `to resource ${resource.resourceType} with id ${resource.id}`
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
    async isAccessToResourceAllowedByPatientScopes({requestInfo, resource, base_version}) {
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
                    `The current patient scope and person id in the JWT token do not allow writing the ${resource.resourceType} resource.`
                );
            }
        } catch (e) {
            throw e;
        }
    }

    /**
     * Throws forbidden error when access through patient scope and resource is restricted
     * @typedef {Object} IsAccessToResourceRestrictedForPatientScopeParams
     * @property {import('../../utils/fhirRequestInfo').FhirRequestInfo} requestInfo
     * @property {Resource} resource
     * @property {string} accessRequested
     *
     * @param {IsAccessToResourceRestrictedForPatientScopeParams}
     */
    isAccessToResourceRestrictedForPatientScope({requestInfo, resource, accessRequested = 'write'}) {
        const {isUser, user, scope} = requestInfo
        if (
            isUser &&
            resource.meta?.security?.some(
                (s) =>
                    s.system === RESOURCE_RESTRICTION_TAG.SYSTEM &&
                    s.code === RESOURCE_RESTRICTION_TAG.CODE
            )
        ) {
            throw new ForbiddenError(
                `user ${user} with scopes [${scope}] has no ${accessRequested} access ` +
                `to resource ${resource.resourceType} with id ${resource.id}`
            );
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
    async isAccessToResourceAllowedByAccessAndPatientScopes({
                                                                requestInfo,
                                                                resource,
                                                                base_version,
                                                                accessRequested = 'write'
                                                            }) {
        // eslint-disable-next-line no-useless-catch
        try {
            // Run preSave to generate _uuid values for references and resource
            resource = await this.preSaveManager.preSaveAsync({resource});
            // validate access scopes for resource
            this.isAccessToResourceAllowedByAccessScopes({requestInfo, resource, accessRequested});
            // validate if resource being accessed is restricted for patient
            this.isAccessToResourceRestrictedForPatientScope({requestInfo, resource, accessRequested});
            // validate patient scopes for resource
            await this.isAccessToResourceAllowedByPatientScopes({requestInfo, resource, base_version});
        } catch (e) {
            throw e;
        }
    }
}

module.exports = {
    ScopesValidator
};
