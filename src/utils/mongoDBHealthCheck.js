/**
 * helper class to check health of mongoDB connection
 */

const {assertTypeEquals} = require('./assertType');
const {DatabaseQueryFactory} = require('../dataLayer/databaseQueryFactory');
const {VERSIONS} = require('../middleware/fhir/utils/constants');

/**
 * @classdesc Takes a uuid and calls database to get the corresponding id and securityTagStructure
 */
class MongoDBHealthCheck {
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
     * Makes a simple DB query to validate mongoDB connection
     * @return {Promise<boolean>
     */
    async healthCheckQuery() {
        let healthy = true;
        try {
            /**
             * @type {DatabaseQueryManager}
             */
            const databaseQueryManager = this.databaseQueryFactory.createQuery({
                resourceType: 'Person',
                base_version: VERSIONS['4_0_0']
            });
            /**
             * @type {{id: string, securityTagStructure: SecurityTagStructure}|null}
             */
            await databaseQueryManager.findOneAsync({
                query: {}
            });
        } catch (e) {
            healthy = false;
        }
        return healthy;
    }
}

module.exports = {
    MongoDBHealthCheck
};
