const BWELL_PLATFORM_MEMBER_ID_SYSTEM = 'https://icanbwell.com/Bwell_Platform/member_id'
const BWELL_FHIR_MEMBER_ID_SYSTEM = 'https://www.icanbwell.com/member_id'

const getPatientIdsByPersonIdentifiers = async (db, base_version, fhirPersonId, personSystem=BWELL_FHIR_MEMBER_ID_SYSTEM, patientSystem=BWELL_FHIR_MEMBER_ID_SYSTEM) => {
  let memberId;
  if (fhirPersonId) {
    let person = db.collection(`Person_${base_version}`).findOne({id: fhirPersonId})
    memberId = person.identifier.filter(identifier => identifier.system === personSystem)
    let patients = db.collection(`Patient_${base_version}`).find(
      {identifier: {$elemMatch: {"system": patientSystem, "value": memberId}}}
    )
  }
  return (await patients.toArray()).map(p => p.id)
}

module.exports = {
  getPatientIdsByPersonIdentifiers
}
