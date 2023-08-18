/* eslint-disable security/detect-object-injection */
const { PERSON_PROXY_PREFIX, PATIENT_REFERENCE_PREFIX, PERSON_REFERENCE_PREFIX } = require('../constants');
const { DatabaseQueryFactory } = require('../dataLayer/databaseQueryFactory');
const { assertTypeEquals } = require('./assertType');
const { BwellPersonFinder } = require('./bwellPersonFinder');
const { PersonToPatientIdsExpander } = require('./personToPatientIdsExpander');

const patientReferencePrefix = PATIENT_REFERENCE_PREFIX;
const personReferencePrefix = PERSON_REFERENCE_PREFIX;

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
     * If onlyBwellPerson is passed as true, then returns map of patientId -> bwellPersonUuid.
     * Note that this patientId is actually id|sourceAssigningAuthority is sourceAssigningAuthority is present in passed references
     * @typedef {Object} GetPersonAndBwellPersonOptions - Function Options
     * @property {import('../operations/query/filters/searchFilterFromReference').IReferences} patientReferences - Array of references
     * @property {boolean} onlyBwellPerson Pass this true when you require only patient -> bwellPerson map. By default its false
     * @param {GetPersonAndBwellPersonOptions} options
     * @returns {{[patientId: string]: { bwellMasterPerson: string, patientIds: string[] }} | {[patientId: string]: string}}
     */
    async getBwellPersonAndAllClientIds({ patientReferences, onlyBwellPerson = false }) {
        // get hash-map of patientId to bwell-person
        const patientToBwellMasterPerson =
            await this.bwellPersonFinder.getBwellPersonIdsAsync({
                patientReferences,
            });

        if (onlyBwellPerson) {
            // convert to patientReference -> bwellPersonUuid
            const patientReferenceToMasterPersonUuid = {};
            for (const [patientReference, bwellPerson] of patientToBwellMasterPerson.entries()) {
                // reference without Patient prefix
                const patientId = patientReference.replace(
                    patientReferencePrefix,
                    '',
                );
                // remove Person/ prefix
                patientReferenceToMasterPersonUuid[`${patientId}`] = bwellPerson.replace(personReferencePrefix, '');
            }
            return patientReferenceToMasterPersonUuid;
        }

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
