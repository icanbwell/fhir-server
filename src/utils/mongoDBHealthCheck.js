/**
 * helper method to check health of mongoDB connection
 */

const { VERSIONS } = require('../middleware/fhir/utils/constants');

    /**
     * Makes a simple DB query to validate mongoDB connection
     * @param container
     * @return {Promise<boolean>}
     */
module.exports.handleHealthCheckQuery = async (container) => {
    let healthy = true;
    try {
        /**
         * @type {DatabaseQueryManager}
         */
        const databaseQueryFactory = container.databaseQueryFactory;
        const databaseQueryManager = databaseQueryFactory.createQuery({
            resourceType: 'Patient',
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
};
