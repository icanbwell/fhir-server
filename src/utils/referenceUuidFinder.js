const {assertTypeEquals, assertIsValid} = require('./assertType');
const {DatabaseQueryFactory} = require('../dataLayer/databaseQueryFactory');
const {VERSIONS} = require('../middleware/fhir/utils/constants');

/**
 * @classdesc Takes a uuid and calls database to get the corresponding id and securityTagStructure
 */
class ReferenceUuidFinder {
    /**
     * constructor
     * @param {DatabaseQueryFactory} databaseQueryFactory
     */
    constructor(
        {
            databaseQueryFactory
        }
    ) {
        /**
         * @type {DatabaseQueryFactory}
         */
        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);
    }

    /**
     * Takes a uuid and calls database to get the corresponding id and securityTagStructure
     * @param {string} resourceType
     * @param {string} sourceId
     * @param {string} sourceAssigningAuthority
     * @return {Promise<{uuid: string|null>}
     */
    async getUuidForSourceIdAndSourceAssigningAuthorityAsync({resourceType, sourceId, sourceAssigningAuthority}) {
        assertIsValid(resourceType, 'resourceType is null');
        /**
         * @type {DatabaseQueryManager}
         */
        const databaseQueryManager = this.databaseQueryFactory.createQuery({
            resourceType,
            base_version: VERSIONS['4_0_0']
        });
        /**
         * @type {{uuid: string}
         */
        const result = await databaseQueryManager.getUuidForSourceIdAndSourceAssigningAuthorityAsync(
            {
                sourceId,
                sourceAssigningAuthority
            }
        );
        return result;
    }
}

module.exports = {
    ReferenceUuidFinder
};
