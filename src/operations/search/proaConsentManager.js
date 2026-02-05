const { DatabaseQueryFactory } = require('../../dataLayer/databaseQueryFactory');
const { assertTypeEquals } = require('../../utils/assertType');
const { ConfigManager } = require('../../utils/configManager');
const { CONSENT_OF_LINKED_PERSON_INDEX, PATIENT_REFERENCE_PREFIX, CONSENT_CATEGORY } = require('../../constants');
const { ReferenceParser } = require('../../utils/referenceParser');

class ProaConsentManager {
    /**
     * constructor
     * @param {DatabaseQueryFactory} databaseQueryFactory
     * @param {ConfigManager} configManager
     */
    constructor({ databaseQueryFactory, configManager }) {
        /**
         * @type {DatabaseQueryFactory}
         */
        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);
        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
    }

    /**
     * @description Fetches all the consent resources for provided patients.
     * @typedef {Object} ConsentQueryOptions
     * @property {string[]} ownerTags
     * @property {string[] | undefined} patientIds
     * @param {ConsentQueryOptions}
     * @returns Consent resource list
     */
    async getConsentResources({ ownerTags, patientIds }) {
        const query = {
            $and: [
                { status: 'active' },
                { 'patient._uuid': { $in: patientIds } },
                {
                    'category.coding': {
                        $elemMatch: {
                            system: CONSENT_CATEGORY.DATA_CONNECTION_VIEW_CONTROL.SYSTEM,
                            code: { $in: this.configManager.getDataSharingConsentCodes }
                        }
                    }
                },
                { 'provision.type': 'permit' },
                {
                    'meta.security': {
                        $elemMatch: {
                            system: 'https://www.icanbwell.com/owner',
                            code: { $in: ownerTags }
                        }
                    }
                }
            ]
        };

        const consentDataBaseQueryManager = this.databaseQueryFactory.createQuery({
            resourceType: 'Consent',
            base_version: '4_0_0'
        });

        const cursor = await consentDataBaseQueryManager.findAsync({
            query,
            projection: {}
        });
        const consentResources = await cursor
            // forcing to use this index
            .hint({
                indexHint: CONSENT_OF_LINKED_PERSON_INDEX
            })
            .sort({ 'meta.lastUpdated': -1 })
            .toArrayAsync();

        return consentResources;
    }

    /**
     * Filter patients having consent.
     * @typedef {Object} PatientIdsWithConsent
     * @property {{[key: string]: string[]}} patientIdToImmediatePersonUuid patient id to immediate person map
     * @property {string[]} securityTags security Tags
     * @property {{[key: string]: string[]}} personToLinkedPatientsMap person to linked patient map
     * @param {PatientIdsWithConsent} param
     */
    async getPatientIdsWithConsent ({ patientIdToImmediatePersonUuid, securityTags, personToLinkedPatientsMap }) {
        /**
         * @type {Set<string>}
         */
        const immediatePersonUuids = new Set();
        /**
         * Reverse map
         * @type {Map<string, Set<string>>}
         */
        const immediatePersonToInputPatientId = new Map();
        Object.entries(patientIdToImmediatePersonUuid).forEach(([patientId, persons]) => {
            persons.forEach((person) => {
                if (!immediatePersonToInputPatientId.has(person)) {
                    immediatePersonToInputPatientId.set(person, new Set());
                }
                immediatePersonToInputPatientId.get(person).add(patientId);
                immediatePersonUuids.add(person);
            });
        });

        const patientIds = await this.getAllPatientsForPersons(immediatePersonUuids, personToLinkedPatientsMap);

        // Get Consent for each patient
        const consentResources = await this.getConsentResources({
            ownerTags: securityTags,
            patientIds
        });

        /**
         * (Proxy) Patient Refs which have provided consent to view data
         * @type {Set<string>}
         */
        const allowedPatientIds = new Set();
        consentResources.forEach((consent) => {
            const patientId = consent.patient?._uuid || consent.patient?._sourceId;
            if (!patientId) {
                return;
            }
            const { id } = ReferenceParser.parseReference(patientId);
            /** @type {Set<string>} */
            const matchingPersons = new Set();
            for (const [person, patients] of personToLinkedPatientsMap) {
                // Check if the patients list contains the given patient ID
                if (patients.includes(`${PATIENT_REFERENCE_PREFIX}${id}`)) {
                    matchingPersons.add(person);
                }
            }
            matchingPersons.forEach((personUuid) => {
                if (immediatePersonToInputPatientId.has(personUuid)) {
                    immediatePersonToInputPatientId.get(personUuid).forEach((patientId) => {
                        allowedPatientIds.add(patientId);
                    });
                }
            });
        });
        return allowedPatientIds;
    }

    /**
     * Function to retrieve patients for each person and concatenate them
     * @param {Set<string>} personSet
     * @param {Map<string, string[]>} personPatientMap
     */
    async getAllPatientsForPersons (personSet, personPatientMap) {
        /**
         * @type {Set<string>}
         */
        const allPatients = new Set();
        for (const personId of personSet) {
            if (personPatientMap.has(personId)) {
                const patientsForPerson = personPatientMap.get(personId);
                // Concatenate the list of patients to the array of all patients
                patientsForPerson.forEach(patient => {
                    allPatients.add(patient);
                });
            }
        }
        return [...allPatients];
    }
}

module.exports = {
    ProaConsentManager
};
