const { AUTH_USER_TYPES } = require('../constants');
const { DatabaseQueryFactory } = require('../dataLayer/databaseQueryFactory');
const { ForbiddenError } = require('./httpErrors');
const { assertTypeEquals } = require('./assertType');

class UserTypeManager {
    /**
     * @param {DatabaseQueryFactory} databaseQueryFactory
     */
    constructor({ databaseQueryFactory }) {
        /**
         * @type {DatabaseQueryFactory}
         */
        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);
    }

    /**
     * Resolves userType by fetching the Organization resource and checking its type.
     * @param {Object} params
     * @param {string|undefined} params.managingOrganizationId
     * @returns {Promise<string|undefined>}
     */
    async resolveUserTypeAsync({ managingOrganizationId }) {
        const databaseQueryManager = this.databaseQueryFactory.createQuery({
            resourceType: 'Organization',
            base_version: '4_0_0'
        });
        const organization = await databaseQueryManager.findOneAsync({
            query: {_uuid: managingOrganizationId }
        });
        if (!organization) {
            throw new ForbiddenError(`Organization with id ${managingOrganizationId} not found while resolving user type`);
        }

        if (Array.isArray(organization.type)) {
            for (const type of organization.type) {
                if (!Array.isArray(type.coding)) {
                    continue;
                }
                for (const coding of type.coding) {
                    if (coding.code === process.env.CMS_NETWORK_TENANT_ORGANIZATION_TYPE) {
                        return AUTH_USER_TYPES.cmsPartnerUser;
                    }
                }
            }
        }
        return undefined;
    }
}

module.exports = { UserTypeManager };
