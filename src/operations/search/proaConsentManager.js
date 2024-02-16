const { DatabaseQueryFactory } = require('../../dataLayer/databaseQueryFactory');
const { assertTypeEquals } = require('../../utils/assertType');
const { ConfigManager } = require('../../utils/configManager');
const { PatientFilterManager } = require('../../fhir/patientFilterManager');
const { PATIENT_REFERENCE_PREFIX, PERSON_REFERENCE_PREFIX, PERSON_PROXY_PREFIX, PROXY_PERSON_CONSENT_CODING, CONSENT_OF_LINKED_PERSON_INDEX } = require('../../constants');
const { SearchQueryBuilder } = require('./searchQueryBuilder');
const { BwellPersonFinder } = require('../../utils/bwellPersonFinder');

class ProaConsentManager {
    /**
     * constructor
     * @param {DatabaseQueryFactory} databaseQueryFactory
     * @param {ConfigManager} configManager
     * @param {PatientFilterManager} patientFilterManager
     * @param {SearchQueryBuilder} searchQueryBuilder
     * @param {BwellPersonFinder} bwellPersonFinder
     */
    constructor (
        {
            databaseQueryFactory,
            configManager,
            patientFilterManager,
            searchQueryBuilder,
            bwellPersonFinder
        }
    ) {
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

        /**
         * @type {PatientFilterManager}
         */
        this.patientFilterManager = patientFilterManager;
        assertTypeEquals(patientFilterManager, PatientFilterManager);

        /**
         * @type {SearchQueryBuilder}
         */
        this.searchQueryBuilder = searchQueryBuilder;
        assertTypeEquals(searchQueryBuilder, SearchQueryBuilder);

        /**
         * @type {BwellPersonFinder}
         */
        this.bwellPersonFinder = bwellPersonFinder;
        assertTypeEquals(bwellPersonFinder, BwellPersonFinder);
    }

    /**
     * @description Fetches all the consent resources linked to a person ids.
     * @typedef {Object} ConsentQueryOptions
     * @property {string[]} ownerTags
     * @property {string[] | undefined} personIds
     * @param {ConsentQueryOptions}
     * @returns Consent resource list
     */
    async getConsentResources ({ ownerTags, personIds }) {
        // get all consents where provision.actor.reference is of proxy-patient with valid code
        const proxyPersonReferences = personIds.map(
            (p) => `${PATIENT_REFERENCE_PREFIX}${PERSON_PROXY_PREFIX}${p.replace(PERSON_REFERENCE_PREFIX, '')}`
        );

        const query =
        {
            $and: [
                { status: 'active' },
                {
                    $and: [
                        {
                            'provision.actor.reference._uuid': {
                                $in: proxyPersonReferences
                            }
                        },
                        {
                            'provision.actor.role.coding': {
                                $elemMatch: {
                                    system: PROXY_PERSON_CONSENT_CODING.SYSTEM,
                                    code: PROXY_PERSON_CONSENT_CODING.CODE
                                }
                            }
                        }
                    ]
                },
                { 'provision.class.code': { $in: this.configManager.getDataSharingConsentCodes } },
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
            .toArrayRawAsync();

        return consentResources;
    }

    /**
     * Filter patients having consent.
     * @typedef {Object} PatientIdsWithConsent
     * @property {{[key: string]: string[]}} patientIdToImmediatePersonUuid patient id to immediate person map
     * @property {string[]} securityTags security Tags
     * @param {PatientIdsWithConsent} param
     */
    async getPatientIdsWithConsent ({ patientIdToImmediatePersonUuid, securityTags }) {
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

        // Get Consent for each person
        const consentResources = await this.getConsentResources({
            ownerTags: securityTags,
            personIds: [...immediatePersonUuids]
        });

        /**
         * (Proxy) Patient Refs which have provided consent to view data
         * @type {Set<string>}
         */
        const allowedPatientIds = new Set();
        consentResources.forEach((consent) => {
            if (Array.isArray(consent?.provision?.actor)) {
                const proxyPersonActor = consent.provision.actor.find((a) => {
                    return a.role && Array.isArray(a.role.coding) && a.role.coding.find((c) => c.code === PROXY_PERSON_CONSENT_CODING.CODE);
                });

                if (proxyPersonActor?.reference?._uuid) {
                    /** @type {string} */
                    const uuidRef = proxyPersonActor.reference._uuid;
                    const personUuid = uuidRef.replace(PATIENT_REFERENCE_PREFIX, '').replace(PERSON_PROXY_PREFIX, '');
                    if (immediatePersonToInputPatientId.has(personUuid)) {
                        immediatePersonToInputPatientId.get(personUuid).forEach((patientId) => {
                            allowedPatientIds.add(patientId);
                        });
                    }
                }
            }
        });
        return allowedPatientIds;
    }
}

module.exports = {
    ProaConsentManager
};
