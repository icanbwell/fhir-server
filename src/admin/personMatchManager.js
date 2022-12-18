const {assertTypeEquals, assertIsValid} = require('../utils/assertType');
const {DatabaseQueryFactory} = require('../dataLayer/databaseQueryFactory');
const superagent = require('superagent');
const {ConfigManager} = require('../utils/configManager');

class PersonMatchManager {
    /**
     *
     * @param {DatabaseQueryFactory} databaseQueryFactory
     * @param {ConfigManager} configManager
     */
    constructor(
        {
            databaseQueryFactory,
            configManager
        }
    ) {
        /**
         * @type {DatabaseQueryFactory}
         */
        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);

        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
    }

    /**
     * matches persons
     * @param {string} sourceId
     * @param {string} targetId
     * @return {Promise<void>}
     */
    async personMatchAsync(
        {
            sourceId,
            targetId
        }
    ) {
        // get FHIR records for each
        // if (!(sourceId.includes('/'))) {
        //     sourceId = `Patient/${sourceId}`;
        // }
        // if (!(targetId.includes('/'))) {
        //     targetId = `Patient/${targetId}`;
        // }
        //
        const databaseQueryManager = this.databaseQueryFactory.createQuery({
            resourceType: 'Patient',
            base_version: '4_0_0'
        });

        const source = await databaseQueryManager.findOneAsync({
            query: {id: sourceId}
        });
        const target = await databaseQueryManager.findOneAsync({
            query: {id: targetId}
        });
        if (source && target) {
            // eslint-disable-next-line no-unused-vars
            const parameters = {
                'resourceType': 'Parameters',
                'resource': source.toJSON(),
                'match': target.toJSON()
            };

            const url = this.configManager.personMatchingServiceUrl;
            assertIsValid(url);
            // post to $match service
            const header = {
                'Content-Type': 'application/json',
                Accept: 'application/json',
            };
            console.log(JSON.stringify(parameters));
            /**
             * @type {request.Response}
             */
            const res = await superagent
                .post(url)
                .send(parameters)
                .set(header
                );
            const json = res.body;
            console.log(JSON.stringify(json));
            return json;
        }
    }
}

module.exports = {
    PersonMatchManager
};
