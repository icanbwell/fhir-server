const {isTrue} = require('../../utils/isTrue');
const env = require('var');
const {getPatientIdsByPersonIdentifiers} = require('../search/getPatientIdsByPersonIdentifiers');

const getLinkedPatients = async (db, base_version, isUser, fhirPersonId) => {
  if (isTrue(env.ENABLE_PATIENT_FILTERING) && isUser) {
    return getPatientIdsByPersonIdentifiers(db, base_version, fhirPersonId);
  }
  return [];
};

module.exports = {
  getLinkedPatients
};
