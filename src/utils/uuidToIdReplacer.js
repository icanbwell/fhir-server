const {assertTypeEquals, assertIsValid} = require('./assertType');
const {DatabaseQueryFactory} = require('../dataLayer/databaseQueryFactory');
const {VERSIONS} = require('../middleware/fhir/utils/constants');

/**
 * @classdesc Takes a uuid and calls database to get the corresponding id and securityTagStructure
 */
class UuidToIdReplacer {
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
     * @param {string} uuid
     * @return {Promise<{id: string, securityTagStructure: SecurityTagStructure}|null>}
     */
    async getIdAndSourceAssigningAuthorityForUuidAsync({resourceType, uuid}) {
        assertIsValid(resourceType, 'resourceType is null');
        /**
         * @type {DatabaseQueryManager}
         */
        const databaseQueryManager = this.databaseQueryFactory.createQuery({
            resourceType,
            base_version: VERSIONS['4_0_0']
        });
        /**
         * @type {{id: string, securityTagStructure: SecurityTagStructure}|null}
         */
        const result = await databaseQueryManager.getIdAndSourceAssigningAuthorityForUuidAsync(
            {
                uuid
            }
        );
        return result;
    }
}

module.exports = {
    UuidToIdReplacer
};
