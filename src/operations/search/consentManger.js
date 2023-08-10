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
const { BadRequestError } = require('../../utils/httpErrors');
const { logError } = require('../common/logging');
const { SearchFilterFromReference } = require('../query/filters/searchFilterFromReference');
const { ReferenceParser } = require('../../utils/referenceParser');

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
     * @param {string[]} patientIds
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
            const patientReferences = this.getResourceReferencesFromFilter('Patient', parsedArgs);
            if (patientReferences && patientReferences.length > 0) {
                /**
                 * validate if multiple resources are present for passed patient-ids
                 * validating for consent only, coz for all other cases security-tags are already added to filter
                 * hence no unnecessary access is possible
                */
                await this.validatePatientIdsAsync(patientReferences);

                // Get b.Well Master Person and/or Person map for each patient IDs
                const bwellPersonsAndClientPatientsIdMap = await this
                    .linkedPatientsFinder
                    .getBwellPersonAndAllClientIds({ patientReferences });

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
     * Get ResourceReferences from ParsedArgs filter.
     * For eg, if patient filter is used, then return the patient references passed
     * return id -> Reference map for all resource references
     * @param {string} resourceType
     * @param {import('../query/parsedArgs').ParsedArgs} parsedArgs
     * @returns {import('../query/filters/searchFilterFromReference').IReferences} Array of resource Id's present in query
     */
    getResourceReferencesFromFilter(resourceType, parsedArgs) {
        assertIsValid(typeof resourceType === 'string');
        assertIsValid(parsedArgs instanceof ParsedArgs);

        /**@type {import('../query/filters/searchFilterFromReference').IReferences} */
        let idReferenceMap;

        const modifiersToSkip = ['not'];

        idReferenceMap = parsedArgs.parsedArgItems
            .reduce((/**@type {import('../query/filters/searchFilterFromReference').IReferences}*/refs, /**@type {import('../query/parsedArgsItem').ParsedArgsItem}*/currArg) => {
                const queryParamReferences = currArg.references;
                // if modifier is 'not' then skip the addition
                if (currArg.modifiers.some((v) => modifiersToSkip.includes(v))) {
                    return refs;
                }

                // if referenceType is equal to resourceType, then add the id
                queryParamReferences.forEach((reference) => {
                    if (reference.resourceType === resourceType) {
                        // add the reference
                        refs.push({
                            resourceType: reference.resourceType,
                            id: reference.id,
                            sourceAssigningAuthority: reference.sourceAssigningAuthority,
                        });
                    }
                });
                return refs;
            }, []);

        return idReferenceMap;
    }

    /**
     * For array of patientIds passed, checks if there are more than two resources for
     * any id. If its there, then throws a bad-request error else returns true
     * @param {import('../query/filters/searchFilterFromReference').IReferences} references Passed PatientIds in query.
     */
    async validatePatientIdsAsync(references) {
        /**
         * PatientId -> No of Patient Resources
         * @type {Map<string, number>}
         * */
        const patientIdToCount = new Map();
        /**@type {Set<string>} */
        const idsWithMultipleResourcesSet = new Set();

        references.forEach((ref) => {
            const { id, sourceAssigningAuthority } = ref;
            /** for uuid -> uuid, and for id and sourceAssigningAuthority -> id|sourceAssigningAuthority  */
            const idWithSourceAssigningAuthority = ReferenceParser.createReference({ id, sourceAssigningAuthority });
            // initial count as zero
            patientIdToCount.set(idWithSourceAssigningAuthority, 0);
        });


        const query = this.databaseQueryFactory.createQuery({
            resourceType: 'Patient',
            base_version: '4_0_0',
        });

        // find all patients for given array of ids.
        const cursor = await query.findAsync({
            query: {
                '$or': SearchFilterFromReference.buildFilter(references, null),
            },
            options: { projection: { id: 1, _sourceId: 1, _uuid: 1 } }
        });

        while (await cursor.hasNext()) {
            const patient = await cursor.next();
            /**
             * PatientIdsSet can have sourceId as well as uuid so check both of them.
             * One of them will be present inside the set
             * @type {string | null}
             */
            let patientId;
            if (
                // cover all the possible cases
                (patient._uuid && (patientId = patient._uuid) && patientIdToCount.has(patientId)) ||
                (patient._sourceId && patient._sourceAssigningAuthority && (patientId = `${patient._sourceId}|${patient._sourceAssigningAuthority}`) && patientIdToCount.has(patientId)) ||
                (patient._sourceId && (patientId = patient._sourceId) && patientIdToCount.has(patientId))
            ) {
                let count = patientIdToCount.get(patientId) + 1;
                // this means duplicate resource is present
                if (count > 1) {
                    idsWithMultipleResourcesSet.add(`${PATIENT_REFERENCE_PREFIX}${patientId}`);
                }

                // update the count
                patientIdToCount.set(patientId, count);
            }
        }

        /**@type {string[]} */
        const idsWithMultipleResources = Array.from(idsWithMultipleResourcesSet);
        if (idsWithMultipleResources.length > 0) {
            const message = [
                'Multiple Patient Resources are present for passed patientIds: [',
                idsWithMultipleResources.map((s) => `'${s}'`).join(','),
                ']'
            ].join('');
            logError(`ConsentManager.validatePatientIdsAsync: Bad Request, ${message}`);
            throw new BadRequestError(new Error(message), { patientIds: idsWithMultipleResources });
        }

        // if validation is success, return true
        return true;
    }
}

module.exports = {
    ConsentManager
};
