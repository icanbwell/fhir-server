const { DatabaseQueryFactory } = require('../../dataLayer/databaseQueryFactory');
const { assertTypeEquals } = require('../../utils/assertType');
const { ReferenceParser } = require('../../utils/referenceParser');
const {
    CONSENT_OF_LINKED_PERSON_INDEX,
    PATIENT_REFERENCE_PREFIX,
    CONSENT_CATEGORY,
    PERSON_PROXY_PREFIX
} = require('../../constants');

class CmsConsentManager {
    /**
     * constructor
     * @param {DatabaseQueryFactory} databaseQueryFactory
     */
    constructor({ databaseQueryFactory }) {
        /**
         * @type {DatabaseQueryFactory}
         */
        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);
    }

    /**
     * @description Fetches all the consent resources for provided proxy patients.
     * @param {string[]} proxyPatientRefs - proxy patient references
     * @returns Consent resource list
     */
    async getConsentResources(proxyPatientRefs) {
        const query = {
            $and: [
                { status: 'active' },
                { 'patient._uuid': { $in: proxyPatientRefs } },
                {
                    'category.coding': {
                        $elemMatch: {
                            system: CONSENT_CATEGORY.CMS_DATA_SHARING.SYSTEM,
                            code: CONSENT_CATEGORY.CMS_DATA_SHARING.CODE
                        }
                    }
                },
                { 'provision.type': 'permit' }
            ]
        };

        const consentDataBaseQueryManager = this.databaseQueryFactory.createQuery({
            resourceType: 'Consent',
            base_version: '4_0_0'
        });

        const cursor = await consentDataBaseQueryManager.findAsync({
            query,
            options: {
                projection: {
                    _uuid: 1,
                    patient: 1
                }
            }
        });
        const consentResources = await cursor
            // forcing to use this index
            .hint({
                indexHint: CONSENT_OF_LINKED_PERSON_INDEX
            })
            .toArrayAsync();

        return consentResources;
    }

    /**
     * Filter patients having consent.
     * @param {{[key: string]: string[]}} patientIdToImmediatePersonUuid patient id to immediate person map
     */
    async getPatientIdsWithConsent(patientIdToImmediatePersonUuid) {
        /**
         * Reverse map: person UUID -> Set of patient IDs
         * @type {Map<string, Set<string>>}
         */
        const personToPatientIds = new Map();

        // Build reverse map
        for (const [patientId, persons] of Object.entries(patientIdToImmediatePersonUuid)) {
            for (const person of persons) {
                if (!personToPatientIds.has(person)) {
                    personToPatientIds.set(person, new Set());
                }
                personToPatientIds.get(person).add(patientId);
            }
        }

        // Get Consent for all persons
        const proxyPatientRefs = Array.from(personToPatientIds.keys()).map(
            (personUuid) => `${PATIENT_REFERENCE_PREFIX}${PERSON_PROXY_PREFIX}${personUuid}`
        );
        const consentResources = await this.getConsentResources(proxyPatientRefs);

        /**
         * Patient IDs that have consent to cms data sharing
         * @type {Set<string>}
         */
        const allowedPatientIds = new Set();

        for (const consent of consentResources) {
            const proxyPatientRef = consent.patient?._uuid;
            if (!proxyPatientRef) {
                continue;
            }

            const { id: proxyPatientId } = ReferenceParser.parseReference(proxyPatientRef);
            const personUuid = proxyPatientId.replace(PERSON_PROXY_PREFIX, '');
            const patientIds = personToPatientIds.get(personUuid);

            if (patientIds) {
                patientIds.forEach((patientId) => allowedPatientIds.add(patientId));
            }
        }

        return allowedPatientIds;
    }
}

module.exports = {
    CmsConsentManager
};
