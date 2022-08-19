const {DatabaseQueryManager} = require('../../dataLayer/databaseQueryManager');

const BWELL_PLATFORM_MEMBER_ID_SYSTEM = 'https://icanbwell.com/Bwell_Platform/member_id';
const BWELL_FHIR_MEMBER_ID_SYSTEM = 'https://www.icanbwell.com/member_id';
const idProjection = {id: 1, _id: 0};

/**
 * Gets Patient id from identifiers
 * @param {MongoCollectionManager} collectionManager
 * @param {string} base_version
 * @param {boolean} useAtlas
 * @param {string} fhirPersonId
 * @param {string} personSystem
 * @param {string} patientSystem
 * @return {Promise<string[]>}
 */
const getPatientIdsByPersonIdentifiersAsync = async (
    collectionManager,
    base_version, useAtlas, fhirPersonId,
    // eslint-disable-next-line no-unused-vars
    personSystem = BWELL_FHIR_MEMBER_ID_SYSTEM,
    patientSystem = BWELL_PLATFORM_MEMBER_ID_SYSTEM) => {
    /**
     * @type {string[]}
     */
    let result = [];
    if (fhirPersonId) {
        /**
         * @type {Resource | null}
         */
        let person = await new DatabaseQueryManager(collectionManager,
            'Person', base_version, useAtlas)
            .findOneAsync({id: fhirPersonId});
        // Finds Patients by platform member ids and returns an array with the found patient ids
        if (person.identifier && person.identifier.length > 0) {
            let memberId = person.identifier.filter(identifier => {
                return identifier.type.coding.some(coding => {
                        return coding.system === 'https://www.icanbwell.com' && coding.code === 'member_id';
                    }
                );
            });
            /**
             * @type {DatabasePartitionedCursor}
             */
            let cursor = await new DatabaseQueryManager(collectionManager,
                'Patient', base_version, useAtlas)
                .findAsync(
                    {identifier: {$elemMatch: {'system': patientSystem, 'value': {$in: memberId.map(id => id.value)}}}},
                );
            cursor = cursor.project(idProjection);
            result = await cursor.map(p => p.id).toArray();
        }
    }
    return result;
};

module.exports = {
    getPatientIdsByPersonIdentifiersAsync
};
