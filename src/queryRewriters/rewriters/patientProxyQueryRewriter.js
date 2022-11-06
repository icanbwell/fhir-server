const async = require('async');
const {QueryRewriter} = require('./queryRewriter');
const {assertTypeEquals, assertIsValid} = require('../../utils/assertType');
const {DatabaseQueryFactory} = require('../../dataLayer/databaseQueryFactory');

const patientReferencePrefix = 'Patient/';
const personReferencePrefix = 'Person/';
const personProxyPrefix = 'person.';
const patientReferencePlusPersonProxyPrefix = `${patientReferencePrefix}${personProxyPrefix}`;


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
     * @param {string} resourceType
     * @return {Promise<Object>}
     */
    // eslint-disable-next-line no-unused-vars
    async rewriteArgsAsync({base_version, args, resourceType}) {
        assertIsValid(resourceType);
        assertIsValid(base_version);
        const databaseQueryManager = this.databaseQueryFactory.createQuery({
            resourceType: 'Person',
            base_version: base_version
        });
        for (const [
            /** @type {string} */ argName,
            /** @type {string|string[]} */ argValue
        ] of Object.entries(args)) {
            if (resourceType === 'Patient') {
                if (argName === 'id') {
                    if (Array.isArray(argValue)) {
                        if (argValue.some(a => a.startsWith(personProxyPrefix))) {
                            args[`${argName}`] = await async.mapSeries(
                                argValue,
                                async a => a.startsWith(personProxyPrefix) ? await this.getPatientProxyIds(
                                    {
                                        id: a, databaseQueryManager, includePatientPrefix: false
                                    }) : a
                            );
                        }
                    } else if (typeof argValue === 'string' && argValue.startsWith(personProxyPrefix)) {
                        args[`${argName}`] = await this.getPatientProxyIds({
                            id: argValue, databaseQueryManager, includePatientPrefix: false
                        });
                    }
                }
            } else { // resourceType other than Patient
                if (Array.isArray(argValue)) {
                    if (argValue.some(a => a.startsWith(patientReferencePlusPersonProxyPrefix))) {
                        // replace with patient ids from person
                        args[`${argName}`] = await async.mapSeries(
                            argValue,
                            async a => a.startsWith(patientReferencePlusPersonProxyPrefix) ? await this.getPatientProxyIds(
                                {
                                    id: a, databaseQueryManager, includePatientPrefix: true
                                }) : a
                        );
                    }
                } else if (typeof argValue === 'string' && argValue.startsWith(patientReferencePlusPersonProxyPrefix)) {
                    args[`${argName}`] = await this.getPatientProxyIds({
                        id: argValue, databaseQueryManager, includePatientPrefix: true
                    });
                }
            }
        }

        return args;
    }

    /**
     * replaces patient proxy with actual patient ids
     * @param {string} id
     * @param {DatabaseQueryManager} databaseQueryManager
     * @param {boolean} includePatientPrefix
     * @return {Promise<string>}
     */
    async getPatientProxyIds({id, databaseQueryManager, includePatientPrefix}) {
        // 1. Get person id from id
        const personId = id.replace(patientReferencePlusPersonProxyPrefix, '').replace(personProxyPrefix, '');
        // 2. Get that Person resource from the database
        let patientIds = await this.getPatientIdsFromPersonAsync(
            {
                personId,
                databaseQueryManager
            }
        );
        if (patientIds && patientIds.length > 0) {
            if (includePatientPrefix) {
                patientIds = patientIds.map(p => `${patientReferencePrefix}${p}`);
            }
            // 4. return a csv of those patient ids (remove duplicates)
            return Array.from(new Set(patientIds)).join(',');
        }
        return id;
    }

    /**
     * gets patient ids (recursive) from a person
     * @param {string} personId
     * @param {DatabaseQueryManager} databaseQueryManager
     * @return {Promise<string[]>}
     */
    async getPatientIdsFromPersonAsync({personId, databaseQueryManager}) {
        /**
         * @type {Person|null}
         */
        const person = await databaseQueryManager.findOneAsync(
            {
                query: {id: personId}
            }
        );
        /**
         * @type {string[]}
         */
        let patientIds = [];
        if (person && person.link && person.link.length > 0) {
            const patientIdsToAdd = person.link
                .filter(l => l.target.reference.startsWith(patientReferencePrefix))
                .map(l => l.target.reference.replace(patientReferencePrefix, ''));
            patientIds = patientIds.concat(patientIdsToAdd);
            // now find any Person links and call them recursively
            const personIdsToRecurse = person.link
                .filter(l => l.target.reference.startsWith(personReferencePrefix))
                .map(l => l.target.reference.replace(personReferencePrefix, ''));
            /**
             * @type {string[]}
             */
            const patientIdsFromPersons = await async.flatMapSeries(
                personIdsToRecurse,
                async i => await this.getPatientIdsFromPersonAsync({
                        personId: i,
                        databaseQueryManager
                    }
                )
            );
            patientIds = patientIds.concat(patientIdsFromPersons);
        }

        return patientIds;
    }
}

module.exports = {
    PatientProxyQueryRewriter
};
