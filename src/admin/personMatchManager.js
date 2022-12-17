const {assertTypeEquals} = require('../utils/assertType');
const {DatabaseQueryFactory} = require('../dataLayer/databaseQueryFactory');

class PersonMatchManager {
    /**
     *
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
            // post to $match service
        }
    }
}

module.exports = {
    PersonMatchManager
};
