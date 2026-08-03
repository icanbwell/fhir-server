const { ForbiddenError } = require('../../utils/httpErrors');
const { assertTypeEquals, assertIsValid } = require('../../utils/assertType');
const { SecurityTagSystem } = require('../../utils/securityTagSystem');
const { ConfigManager } = require('../../utils/configManager');
const { PatientFilterManager } = require('../../fhir/patientFilterManager');

class ScopesManager {
    /**
     * constructor
     * @param {ConfigManager} configManager
     * @param {PatientFilterManager} patientFilterManager
     */
    constructor ({
        configManager,
        patientFilterManager
    }) {
        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);

        /**
         * @type {PatientFilterManager}
         */
        this.patientFilterManager = patientFilterManager;
        assertTypeEquals(patientFilterManager, PatientFilterManager);
    }

    /**
     * converts a space separated list of scopes into an array of scopes
     * @param {string} scope
     * @return {string[]}
     */
    parseScopes (scope) {
        if (!scope) {
            return [];
        }
        return scope.split(' ');
    }

    /**
     * Returns all the access codes present in scopes
     * @param {string} action
     * @param {string} user
     * @param {string|null} scope
     * @return {string[]} security tags allowed by scopes
     */
    getAccessCodesFromScopes (action, user, scope) {
        assertIsValid(typeof user === 'string', `user is of type: ${typeof user} but should be string.`);
        // http://www.hl7.org/fhir/smart-app-launch/scopes-and-launch-context/index.html
        /**
         * @type {string[]}
         */
        const scopes = this.parseScopes(scope);
        /**
         * @type {string[]}
         */
        const access_codes = [];
        /**
         * @type {string}
         */
        for (const scope1 of scopes) {
            if (scope1.startsWith('access')) {
                // ex: access/client.*
                /**
                 * @type {string}
                 */
                const inner_scope = scope1.replace('access/', '');
                const [securityTag, accessType] = inner_scope.split('.');
                if (accessType === '*' || accessType === action) {
                    access_codes.push(securityTag);
                }
            }
        }
        return access_codes;
    }

    /**
     * Checks whether the resource has any access and owner codes that are in the passed in accessCodes list
     * @param {string[]} accessCodes
     * @param {Resource} resource
     * @return {boolean}
     */
    doesResourceHaveAnyAccessCodeFromThisList (accessCodes, resource) {
        // fail if there are no access codes
        if (!accessCodes || accessCodes.length === 0) {
            return false;
        }

        // see if we have the * access code
        if (accessCodes.includes('*')) {
            // no security check since user has full access to everything
            return true;
        }

        if (!resource.meta || !resource.meta.security) {
            // resource has not meta or security tags so don't return it
            return false;
        }
        /**
         * @type {string[]}
         */
        const accessCodesFromOwnerTag = resource.meta.security
            .filter(s => s.system === SecurityTagSystem.owner)
            .map(s => s.code);
        /**
         * @type {string[]}
         */
        const accessCodesFromAccessTag = resource.meta.security
            .filter(s => s.system === SecurityTagSystem.access)
            .map(s => s.code);

        const hasOwnerCode = accessCodes.some(c => accessCodesFromOwnerTag.includes(c));
        const hasAccessCode = accessCodes.some(c => accessCodesFromAccessTag.includes(c));

        return hasOwnerCode && hasAccessCode;
    }

    /**
     * Returns the codes of all access tags present on the resource
     * @param {Resource|Object|null} resource
     * @return {string[]}
     */
    getAccessTagCodes (resource) {
        if (!resource || !resource.meta || !resource.meta.security) {
            return [];
        }
        return resource.meta.security
            .filter(s => s.system === SecurityTagSystem.access)
            .map(s => s.code);
    }

    /**
     * Returns whether the caller is allowed to change a resource's access tags from oldAccessCodes to
     * newAccessCodes.
     *
     * A resource can legitimately carry access tags for several clients at once, and a client that has
     * access to a resource is allowed to share it with, or stop sharing it with, other clients by adding
     * or removing access tags. But the write check on the resource itself only requires that *one* of its
     * access tags matches the caller's scopes, so without this check a caller could add an access tag for
     * a client it has no access to (silently sharing the resource with that client) or remove one
     * (silently hiding the resource from a client that was entitled to it). So unless the caller holds the
     * '*' access code, every access code it adds or removes must be one it is itself authorized for.
     *
     * @typedef {Object} IsAccessTagChangeAllowedByScopesParams
     * @property {string[]} oldAccessCodes access codes on the resource as currently stored
     * @property {string[]} newAccessCodes access codes on the resource as it will be stored
     * @property {string} resourceType
     * @property {string} user
     * @property {string} scope
     * @property {boolean} ignoreRemovals when the write path can only add access tags, never remove them
     *
     * @param {IsAccessTagChangeAllowedByScopesParams}
     * @return {boolean}
     */
    isAccessTagChangeAllowedByScopes ({
        oldAccessCodes,
        newAccessCodes,
        resourceType,
        user,
        scope,
        ignoreRemovals = false
    }) {
        // a patient scoped caller is authorized by the patient the resource belongs to rather than by access
        // codes, and holds no access scopes to compare against, so leave it to the patient scope checks
        if (this.isAccessAllowedByPatientScopes({ scope, resourceType })) {
            return true;
        }
        /**
         * @type {string[]}
         */
        const accessCodes = this.getAccessCodesFromScopes('write', user, scope);
        if (accessCodes.includes('*')) {
            return true;
        }
        const oldCodes = new Set(oldAccessCodes);
        const newCodes = new Set(newAccessCodes);
        /**
         * @type {string[]}
         */
        const changedCodes = newAccessCodes.filter(c => !oldCodes.has(c));
        if (!ignoreRemovals) {
            changedCodes.push(...oldAccessCodes.filter(c => !newCodes.has(c)));
        }
        return changedCodes.every(c => accessCodes.includes(c));
    }

    /**
     * Returns true if resource can be accessed with scope
     * @param {Resource} resource
     * @param {string} user
     * @param {string} scope
     * @param {string} accessRequested
     * @return {boolean}
     */
    isAccessToResourceAllowedBySecurityTags ({ resource, user, scope, accessRequested = 'read' }) {
        const accessViaPatientScopes = this.isAccessAllowedByPatientScopes({
            scope, resourceType: resource.resourceType
        });
        if (accessViaPatientScopes) {
            return true; // TODO: should double check here that the resources belong to this patient
        }
        // add any access codes from scopes
        /**
         * @type {string[]}
         */
        const accessCodes = this.getAccessCodesFromScopes(accessRequested, user, scope);
        if (!accessCodes || accessCodes.length === 0) {
            const errorMessage = 'user ' + user + ' with scopes [' + scope + '] has no access scopes';
            throw new ForbiddenError(errorMessage);
        }
        return this.doesResourceHaveAnyAccessCodeFromThisList(accessCodes, resource);
    }

    /**
     * Returns whether the resource has an access tag
     * @param {Resource} resource
     * @return {boolean}
     */
    doesResourceHaveAccessTags (resource) {
        return (
            resource &&
            resource.meta &&
            resource.meta.security &&
            resource.meta.security.some(s => s.system === SecurityTagSystem.access)
        );
    }

    /**
     * Returns whether the resource has an owner tag
     * @param {Resource|Object} resource
     * @return {boolean}
     */
    doesResourceHaveOwnerTags (resource) {
        return (
            resource &&
            resource.meta &&
            resource.meta.security &&
            resource.meta.security.some(s => s.system === SecurityTagSystem.owner)
        );
    }

    /**
     * Returns whether the resource has meta.source
     * @param {Resource} resource
     * @return {boolean}
     */
    doesResourceHaveMetaSource (resource) {
        return (
            resource &&
            resource.meta &&
            resource.meta.source
        );
    }

    /**
     * Returns whether the resource has a sourceAssigningAuthority tag
     * @param {Resource} resource
     * @return {boolean}
     */
    doesResourceHaveSourceAssigningAuthority (resource) {
        return (
            resource &&
            resource.meta &&
            resource.meta.security &&
            resource.meta.security.some(s => s.system === SecurityTagSystem.sourceAssigningAuthority)
        );
    }

    /**
     * Returns whether the resource has multiple owner tag
     * @param {Resource|Object} resource
     * @return {boolean}
     */
    doesResourceHaveMultipleOwnerTags (resource) {
        return (
            resource.meta?.security &&
            resource.meta.security.filter(s => s.system === SecurityTagSystem.owner).length > 1
        );
    }

    /**
     * Returns true if any system or code in the meta.security array is 'null' or empty string
     * @param {Resource|Object} resource
     * @return {boolean}
     */
    doesResourceHaveInvalidMetaSecurity (resource) {
        return (
            resource.meta?.security &&
            resource.meta.security.some(
                s => s.system?.toLowerCase() === 'null' || s.system === '' || s.code?.toLowerCase() === 'null'
            )
        );
    }

    /**
     * Gets admin scopes from the passed in scope string
     * @param {string|undefined} scope
     * @returns {string[]}
     */
    getAdminScopes ({ scope }) {
        if (!scope) {
            return [];
        }
        /**
         * @type {string[]}
         */
        const scopes = scope.split(' ');
        return scopes.filter(s => s.startsWith('admin/'));
    }

    /**
     * Gets patient scopes from the passed in scope string
     * @param {string|undefined} scope
     * @returns {string[]}
     */
    getPatientScopes ({ scope }) {
        if (!scope) {
            return [];
        }
        /**
         * @type {string[]}
         */
        const scopes = scope.split(' ');
        return scopes.filter(s => s.startsWith('patient/'));
    }

    /**
     * Gets user scopes from the passed in scope string
     * @param {string|undefined} scope
     * @returns {string[]}
     */
    getUserScopes ({ scope }) {
        if (!scope) {
            return [];
        }
        /**
         * @type {string[]}
         */
        const scopes = scope.split(' ');
        return scopes.filter(s => s.startsWith('user/'));
    }

    /**
     * Gets scope from request
     * @param {import('http').IncomingMessage} req
     * @return {string|undefined}
     */
    getScopeFromRequest ({ req }) {
        return req.authInfo && req.authInfo.scope;
    }

    /**
     * returns whether the access to this resource with patient scope is allowed and patient scopes are present
     * @typedef {Object} IsAccessAllowedByPatientScopesParams
     * @property {string} scope
     * @property {string} resourceType
     *
     * @param {IsAccessAllowedByPatientScopesParams}
     * @return {boolean}
     */
    isAccessAllowedByPatientScopes ({ scope, resourceType }) {
        assertIsValid(scope, 'Scope is required');
        assertIsValid(resourceType, 'ResourceType is required');

        if (!this.patientFilterManager.canAccessResourceWithPatientScope({ resourceType })) {
            return false;
        }
        const scopes = this.parseScopes(scope);
        if (scopes.some(s => s.includes('patient/'))) {
            return true;
        }
        return false;
    }

    /**
     * returns whether the scope has a patient scope
     * @param {string} scope
     * @return {boolean}
     */
    hasPatientScope ({ scope }) {
        assertIsValid(scope);
        const scopes = this.parseScopes(scope);
        if (scopes.some(s => s.includes('patient/'))) {
            return true;
        }
        return false;
    }
}

module.exports = {
    ScopesManager
};
