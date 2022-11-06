const async = require('async');
const {QueryRewriter} = require('./queryRewriter');
const {assertTypeEquals} = require('../../utils/assertType');
const {DatabaseQueryFactory} = require('../../dataLayer/databaseQueryFactory');

const personProxyPrefix = 'Patient/person.';


class PatientProxyQueryRewriter extends QueryRewriter {
    /**
     * constructor
     * @param {DatabaseQueryFactory} databaseQueryFactory
     */
    constructor(
        {
            databaseQueryFactory
        }
    ) {
        super();

        /**
         * @type {DatabaseQueryFactory}
         */
        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);
    }

    /**
     * rewrites the args
     * @param {string} base_version
     * @param {Object} args
     * @return {Promise<Object>}
     */
    // eslint-disable-next-line no-unused-vars
    async rewriteArgsAsync({base_version, args}) {
        const databaseQueryManager = this.databaseQueryFactory.createQuery({
            resourceType: 'Person',
            base_version: base_version
        });
        for (const [
            /** @type {string} */ argName,
            /** @type {string|string[]} */ argValue
        ] of Object.entries(args)) {
            if (Array.isArray(argValue)) {
                if (argValue.some(a => a.startsWith(personProxyPrefix))) {
                    args[`${argName}`] = await async.mapSeries(
                        argValue,
                        async a => a.startsWith(personProxyPrefix) ? await this.fixPatientProxy(
                            {id: a, databaseQueryManager}) : a
                    );
                }
            } else if (typeof argValue === 'string' && argValue.startsWith(personProxyPrefix)) {
                args[`${argName}`] = await this.fixPatientProxy({
                    id: argValue, databaseQueryManager
                });
            }
        }
        return args;
    }

    /**
     * replaces patient proxy with actual patient ids
     * @param {string} id
     * @param {DatabaseQueryManager} databaseQueryManager
     * @return {Promise<string>}
     */
    async fixPatientProxy({id, databaseQueryManager}) {
        // 1. Get person id from id
        const personId = id.replace(personProxyPrefix, '');
        // 2. Get that Person resource from the database
        /**
         * @type {Person|null}
         */
        const person = await databaseQueryManager.findOneAsync(
            {
                query: {id: personId}
            }
        );
        // 3. Read the patient ids in link property
        if (person && person.link && person.link.length > 0) {
            const patientReferencePrefix = 'Patient/';
            const patientIds = person.link
                .filter(l => l.target.reference.startsWith(patientReferencePrefix))
                .map(l => l.target.reference);
            if (patientIds && patientIds.length > 0) {
                // 4. return a csv of those patient ids
                return patientIds.join(',');
            }
        }
        return id;
    }
}

module.exports = {
    PatientProxyQueryRewriter
};
