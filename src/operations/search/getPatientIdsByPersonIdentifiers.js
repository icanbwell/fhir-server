const {getOrCreateCollectionForResourceTypeAsync} = require('../common/resourceManager');
const BWELL_PLATFORM_MEMBER_ID_SYSTEM = 'https://icanbwell.com/Bwell_Platform/member_id';
const BWELL_FHIR_MEMBER_ID_SYSTEM = 'https://www.icanbwell.com/member_id';
const idProjection = {id: 1, _id: 0};

/**
 * Gets Patient id from identifiers
 * @param {string} base_version
 * @param {boolean} useAtlas
 * @param {string} fhirPersonId
 * @param {string} personSystem
 * @param {string} patientSystem
 * @return {Promise<string[]>}
 */
const getPatientIdsByPersonIdentifiersAsync = async (base_version, useAtlas, fhirPersonId,
                                                // eslint-disable-next-line no-unused-vars
                                                personSystem = BWELL_FHIR_MEMBER_ID_SYSTEM,
                                                patientSystem = BWELL_PLATFORM_MEMBER_ID_SYSTEM) => {
    /**
     * @type {string[]}
     */
    let result = [];
    if (fhirPersonId) {
        /**
         * @type {import('mongodb').Collection<import('mongodb').DefaultSchema>}
         */
        const personCollection = await getOrCreateCollectionForResourceTypeAsync('Person', base_version, useAtlas);
        let person = await personCollection.findOne({id: fhirPersonId});
        // Finds Patients by platform member ids and returns an array with the found patient ids
        if (person.identifier && person.identifier.length > 0) {
            let memberId = person.identifier.filter(identifier => {
                return identifier.type.coding.some(coding => {
                        return coding.system === 'https://www.icanbwell.com' && coding.code === 'member_id';
                    }
                );
            });
            /**
             * @type {import('mongodb').Collection<import('mongodb').DefaultSchema>}
             */
            const collection = await getOrCreateCollectionForResourceTypeAsync('Patient', base_version, useAtlas);
            let patients = await collection.find(
                {identifier: {$elemMatch: {'system': patientSystem, 'value': {$in: memberId.map(id => id.value)}}}},
            ).project(idProjection);
            result = await patients.map(p => p.id).toArray();
        }
    }
    return result;
};

module.exports = {
    getPatientIdsByPersonIdentifiersAsync
};
