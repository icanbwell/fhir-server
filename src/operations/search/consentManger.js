const {DatabaseQueryFactory} = require('../../dataLayer/databaseQueryFactory');
const {assertTypeEquals, assertIsValid} = require('../../utils/assertType');
const {ConfigManager} = require('../../utils/configManager');
const { PatientFilterManager } = require('../../fhir/patientFilterManager');
const { ParsedArgs } = require('../query/parsedArgs');
const { LinkedPatientsFinder } = require('../../utils/linkedPatientsFinder');
const { QueryParameterValue } = require('../query/queryParameterValue');
const { isUuid } = require('../../utils/uid.util');
const { PATIENT_REFERENCE_PREFIX } = require('../../constants');
const {SearchQueryBuilder} = require('./searchQueryBuilder');

class ConsentManager {
    /**
     * constructor
     * @param {DatabaseQueryFactory} databaseQueryFactory
     * @param {ConfigManager} configManager
     * @param {PatientFilterManager} patientFilterManager
     * @param {LinkedPatientsFinder} linkedPatientsFinder
     * @param {SearchQueryBuilder} SearchQueryBuilder
     */
    constructor(
        {
            databaseQueryFactory,
            configManager,
            patientFilterManager,
            linkedPatientsFinder,
            searchQueryBuilder
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
         * @type {LinkedPatientsFinder}
         */
        this.linkedPatientsFinder = linkedPatientsFinder;
        assertTypeEquals(linkedPatientsFinder, LinkedPatientsFinder);

        /**
         * @type {SearchQueryBuilder}
         */
        this.searchQueryBuilder = searchQueryBuilder;
        assertTypeEquals(searchQueryBuilder, SearchQueryBuilder);
    }

    /**
     * @description Fetches all the consent resources linked to a patient IDs.
     * @param {String[]} patientIds
     * @returns Consent resource list
     */
    async getConsentResources(patientIds, ownerTags) {
        // Query to fetch only the active consents for any patient
        const [uuidReferences, nonUuidReferences] = patientIds.reduce((result, patientId) => {
            if (isUuid(patientId)) {
                result[0].push(`${PATIENT_REFERENCE_PREFIX}${patientId}`);
            } else {
                result[1].push(`${PATIENT_REFERENCE_PREFIX}${patientId}`);
            }
            return result;
        }, [[], []]);

        const patientReferenceQuery = {
            '$or': [
                {'patient._uuid': { $in: uuidReferences }},
                {'patient._sourceId': { $in: nonUuidReferences }},
            ],
        };

        const query =
        {
            $and: [
                {'provision.class.code': {$in: this.configManager.getDataSharingConsentCodes}},
                patientReferenceQuery,
                {'status': 'active'},
                {'provision.type': 'permit'},
                {'meta.security': {
                    '$elemMatch': {
                        'system': 'https://www.icanbwell.com/owner',
                        'code': {$in: ownerTags},
                    },
                }}
            ]
        };
        const consentDataBaseQueryManager = this.databaseQueryFactory.createQuery({
            resourceType: 'Consent',
            base_version: '4_0_0',
        });

        const cursor = await consentDataBaseQueryManager.findAsync({
            query: query,
            projection: {}
        });
        const consentResources = await cursor.sort({'meta.lastUpdated': -1}).toArrayRawAsync();

        return consentResources;
    }

    /**
     * Rewrite the query for consent.
     * Removes all the patient ids from the query-param that don't have given consent
     * and return mongo query from it.
     * @typedef {Object} RewriteConsentedQuery
     * @property {string} base_version Base Version
     * @property {string} resourceType Resource Type
     * @property {ParsedArgs} parsedArgs Args
     * @property {Strint[]} securityTags security Tags
     * @property {import('mongodb').Document} query
     * @property {boolean | undefined} useHistoryTable boolean to use history table or not
     * @param {RewriteConsentedQuery} param
     */
    async getQueryForPatientsWithConsent({ base_version, resourceType, parsedArgs, securityTags, query, useHistoryTable,}) {
        if (!parsedArgs) {
            return query;
        }

        assertTypeEquals(parsedArgs, ParsedArgs);

        let queryWithConsent;
        // 1. Check resourceType is specific to Patient
        if (this.patientFilterManager.isPatientRelatedResource({ resourceType })) {
            // 2. Get (proxy) patient IDs from parsedArgs the filters
            let patientIds = this.getResourceIdsFromFilter('Patient', parsedArgs);
            if (patientIds && patientIds.length > 0) {
                // Get b.Well Master Person and/or Person map for each patient IDs
                const bwellPersonsAndClientPatientsIdMap = await this.linkedPatientsFinder.getBwellPersonAndAllClientIds({ patientIds });
                // Get all patient IDs that connected to bwell master person of input (proxy)patient
                const extendedPatientIds = new Set();
                /**
                 * Reverse map of "inpput (proxy) Patient IDs" and Patient IDs linked to corrosponding bwell master person
                 * @type {{[extendedPatientId: string]: [patientId: string]}
                 * */
                const extendedPatientIdsMap = new Map();
                Object.keys(bwellPersonsAndClientPatientsIdMap).forEach((patientId) => {
                    /**
                     * Master Person and connected patient IDs
                     * @type {{[bwellMasterPerson: string, patientIds: string[]]}}
                     * */
                    // eslint-disable-next-line security/detect-object-injection
                    const personPatientMap = bwellPersonsAndClientPatientsIdMap[patientId];
                    if (personPatientMap.patientIds) {
                        personPatientMap.patientIds.forEach((extendedPatientId) => {
                            extendedPatientIds.add(extendedPatientId);
                            const inputPatientIds = extendedPatientIdsMap.get(extendedPatientId) || new Set();
                            inputPatientIds.add(patientId);
                            extendedPatientIdsMap.set(extendedPatientId, inputPatientIds);
                        });
                    }
                });

                // Get Consent for each b.well master person
                const consentResources = await this.getConsentResources([...extendedPatientIds], securityTags);

                /**
                 * (Proxy) Patient Ids which have provided consent to view data
                 * @type {Set<string>}
                 */
                let patientIdsWithConsent = new Set();
                consentResources.forEach((consent) => {
                    const consentPatientId = consent.patient.reference.replace(PATIENT_REFERENCE_PREFIX, '');
                    if (extendedPatientIdsMap.has(consentPatientId)) {
                        extendedPatientIdsMap.get(consentPatientId).forEach((inputPatientId) => {
                            patientIdsWithConsent.add(inputPatientId);
                        });
                    }
                });
                if (patientIdsWithConsent.size > 0) {
                    /**
                     * Clone of the original parsed arguments
                     * @type {ParsedArgs}
                     * */
                    const consentParsedArgs = parsedArgs.clone();

                    /**@type {Set<string>} */
                    const argsToRemove = new Set();

                    consentParsedArgs
                    .parsedArgItems
                    .forEach((/**@type {import('../query/parsedArgsItem').ParsedArgsItem} */item) => {
                        // if property is related to patient
                        if (
                            item.propertyObj && item.propertyObj.target && item.propertyObj.target.includes('Patient')
                        ) {
                            /**@type {string[]} */
                            const newQueryParamValues = [];

                            // update the query-param values
                            item.references.forEach((ref) => {
                                if (ref.resourceType === 'Patient') {
                                    if (patientIdsWithConsent.has(ref.id)) {
                                        newQueryParamValues.push(`${ref.resourceType}/${ref.id}`);
                                    }
                                    // skip adding patient without consent
                                } else if (ref.resourceType){
                                    newQueryParamValues.push(`${ref.resourceType}/${ref.id}`);
                                }
                            });

                            if (newQueryParamValues.length === 0) {
                                // if all the ids doesn't have consent then remove the queryParam
                                argsToRemove.add(item.queryParameter);
                            } else {
                                // rebuild the query value
                                const newValue = item.queryParameterValue.regenerateValueFromValues(newQueryParamValues);
                                const newQueryParameterValue = new QueryParameterValue({
                                    value: newValue,
                                    operator: item.queryParameterValue.operator,
                                });

                                // set the value
                                item.queryParameterValue = newQueryParameterValue;
                            }
                        }
                    });

                    // remove all empty args
                    argsToRemove.forEach((arg) => consentParsedArgs.remove(arg));

                    // reconstruct the query
                    queryWithConsent = this.searchQueryBuilder.buildSearchQueryBasedOnVersion({
                        resourceType,
                        useHistoryTable,
                        base_version,
                        parsedArgs: consentParsedArgs,
                    }).query;
                }
            }
        }

        // Update query to include Consented data
        if (queryWithConsent){
            query = { $or: [query, queryWithConsent]};
            // todo: if columns are not null, update the columns count by calling MongoQuerySimplifier.findColumnsInFilter({filter: query});
        }

        return query;
    }

    /**
     * Get ResourceIds from ParsedArgs filter.
     * For eg, if patient filter is used, then return the patient ids passed
     * @param {string} resourceType
     * @param {import('../query/parsedArgs').ParsedArgs} parsedArgs
     * @returns {string[]} Array of resource Id's present in query
     */
    getResourceIdsFromFilter(resourceType, parsedArgs) {
        assertIsValid(typeof resourceType === 'string');
        assertIsValid(parsedArgs instanceof ParsedArgs);
        const modifiersToSkip = ['not'];

        /**@type {Set<string>} */
        const resourceIds = parsedArgs.parsedArgItems
            .reduce((/**@type {Set<string>}*/ids, /**@type {import('../query/parsedArgsItem').ParsedArgsItem}*/currArg) => {
                const queryParamReferences = currArg.references;
                // if modifier is 'not' then skip the addition of the ids to set
                if (currArg.modifiers.some((v) => modifiersToSkip.includes(v))) {
                    return ids;
                }

                // if referenceType is equal to resourceType, then add the id
                queryParamReferences.forEach((reference) => {
                    if (reference.resourceType === resourceType) {
                        ids.add(reference.id);
                    }
                });
                return ids;
            }, new Set());

        return Array.from(resourceIds);
    }
}

module.exports = {
    ConsentManager
};
