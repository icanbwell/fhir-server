const BWELL_PLATFORM_MEMBER_ID_SYSTEM = 'https://icanbwell.com/Bwell_Platform/member_id';
const BWELL_FHIR_MEMBER_ID_SYSTEM = 'https://www.icanbwell.com/member_id';
const idProjection = {id: 1, _id: 0};

// eslint-disable-next-line no-unused-vars
const getPatientIdsByPersonIdentifiers = async (db, base_version, fhirPersonId, personSystem = BWELL_FHIR_MEMBER_ID_SYSTEM, patientSystem = BWELL_PLATFORM_MEMBER_ID_SYSTEM) => {
    let result = [];
    if (fhirPersonId) {
        let person = await db.collection(`Person_${base_version}`).findOne({id: fhirPersonId});
        // Finds Patients by platform member ids and returns an array with the found patient ids
        if (person.identifier && person.identifier.length > 0) {
            let memberId = person.identifier.filter(identifier => {
                return identifier.type.coding.some(coding => {
                        return coding.system === 'https://www.icanbwell.com' && coding.code === 'member_id';
                    }
                );
            });
            let patients = db.collection(`Patient_${base_version}`).find(
                {identifier: {$elemMatch: {'system': patientSystem, 'value': {$in: memberId.map(id => id.value)}}}},
            ).project(idProjection);
            let found = await patients.toArray();
            result = found.map(p => p.id);
        }
    }
    return result;
};

module.exports = {
    getPatientIdsByPersonIdentifiers
};
