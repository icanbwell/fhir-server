/* eslint-disable security/detect-object-injection */
const { PERSON_PROXY_PREFIX } = require('../constants');
const { DatabaseQueryFactory } = require('../dataLayer/databaseQueryFactory');
const { assertTypeEquals } = require('./assertType');
const { BwellPersonFinder } = require('./bwellPersonFinder');
const { PersonToPatientIdsExpander } = require('./personToPatientIdsExpander');

const patientReferencePrefix = 'Patient/';
const personReferencePrefix = 'Person/';

/**
 * Linked Patient Finder utility class
 */
class LinkedPatientsFinder {
    /**
     * @typedef {Object} LinkedPatientsFinderConstructionParams
     * @property {DatabaseQueryFactory} databaseQueryFactory
     * @property {BwellPersonFinder} bwellPersonFinder
     * @property {PersonToPatientIdsExpander} personToPatientIdsExpander
     *
     * @param {LinkedPatientsFinderConstructionParams} params
     */
    constructor({
        databaseQueryFactory,
        bwellPersonFinder,
        personToPatientIdsExpander,
    }) {
        /**
         * @type {DatabaseQueryFactory}
         */
        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);

        /**
         * @type {BwellPersonFinder}
         */
        this.bwellPersonFinder = bwellPersonFinder;
        assertTypeEquals(bwellPersonFinder, BwellPersonFinder);

        /**
         * @type {PersonToPatientIdsExpander}
         */
        this.personToPatientIdsExpander = personToPatientIdsExpander;
        assertTypeEquals(
            personToPatientIdsExpander,
            PersonToPatientIdsExpander,
        );
    }

    /**
     * Get bwell master person and all linked patients for given patient ids.
     * @typedef {Object} GetPersonAndBwellPersonOptions - Function Options
     * @property {import('../operations/query/filters/searchFilterFromReference').IReferences} patientReferences - Array of references
     * @param {GetPersonAndBwellPersonOptions} options
     * @returns {{[patientId: string]: { bwellMasterPerson: string, patientIds: string[] }}}
     */
    async getBwellPersonAndAllClientIds({ patientReferences }) {
        // get hash-map of patientId to bwell-person
        const patientToBwellMasterPerson =
            await this.bwellPersonFinder.getBwellPersonIdsAsync({
                patientReferences,
            });

        /**@type {Set<string>} */
        const bwellMasterPersons = new Set();

        patientToBwellMasterPerson.forEach((masterPerson) => {
            bwellMasterPersons.add(masterPerson);
        });

        // get all linked patient ids
        /**
         * @type {{[masterPersonId: string]: string[];}}
         * */
        const linkedPatientIds =
            await this.personToPatientIdsExpander.getAllRelatedPatients({
                base_version: '4_0_0',
                idsSet: bwellMasterPersons,
                toMap: true,
            });

        /**
         * @type {{[patientId: string]: { bwellMasterPerson: string, patientIds: string[] }}}
         * */
        const patientToBwellPersonAndClientIds = {};

        // form the result to return
        for (const [
            patientReference,
            bwellPersonReference,
        ] of patientToBwellMasterPerson.entries()) {
            const patientId = patientReference.replace(
                patientReferencePrefix,
                '',
            );
            const data = patientToBwellPersonAndClientIds[patientId] || {};
            data.bwellMasterPerson = bwellPersonReference.replace(
                personReferencePrefix,
                '',
            );
            data.patientIds = [
                ...linkedPatientIds[data.bwellMasterPerson],
                `${PERSON_PROXY_PREFIX}${data.bwellMasterPerson}`,
            ];
            // also add bwell-mater-person proxy
            patientToBwellPersonAndClientIds[patientId] = data;
        }

        return patientToBwellPersonAndClientIds;
    }
}

module.exports = {
    LinkedPatientsFinder,
};
