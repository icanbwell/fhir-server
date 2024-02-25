const { assertIsValid, assertTypeEquals } = require('../../utils/assertType');
const { RethrownError } = require('../../utils/rethrownError');
const { DatabaseQueryFactory } = require('../../dataLayer/databaseQueryFactory');
const { PersonToPatientIdsExpander } = require('../../utils/personToPatientIdsExpander');
const { ScopesManager } = require('../security/scopesManager');

class PatientScopeManager {
        /**
     * constructor
     * @param {DatabaseQueryFactory} databaseQueryFactory
     * @param {PersonToPatientIdsExpander} personToPatientIdsExpander
     * @param {ScopesManager} scopesManager
     */
    constructor (
        {
            databaseQueryFactory,
            personToPatientIdsExpander,
            scopesManager
        }
    ) {
        /**
         * @type {DatabaseQueryFactory}
         */
        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);

        /**
         * @type {PersonToPatientIdsExpander}
         */
        this.personToPatientIdsExpander = personToPatientIdsExpander;
        assertTypeEquals(personToPatientIdsExpander, PersonToPatientIdsExpander);

        /**
         * @type {ScopesManager}
         */
        this.scopesManager = scopesManager;
        assertTypeEquals(scopesManager, ScopesManager);
    }

    /**
     * Gets linked patients
     * @param {string} base_version
     * @param {boolean | null} isUser
     * @param {string} personIdFromJwtToken
     * @return {Promise<string[]>}
     */
    async getLinkedPatientsAsync (
        {
            base_version, isUser, personIdFromJwtToken
        }
    ) {
        try {
            if (isUser && personIdFromJwtToken) {
                return await this.getPatientIdsByPersonIdAsync(
                    {
                        base_version, personIdFromJwtToken
                    });
            }
            return [];
        } catch (e) {
            throw new RethrownError({
                message: `Error get linked patients for person id: ${personIdFromJwtToken}`,
                error: e
            });
        }
    }

        /**
     * Gets Patient id from identifiers
     * @param {string} base_version
     * @param {string} personIdFromJwtToken
     * @return {Promise<string[]>}
     */
    async getPatientIdsByPersonIdAsync (
        {
            base_version,
            personIdFromJwtToken
        }
    ) {
        assertIsValid(base_version);
        assertIsValid(personIdFromJwtToken);
        try {
            const databaseQueryManager = this.databaseQueryFactory.createQuery({
                resourceType: 'Person',
                base_version
            });
            return await this.personToPatientIdsExpander.getPatientIdsFromPersonAsync({
                databaseQueryManager,
                personIds: [personIdFromJwtToken],
                totalProcessedPersonIds: new Set(),
                level: 1
            });
        } catch (e) {
            throw new RethrownError({
                message: `Error getting patient id for person id: ${personIdFromJwtToken}`,
                error: e
            });
        }
    }

    /**
     *
     * @param {string} base_version
     * @param {boolean | null} isUser
     * @param {string} personIdFromJwtToken
     * @param {string[] | null} patientIdsFromJwtToken
     * @returns {Promise<string[]|null>}
     */
    async getPatientIdsFromScope ({ base_version, isUser, personIdFromJwtToken, patientIdsFromJwtToken }) {
        /**
         * @type {string[]}
         */
        const patientIdsLinkedToPersonId = personIdFromJwtToken
            ? await this.getLinkedPatientsAsync(
                {
                    base_version, isUser, personIdFromJwtToken
                })
            : [];
        /**
         * @type {string[]|null}
         */
        const allPatientIdsFromJwtToken = patientIdsFromJwtToken
            ? patientIdsFromJwtToken.concat(patientIdsLinkedToPersonId)
            : patientIdsLinkedToPersonId;

        return allPatientIdsFromJwtToken;
    }
}

module.exports = {
    PatientScopeManager
};
