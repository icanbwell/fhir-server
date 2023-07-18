/* eslint-disable security/detect-object-injection */
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
      assertTypeEquals(personToPatientIdsExpander, PersonToPatientIdsExpander);
    }

    /**
     * Get bwell master person and all linked patients for given patient ids.
     * @typedef {Object} GetPersonAndBwellPersonOptions - Function Options
     * @property {string[]} patientIds - array of patient ids
     * @param {GetPersonAndBwellPersonOptions} options
     * @returns {{[patientId: string]: { bwellMasterPerson: string, clientPatientIds: string[] }}}
     */
    async getBwellPersonAndAllClientIds({patientIds}) {
        // if prefix then remove it
        const patientIdWithOutPrefix = patientIds.map((patientId) => patientId.replace(patientReferencePrefix, ''));
        // get hash-map of patientId to bwell-person
        const patientToBwellMasterPerson = await this.bwellPersonFinder.getBwellPersonIdsAsync({
            patientIds: patientIdWithOutPrefix,
        });

        /**
         * @type {{[patientId: string]: { bwellMasterPerson: string, clientPatientIds: string[] }}}
         * */
        const patientToBwellPersonAndClientIds = {};

        for (const [patientReference, bwellPersonReference] of patientToBwellMasterPerson.entries()) {
            const patientId = patientReference.replace(patientReferencePrefix, '');
            const data = patientToBwellPersonAndClientIds[patientId] || {};
            data.bwellMasterPerson = bwellPersonReference.replace(personReferencePrefix, '');
            patientToBwellPersonAndClientIds[patientId] = data;
        }
        // TODO: implement code for getting all client Ids.
        return patientToBwellPersonAndClientIds;
    }
}

module.exports = {
  LinkedPatientsFinder
};
