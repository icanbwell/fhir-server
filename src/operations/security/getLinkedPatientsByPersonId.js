const {isTrue} = require('../../utils/isTrue');
const env = require('var');
const {getPatientIdsByPersonIdentifiersAsync} = require('../search/getPatientIdsByPersonIdentifiers');


/**
 * Gets linked patients
 * @param {MongoCollectionManager} collectionManager
 * @param {string} base_version
 * @param {boolean} useAtlas
 * @param {boolean | null} isUser
 * @param {string} fhirPersonId
 * @return {Promise<string[]>}
 */
const getLinkedPatientsAsync = async (collectionManager, base_version, useAtlas, isUser, fhirPersonId) => {
  if (isTrue(env.ENABLE_PATIENT_FILTERING) && isUser) {
    return await getPatientIdsByPersonIdentifiersAsync(collectionManager, base_version, useAtlas, fhirPersonId);
  }
  return [];
};

module.exports = {
  getLinkedPatientsAsync
};
