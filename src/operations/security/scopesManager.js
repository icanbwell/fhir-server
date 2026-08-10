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
            if (scope1.startsWith('access/')) {
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

        // A resource can carry multiple access tags at once, and if access tag matching the scopes
        // is present in resource, the client gets access to resource irrespective of presence of another
        // access tag
        const hasAccessCode = accessCodes.some(c => accessCodesFromAccessTag.includes(c));

        return hasOwnerCode && hasAccessCode;
    }

    /**
     * Returns the codes of all access tags (system=access) present on the resource. Tolerant of a
     * null/undefined resource or a resource with no meta/security.
     * @param {Resource|Object|null|undefined} resource
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
     * A resource can legitimately carry access tags for multiple tenants at once, but the write check on
     * the resource itself (doesNotHaveAnyAccessCodeFromThisList) only requires that *one* access tag
     * matches the caller's scopes. Without this additional check, a caller authorized to write to a
     * resource via one access tag could add an access tag for a tenant it has no access to (silently
     * sharing the resource with that tenant), or remove an access tag for a tenant that was entitled to
     * it (silently revoking that tenant's access) - neither of which is ever validated against that other
     * tenant's own authorization. So unless the caller holds the '*' access code, every access code it
     * adds or removes must be one it is itself authorized for via its own write access codes.
     *
     * @typedef {Object} IsAccessTagChangeAllowedByScopesParams
     * @property {string[]} oldAccessCodes access codes on the resource as currently stored (empty for a create)
     * @property {string[]} newAccessCodes access codes on the resource as it will be stored
     * @property {string} resourceType
     * @property {string} user
     * @property {string} scope
     * @property {boolean} [isCreate] true when there is no existing stored resource (oldAccessCodes
     *   reflects "doesn't exist yet", not "exists with no tags"). Patient-scoped callers hold no
     *   access/ scope to compare against by design, so on a create there is no pre-existing tenant's
     *   visibility to silently grant/revoke - the initial tags are only as trustworthy as the write
     *   itself, which patientScopeManager.canWriteResourceAsync independently gates on identity-graph
     *   ownership. That reasoning does NOT extend to a write against an EXISTING resource: changing
     *   its tags there always either grants or revokes some tenant's visibility of data that already
     *   existed, so it must still go through the change-comparison below like any other caller.
     * @property {boolean} [ignoreRemovals] set when the calling write path can only ever append access
     *   tags (e.g. a smart-merge, which appends to arrays rather than replacing them), so a code missing
     *   from newAccessCodes reflects it not being repeated in the incoming body rather than an intentional
     *   removal
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
        isCreate = false,
        ignoreRemovals = false
    }) {
        // a patient scoped caller is authorized via the patient/person the resource belongs to, not via
        // access codes - it holds no access scopes to compare against, so defer to the patient scope
        // checks. Only safe on a create (see isCreate doc above) - an existing resource's tags must
        // still go through the change-comparison below.
        if (isCreate && this.isAccessAllowedByPatientScopes({ scope, resourceType })) {
            return true;
        }
        /**
         * @type {string[]}
         */
        const accessCodes = this.getAccessCodesFromScopes('write', user, scope);
        if (accessCodes.includes('*')) {
            // no security check since user has full write access to everything
            return true;
        }
        const oldCodesSet = new Set(oldAccessCodes || []);
        const newCodesSet = new Set(newAccessCodes || []);
        /**
         * @type {string[]}
         */
        const addedCodes = (newAccessCodes || []).filter(c => !oldCodesSet.has(c));
        /**
         * @type {string[]}
         */
        const removedCodes = ignoreRemovals
            ? []
            : (oldAccessCodes || []).filter(c => !newCodesSet.has(c));
        const changedCodes = [...addedCodes, ...removedCodes];
        return changedCodes.every(c => accessCodes.includes(c));
    }

    /**
     * Checks whether the resource has any access code (ignoring the owner tag) that is in the
     * passed in accessCodes list. Use for resource types whose owner tag is intentionally fixed
     * to a platform-level value regardless of tenant (e.g. ExportStatus is always owned by
     * 'bwell'), where tenant isolation is enforced solely via the access tag.
     * @param {string[]} accessCodes
     * @param {Resource} resource
     * @return {boolean}
     */
    doesResourceHaveAnyAccessCodeInAccessTag (accessCodes, resource) {
        if (!accessCodes || accessCodes.length === 0) {
            return false;
        }

        if (accessCodes.includes('*')) {
            return true;
        }

        if (!resource.meta || !resource.meta.security) {
            return false;
        }

        const accessCodesFromAccessTag = resource.meta.security
            .filter(s => s.system === SecurityTagSystem.access)
            .map(s => s.code);

        return accessCodes.some(c => accessCodesFromAccessTag.includes(c));
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
            // Patient scope tokens in this system never carry an access/ scope of their
            // own (that's the separate tenant/service-account mechanism), so requiring a
            // tenant-tag match here would deny every legitimate patient-scoped write. The
            // "does this resource actually belong to this patient" check the old TODO asked
            // for is already enforced independently by patientScopeManager.canWriteResourceAsync
            // (Person/Patient-id matching), which every write path ANDs with this check via
            // scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes.
            return true;
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
     * Returns true if resource can be accessed with scope, checking only the access tag and
     * ignoring the owner tag. Use for resource types whose owner tag is intentionally fixed to a
     * platform-level value regardless of tenant (e.g. ExportStatus).
     * @param {Resource} resource
     * @param {string} user
     * @param {string} scope
     * @param {string} accessRequested
     * @return {boolean}
     */
    isAccessToResourceAllowedByAccessTagOnly ({ resource, user, scope, accessRequested = 'read' }) {
        /**
         * @type {string[]}
         */
        const accessCodes = this.getAccessCodesFromScopes(accessRequested, user, scope);
        if (!accessCodes || accessCodes.length === 0) {
            const errorMessage = 'user ' + user + ' with scopes [' + scope + '] has no access scopes';
            throw new ForbiddenError(errorMessage);
        }
        return this.doesResourceHaveAnyAccessCodeInAccessTag(accessCodes, resource);
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
     * Returns whether scope contains an admin/ scope whose action segment is the given action or
     * the wildcard '*'. getAdminScopes() alone (used to gate admin routes generally) never looks
     * at the action segment, so an admin/*.read-only caller passes that check identically to one
     * holding admin/*.write.
     * @param {string|undefined} scope
     * @param {'read'|'write'} action
     * @return {boolean}
     */
    hasAdminScopeForAction ({ scope, action }) {
        return this.getAdminScopes({ scope }).some((adminScope) => {
            const scopeAction = adminScope.split('.')[1];
            return scopeAction === '*' || scopeAction === action;
        });
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

    /**
     * Whether the given scope may read a resource's history (_history,
     * _history/{id}, or a specific _history/{vid}).
     *
     * A historical version keeps the access tags it had at write time, so a
     * tenant-scoped access code can still match a stale, no-longer-current
     * tag on an old version after the current version's tags have been
     * narrowed away from that tenant (SEC-1580 SAE-1). Rather than
     * re-evaluating each version against the resource's current tags,
     * history access requires a non-tenant-specific access scope
     * (access/*.read or access/*.*) -- a tenant-scoped access code is never
     * sufficient, even for that tenant's own record.
     * @typedef {Object} HasHistoryAccessParams
     * @property {string} resourceType
     * @property {string} scope
     *
     * @param {HasHistoryAccessParams}
     * @return {boolean}
     */
    hasHistoryAccess ({ resourceType, scope }) {
        assertIsValid(resourceType, 'resourceType is required');

        const accessCodes = this.getAccessCodesFromScopes('read', '', scope);
        return accessCodes.includes('*');
    }
}

module.exports = {
    ScopesManager
};
