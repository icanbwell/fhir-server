const { AUTH_USER_TYPES, CMS_NETWORK_TENANT_ORGANIZATION_TYPE } = require('../constants');
const { DatabaseQueryFactory } = require('../dataLayer/databaseQueryFactory');
const { ScopesManager } = require('../operations/security/scopesManager');
const { ForbiddenError } = require('./httpErrors');
const { assertTypeEquals } = require('./assertType');
const { isUuid } = require('./uid.util');

class UserTypeManager {
    /**
     * @param {DatabaseQueryFactory} databaseQueryFactory
     * @param {ScopesManager} scopesManager
     */
    constructor({ databaseQueryFactory, scopesManager }) {
        /**
         * @type {DatabaseQueryFactory}
         */
        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);

        /**
         * @type {ScopesManager}
         */
        this.scopesManager = scopesManager;
        assertTypeEquals(scopesManager, ScopesManager);
    }

    /**
     * Resolves userType by fetching the Organization resource and checking its type.
     * Verifies the user has access to the Organization before checking its type.
     * @param {Object} params
     * @param {string|undefined} params.managingOrganizationId
     * @param {string} params.scope - JWT scope string
     * @param {string} params.user - authenticated user identifier
     * @returns {Promise<string|undefined>}
     */
    async resolveUserTypeAsync({ managingOrganizationId, scope, user }) {
        const databaseQueryManager = this.databaseQueryFactory.createQuery({
            resourceType: 'Organization',
            base_version: '4_0_0'
        });
        const organization = await databaseQueryManager.findOneAsync({
            query: { [isUuid(managingOrganizationId) ? '_uuid' : '_sourceId']: managingOrganizationId }
        });
        if (!organization) {
            throw new ForbiddenError(`Organization with id ${managingOrganizationId} not found while resolving user type`);
        }

        if (!this.scopesManager.isAccessToResourceAllowedBySecurityTags({ resource: organization, user, scope })) {
            throw new ForbiddenError(`User ${user} is not authorized to reference Organization ${managingOrganizationId}`);
        }

        if (Array.isArray(organization.type)) {
            for (const type of organization.type) {
                if (!Array.isArray(type.coding)) {
                    continue;
                }
                for (const coding of type.coding) {
                    if (coding.code === CMS_NETWORK_TENANT_ORGANIZATION_TYPE) {
                        return AUTH_USER_TYPES.cmsPartnerUser;
                    }
                }
            }
        }
        return undefined;
    }
}

module.exports = { UserTypeManager };
