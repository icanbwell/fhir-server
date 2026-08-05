const scopeChecker = require('@asymmetrik/sof-scope-checker');
const {ForbiddenError} = require('../../utils/httpErrors');
const {assertTypeEquals} = require('../../utils/assertType');
const {ScopesManager} = require('./scopesManager');
const {FhirLoggingManager} = require('../common/fhirLoggingManager');
const {ConfigManager} = require('../../utils/configManager');
const {PatientScopeManager} = require('./patientScopeManager');
const {PreSaveManager} = require('../../preSaveHandlers/preSave');
const {PreSaveOptions} = require('../../preSaveHandlers/preSaveOptions');
const {RESOURCE_RESTRICTION_TAG, AUTH_USER_TYPES} = require('../../constants');
const {DelegatedAccessScopeManager} = require('./delegatedAccessScopeManager');

class ScopesValidator {
    /**
     * constructor
     * @param {ScopesManager} scopesManager
     * @param {FhirLoggingManager} fhirLoggingManager
     * @param {ConfigManager} configManager
     * @param {PatientScopeManager} patientScopeManager
     * @param {PreSaveManager} preSaveManager
     * @param {DelegatedAccessScopeManager} delegatedAccessScopeManager
     */
    constructor({
                    scopesManager,
                    fhirLoggingManager,
                    configManager,
                    patientScopeManager,
                    preSaveManager,
                    delegatedAccessScopeManager
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
        /**
         * @type {DelegatedAccessScopeManager}
         */
        this.delegatedAccessScopeManager = delegatedAccessScopeManager;
        assertTypeEquals(delegatedAccessScopeManager, DelegatedAccessScopeManager);
    }

    /**
     * Central scope validation — checks delegated actor consent + standard scopes.
     * @param {FhirRequestInfo} requestInfo
     * @param {string} resourceType
     * @param {("read"|"write")} accessRequested
     * @returns {Promise<ForbiddenError|undefined>}
     */
    async isScopesValidAsync({requestInfo, resourceType, accessRequested}) {
        // eslint-disable-next-line no-useless-catch
        try {
            if (this.configManager.enableDelegatedAccessDetection && requestInfo.userType === AUTH_USER_TYPES.delegatedUser) {
                const isAllowed = await this.delegatedAccessScopeManager.isAccessAllowedAsync({
                    actor: requestInfo.actor,
                    personIdFromJwtToken: requestInfo.personIdFromJwtToken
                });
                if (!isAllowed) {
                    return new ForbiddenError(
                        'User does not have valid permission for delegated access'
                    );
                }
            }

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
            const forbiddenError = await this.isScopesValidAsync({requestInfo, resourceType, accessRequested});

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
        const forbiddenError = await this.isScopesValidAsync({requestInfo, resourceType, accessRequested});
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
     * Throws forbidden error when the caller is not allowed to make this change to the resource's access
     * tags (SEC-1580 F2/F3): a caller with write access to a resource via one access tag must not be able
     * to add or remove a *different* access tag it isn't itself authorized for, since that silently
     * changes who else can see/write the resource without that other tenant's authorization ever being
     * checked.
     * @typedef {Object} IsAccessTagChangeAllowedByAccessScopesParams
     * @property {import('../../utils/fhirRequestInfo').FhirRequestInfo} requestInfo
     * @property {Resource|null} currentResource resource as currently stored, null/undefined when being created
     * @property {Resource} updatedResource resource as it will be stored
     * @property {boolean} [ignoreRemovals] set when the calling write path can only append access tags
     *
     * @param {IsAccessTagChangeAllowedByAccessScopesParams}
     */
    isAccessTagChangeAllowedByAccessScopes ({ requestInfo, currentResource, updatedResource, ignoreRemovals = false }) {
        const { user, scope } = requestInfo;
        if (
            !this.scopesManager.isAccessTagChangeAllowedByScopes({
                oldAccessCodes: this.scopesManager.getAccessTagCodes(currentResource),
                newAccessCodes: this.scopesManager.getAccessTagCodes(updatedResource),
                resourceType: updatedResource.resourceType,
                user,
                scope,
                ignoreRemovals
            })
        ) {
            throw new ForbiddenError(
                `user ${user} with scopes [${scope}] can only add or remove access tags it has write access to, ` +
                `for resource ${updatedResource.resourceType} with id ${updatedResource.id}`
            );
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
            const preSaveOptions = PreSaveOptions.fromRequestInfo(requestInfo);
            resource = await this.preSaveManager.preSaveAsync({resource, options: preSaveOptions});
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

    /**
     * Returns whether the given scope string carries an admin scope broad enough to unlock
     * _explain/_debug/_setIndexHint.
     *
     * Deliberately stricter than admin.js's own "any admin/ scope" check (a separate,
     * pre-existing pattern this does not touch): _explain/_debug/_setIndexHint are a
     * cross-cutting, not-resource-scoped capability (query-plan disclosure and index
     * selection apply to every resource type), so a caller holding a narrow admin grant for
     * one specific capability (e.g. admin/AuditEvent.write) should not thereby unlock it. The
     * scope's resource segment must be a wildcard, e.g. admin/*.read or admin/*.*.
     * @param {string|null} scope
     * @return {boolean}
     */
    isAdminScope({scope}) {
        return this.scopesManager.getAdminScopes({scope}).some(
            (adminScope) => adminScope.split('/')[1]?.split('.')[0] === '*'
        );
    }
}

module.exports = {
    ScopesValidator
};
