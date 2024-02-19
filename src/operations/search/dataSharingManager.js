const { DatabaseQueryFactory } = require('../../dataLayer/databaseQueryFactory');
const { assertTypeEquals, assertIsValid } = require('../../utils/assertType');
const { ConfigManager } = require('../../utils/configManager');
const { PatientFilterManager } = require('../../fhir/patientFilterManager');
const { ParsedArgs } = require('../query/parsedArgs');
const { QueryParameterValue } = require('../query/queryParameterValue');
const { PATIENT_REFERENCE_PREFIX, PERSON_REFERENCE_PREFIX, PERSON_PROXY_PREFIX } = require('../../constants');
const { SearchQueryBuilder } = require('./searchQueryBuilder');
const { BadRequestError } = require('../../utils/httpErrors');
const { logError } = require('../common/logging');
const { SearchFilterFromReference } = require('../query/filters/searchFilterFromReference');
const { ReferenceParser } = require('../../utils/referenceParser');
const { BwellPersonFinder } = require('../../utils/bwellPersonFinder');
const { IdParser } = require('../../utils/idParser');
const { ProaConsentManager } = require('./proaConsentManager');
const { isUuid } = require('../../utils/uid.util');
const { RequestSpecificCache } = require('../../utils/requestSpecificCache');

class DataSharingManager {
    /**
     * constructor
     * @param {DatabaseQueryFactory} databaseQueryFactory
     * @param {ConfigManager} configManager
     * @param {PatientFilterManager} patientFilterManager
     * @param {SearchQueryBuilder} searchQueryBuilder
     * @param {BwellPersonFinder} bwellPersonFinder
     * @param {ProaConsentManager} proaConsentManager
     * @param {RequestSpecificCache} requestSpecificCache
     */
    constructor (
        {
            databaseQueryFactory,
            configManager,
            patientFilterManager,
            searchQueryBuilder,
            bwellPersonFinder,
            proaConsentManager,
            requestSpecificCache
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

        /**
         * @type {ProaConsentManager}
         */
        this.proaConsentManager = proaConsentManager;
        assertTypeEquals(proaConsentManager, ProaConsentManager);

        /**
         * @type {RequestSpecificCache}
         */
        this.requestSpecificCache = requestSpecificCache;
        assertTypeEquals(requestSpecificCache, RequestSpecificCache);
    }

    /**
     * Returns data sharing manager.
     * @param {string} requestId
     * @returns {Map<string, Resource[]>}
     */
    getDataSharingManagerCache ({ requestId }) {
        return this.requestSpecificCache.getMap({ requestId, name: 'dataSharingManager' });
    }

    /**
     * Update the query to consider data sharing logic, which includes HIE/Treatment related data linked to the client person
     * and consented data(PROA only) and return mongo query from it.
     * @typedef {Object} RewriteDataSharingQuery
     * @property {string} base_version Base Version
     * @property {string} resourceType Resource Type
     * @property {ParsedArgs} parsedArgs Args
     * @property {string[]} securityTags security Tags
     * @property {import('mongodb').Filter<import('mongodb').Document>} query
     * @property {boolean | undefined} useHistoryTable boolean to use history table or not
     * @param {RewriteDataSharingQuery} param
     */
    async updateQueryConsideringDataSharing ({
                                                base_version,
                                                resourceType,
                                                parsedArgs,
                                                securityTags,
                                                query,
                                                useHistoryTable,
                                                requestId
                                            }) {
        assertTypeEquals(parsedArgs, ParsedArgs);
        let everythingCacheMap;
        if (requestId) {
            everythingCacheMap = this.getDataSharingManagerCache({ requestId });
        }
        let patientIdToImmediatePersonUuid;
        let patientsList;
        let personToLinkedPatientsMap;

        // If 'patientIdToImmediatePersonUuid' is in the map, retrieve values.
        if (everythingCacheMap?.has('patientIdToImmediatePersonUuid')) {
            patientIdToImmediatePersonUuid = everythingCacheMap.get('patientIdToImmediatePersonUuid');
            patientsList = everythingCacheMap.get('patientsList');
            personToLinkedPatientsMap = everythingCacheMap.get('personToLinkedPatientsMap');
        } else {
            // If not in the map, fetch the values and set them in the map for future use.
            ({
                patientIdToImmediatePersonUuid,
                patientsList,
                personToLinkedPatientsMap
            } = await this.getValidatedPatientIdsMap({
                resourceType,
                parsedArgs,
                securityTags
            }));
            if (patientIdToImmediatePersonUuid && !Object.keys(patientIdToImmediatePersonUuid).length) {
                return query;
            }
            if (requestId) {
                // Set values in the map for future use.
                everythingCacheMap.set('patientIdToImmediatePersonUuid', patientIdToImmediatePersonUuid);
                everythingCacheMap.set('patientsList', patientsList);
                everythingCacheMap.set('personToLinkedPatientsMap', personToLinkedPatientsMap);
            }
        }

        const patientIdToConnectionTypeMap = await this.getPatientIDToConnectionTypeMap({ patientsList });

        /**
         * List of allowed connection types. Fetched from env variable.
         * @type {string[]}
         */
        let allowedConnectionTypesList;
        /**
         * List of filtered patient ids to be considered for data sharing.
         * @type {Set<string>}
         */
        let allowedPatientIds;
        /**
         * Updated query filter with consented data.
         * @type {import('mongodb').Filter<import('mongodb').Document>}
         */
        let queryWithConsentedData;
        /**
         * Updated query filter with HIE/Treatment related data.
         * @type {import('mongodb').Filter<import('mongodb').Document>}
         */
        let queryWithHIETreatmentData;

        // Case when consented proa data access is enabled.
        if (this.configManager.enableConsentedProaDataAccess) {
            if (everythingCacheMap?.has('allowedPatientIds')) {
                allowedPatientIds = everythingCacheMap.get('allowedPatientIds');
            } else {
                // Filter Patients which have provided consent to view data.
                allowedPatientIds = await this.proaConsentManager.getPatientIdsWithConsent({
                    patientIdToImmediatePersonUuid,
                    securityTags,
                    personToLinkedPatientsMap
                });
                if (requestId) {
                    everythingCacheMap.set('allowedPatientIds', allowedPatientIds);
                }
            }
            allowedConnectionTypesList = this.configManager.getConsentConnectionTypesList;
            this.filterPatientsByConnectionType({
                allowedPatientIds,
                patientIdToConnectionTypeMap,
                allowedConnectionTypesList
            });
            if (allowedPatientIds.size > 0 && allowedConnectionTypesList.length) {
                queryWithConsentedData = this.getConnectionTypeFilteredQuery({
                    base_version,
                    resourceType,
                    allowedPatientIds,
                    parsedArgs,
                    allowedConnectionTypesList,
                    useHistoryTable,
                    patientsList
                });
            }
        }

        // Case when HIE/Treatment related data access is enabled.
        if (this.configManager.enableHIETreatmentRelatedDataAccess) {
            allowedPatientIds = new Set(Object.keys(patientIdToImmediatePersonUuid));
            allowedConnectionTypesList = this.configManager.getHIETreatmentConnectionTypesList;
            this.filterPatientsByConnectionType({
                allowedPatientIds,
                patientIdToConnectionTypeMap,
                allowedConnectionTypesList
            });
            if (allowedPatientIds.size > 0 && allowedConnectionTypesList.length) {
                queryWithHIETreatmentData = this.getConnectionTypeFilteredQuery({
                    base_version,
                    resourceType,
                    allowedPatientIds,
                    parsedArgs,
                    allowedConnectionTypesList,
                    useHistoryTable,
                    patientsList
                });
            }
        }

        // Logic to update original query to consider above 2 cases.
        if (queryWithConsentedData && queryWithHIETreatmentData) {
            query = { $or: [query, queryWithConsentedData, queryWithHIETreatmentData] };
        } else if (queryWithConsentedData) {
            query = { $or: [query, queryWithConsentedData] };
        } else if (queryWithHIETreatmentData) {
            query = { $or: [query, queryWithHIETreatmentData] };
        }
        return query;
    }

    /**
     * Function to fetch & validate patient references and return patient id to immediate person map.
     * @typedef {Object} ValidatedPatientIdsMap
     * @property {string} resourceType Resource Type
     * @property {ParsedArgs} parsedArgs Args
     * @property {string[]} securityTags security Tags
     * @param {ValidatedPatientIdsMap} param
     */
    async getValidatedPatientIdsMap ({ resourceType, parsedArgs, securityTags }) {
        /**
         * Patient id to immediate person map.
         * @type {{[key: string]: string[]}}
         */
        let patientIdToImmediatePersonUuid = {};
        /**
         * @type {Map<string, string[]>}
         */
        let personToLinkedPatientsMap = new Map();
        let patientsList;

        // 1. Check resourceType is specific to Patient.
        if (this.patientFilterManager.isPatientRelatedResource({ resourceType })) {
            // 2. Get (proxy) patient IDs from parsedArgs.
            const patientReferences = this.getResourceReferencesFromFilter('Patient', parsedArgs);
            if (patientReferences && patientReferences.length > 0) {
                // 3. Get patients using patientReferences.
                patientsList = await this.getPatientsList({ patientReferences });

                // 4. Validate if multiple resources are present for the passed patients.
                await this.validatePatientIdsAsync({ patientsList, patientReferences });

                // 5. Update patientReferences to contain uuid only.
                patientReferences.forEach(patientReference => {
                    if (patientReference.id && !patientReference.id.includes(PERSON_PROXY_PREFIX) && !isUuid(patientReference.id)) {
                        const searchedPatient = patientsList.find(patient => patient.id === patientReference.id);
                        if (searchedPatient) {
                            patientReference.id = searchedPatient._uuid;
                        }
                    }
                });

                // 6. Creating patient id to immediate person map with owner same as in security tags provided.
                (
                    {
                        patientReferenceToPersonUuid: patientIdToImmediatePersonUuid,
                        personUUIDToLinkedPatientsUUID: personToLinkedPatientsMap
                    } = await this.getPatientToImmediatePersonMapAsync({ patientReferences, securityTags })
                );
            }
        }
        return { patientIdToImmediatePersonUuid, patientsList, personToLinkedPatientsMap };
    }

    /**
     * Rewrite the query for filtered patient ids.
     * Removes all the patient ids from the query-param that are not included in allowedPatientIds
     * and return mongo query from it.
     * @typedef {Object} RewriteDataSharingQuery2
     * @property {string} base_version Base Version
     * @property {string} resourceType Resource Type
     * @property {Set<string>} allowedPatientIds Allowed patient ids
     * @property {ParsedArgs} parsedArgs Args
     * @property {string[]} allowedConnectionTypesList Allowed connection types list
     * @property {boolean | undefined} useHistoryTable boolean to use history table or not
     * @property {any[]} patientsList List of patients containing id, _sourceId, _uuid & meta.security
     * @param {RewriteDataSharingQuery2} param
     */
    getConnectionTypeFilteredQuery ({
                                       base_version,
                                       resourceType,
                                       allowedPatientIds,
                                       parsedArgs,
                                       allowedConnectionTypesList,
                                       useHistoryTable,
                                       patientsList
                                   }) {
        /**
         * Clone of the original parsed arguments
         * @type {ParsedArgs}
         * */
        const updatedParsedArgs = parsedArgs.clone();

        updatedParsedArgs
            .parsedArgItems
            .forEach((/** @type {import('../query/parsedArgsItem').ParsedArgsItem} */item) => {
                // if property is related to patient
                if (
                    item.propertyObj && item.propertyObj.target && item.propertyObj.target.includes('Patient') && resourceType !== 'Patient'
                ) {
                    /** @type {string[]} */
                    const newQueryParameterValues = [];

                    // update the query-param values
                    item.references.forEach((ref) => {
                        if (!ref.resourceType || ref.resourceType === 'Patient') {
                            // Check if ref.id is uuid or sourceId.
                            if (isUuid(ref.id) && allowedPatientIds.has(ref.id)) {
                                newQueryParameterValues.push(`Patient/${ref.id}`);
                            } else if (!isUuid(ref.id) && !ref.id.includes(PERSON_PROXY_PREFIX)) {
                                const refUUID = patientsList.find(patient => patient.id === ref.id)?._uuid;
                                if (refUUID && allowedPatientIds.has(refUUID)) {
                                    newQueryParameterValues.push(`Patient/${refUUID}`);
                                }
                            }
                        }
                    });

                    // rebuild the query value
                    const newValue = item.queryParameterValue.regenerateValueFromValues(newQueryParameterValues);
                    const newQueryParameterValue = new QueryParameterValue({
                        value: newValue,
                        operator: item.queryParameterValue.operator
                    });

                    // set the value
                    item.queryParameterValue = newQueryParameterValue;
                } else if ((item.queryParameter === 'id' || item.queryParameter === '_id') && resourceType === 'Patient') {
                    const newQueryParameterValues = [];
                    item.queryParameterValue.values.forEach((id) => {
                        if (isUuid(id) && allowedPatientIds.has(id)) {
                            newQueryParameterValues.push(id);
                        } else if (!isUuid(id) && !id.includes(PERSON_PROXY_PREFIX)) {
                            const refUUID = patientsList.find(patient => patient.id === id)?._uuid;
                            if (refUUID && allowedPatientIds.has(refUUID)) {
                                newQueryParameterValues.push(refUUID);
                            }
                        }
                    });

                    const newValue = item.queryParameterValue.regenerateValueFromValues(newQueryParameterValues);
                    item.queryParameterValue = new QueryParameterValue({
                        value: newValue,
                        operator: item.queryParameterValue.operator
                    });
                }
            });

        /**
         * Reconstructed query.
         * @type {import('mongodb').Filter<import('mongodb').Document>}
         */
        const filteredQuery = this.searchQueryBuilder.buildSearchQueryBasedOnVersion({
            resourceType,
            useHistoryTable,
            base_version,
            parsedArgs: updatedParsedArgs
        }).query;

        if (filteredQuery && !Object.keys(filteredQuery).length) {
            return null;
        }

        // Construct the query for 'meta.security' considering all allowed connection types
        const connectionTypeQuery = {
            'meta.security': {
                $elemMatch: {
                    system: 'https://www.icanbwell.com/connectionType',
                    code: {
                        $in: allowedConnectionTypesList
                    }
                }
            }
        };

        return {
            $and: [
                filteredQuery,
                connectionTypeQuery
            ]
        };
    }

    /**
     * Get ResourceReferences from ParsedArgs filter.
     * For eg, if patient filter is used, then return the patient references passed
     * return id -> Reference map for all resource references
     * @param {string} resourceType
     * @param {import('../query/parsedArgs').ParsedArgs} parsedArgs
     * @returns {import('../query/filters/searchFilterFromReference').IReferences} Array of resource Id's present in query
     */
    getResourceReferencesFromFilter (resourceType, parsedArgs) {
        assertIsValid(typeof resourceType === 'string');
        assertIsValid(parsedArgs instanceof ParsedArgs);

        const modifiersToSkip = ['not'];

        /** @type {import('../query/filters/searchFilterFromReference').IReferences} */
        const idReferenceMap = parsedArgs.parsedArgItems
            .reduce((/** @type {import('../query/filters/searchFilterFromReference').IReferences} */refs, /** @type {import('../query/parsedArgsItem').ParsedArgsItem} */currArg) => {
                const queryParamReferences = currArg.references;

                // if patient id is passed and resource type is patient
                if ((currArg.queryParameter === 'id' || currArg.queryParameter === '_id') && resourceType === 'Patient') {
                    currArg.queryParameterValue.values.forEach((value) => {
                        const { id, sourceAssigningAuthority } = IdParser.parse(value);
                        refs.push({
                            resourceType,
                            id,
                            sourceAssigningAuthority
                        });
                    });
                }
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
                            sourceAssigningAuthority: reference.sourceAssigningAuthority
                        });
                    }
                });
                return refs;
            }, []);

        return idReferenceMap;
    }

    /**
     * @typedef {Object} GetPatientToPersonParams - Function Options
     * @property {import('../operations/query/filters/searchFilterFromReference').IReferences} patientReferences - Array of references
     * @property {string[]} securityTags
     * Get patient to person map based on passed patient references
     * @param {GetPatientToPersonParams} options
     * @returns {Promise<{Map<string, string[]>, Map<string, string[]>}>}
     */
    async getPatientToImmediatePersonMapAsync ({ patientReferences, securityTags }) {
        /**
         * @type {Map<string, string[]>, Map<string, string[]>}
         */
        const { patientRefToImmediatePersonRefMap, personToLinkedPatientsMap } =
            await this.bwellPersonFinder.getImmediatePersonIdsOfPatientsAsync({
                patientReferences,
                securityTags
            });
        // convert to patientReference -> PersonUuid
        /** @type {{[key: string]: string[]}} */
        const patientReferenceToPersonUuid = {};
        for (const [patientReference, immediatePersons] of patientRefToImmediatePersonRefMap.entries()) {
            // reference without Patient prefix
            const patientId = patientReference.replace(
                PATIENT_REFERENCE_PREFIX,
                ''
            );
            // filter out proxy-patient
            if (!patientId.startsWith('person.')) {
                // remove Person/ prefix
                patientReferenceToPersonUuid[`${patientId}`] = immediatePersons.map(s => s.replace(PERSON_REFERENCE_PREFIX, ''));
            }
        }

        const personUUIDToLinkedPatientsUUID = new Map();
        for (const [person, linkedPatients] of personToLinkedPatientsMap.entries()) {
            const personId = person.replace(
                PERSON_REFERENCE_PREFIX,
                ''
            );
            personUUIDToLinkedPatientsUUID.set(personId, linkedPatients);
        }
        return { patientReferenceToPersonUuid, personUUIDToLinkedPatientsUUID };
    }

    /**
     * Function to filter patients based on allowed connection types.
     * @typedef {Object} FilterPatientsByConnectionType
     * @property {Set<string>} allowedPatientIds allowed patient ids
     * @property {Map<string, string[]>} patientIdToConnectionTypeMap patient id to connection type map
     * @property {string[]} allowedConnectionTypesList allowed connection types list
     * @param {FilterPatientsByConnectionType} param
     */
    filterPatientsByConnectionType ({ allowedPatientIds, patientIdToConnectionTypeMap, allowedConnectionTypesList }) {
        allowedPatientIds.forEach((patientId) => {
            if (!patientIdToConnectionTypeMap.has(patientId) ||
                !allowedConnectionTypesList.includes(patientIdToConnectionTypeMap.get(patientId))) {
                allowedPatientIds.delete(patientId);
            }
        });
    }

    /**
     * For array of patient references passed, fetch & return patients list.
     * @param {import('../query/filters/searchFilterFromReference').IReferences} references Passed PatientIds in query.
     */
    async getPatientsList ({ patientReferences }) {
        const query = this.databaseQueryFactory.createQuery({
            resourceType: 'Patient',
            base_version: '4_0_0'
        });

        // find all patients for given array of ids.
        const cursor = await query.findAsync({
            query: {
                $or: SearchFilterFromReference.buildFilter(patientReferences, null)
            },
            options: { projection: { id: 1, _sourceId: 1, _uuid: 1, meta: { security: 1 } } }
        });

        const patientsList = [];

        while (await cursor.hasNext()) {
            const patient = await cursor.next();
            patientsList.push(patient);
        }
        return patientsList;
    }

    /**
     * For array of patients, fetch & return patient id to connection type map.
     * @property {string[]} patientsList list of patients for which map is to be created
     */
    async getPatientIDToConnectionTypeMap ({ patientsList }) {
        /**
         * Patient id to corresponding connection type map.
         * @type {Map<string, string[]>}
         */
        const patientIdToConnectionTypeMap = new Map();
        patientsList.forEach(patient => {
            const connectionTypeSecurityTag = patient?.meta?.security?.find(
                item => item.system === 'https://www.icanbwell.com/connectionType'
            );
            if (connectionTypeSecurityTag) {
                patientIdToConnectionTypeMap.set(patient._uuid, connectionTypeSecurityTag.code);
            }
        });
        return patientIdToConnectionTypeMap;
    }

    /**
     * For array of patients passed, checks if there are more than two resources for
     * any id. If its there, then throws a bad-request error else returns true
     */
    async validatePatientIdsAsync ({ patientsList, patientReferences }) {
        /**
         * PatientId -> No of Patient Resources
         * @type {Map<string, number>}
         * */
        const patientIdToCount = new Map();
        /** @type {Set<string>} */
        const idsWithMultipleResourcesSet = new Set();
        patientReferences.forEach((ref) => {
            const { id, sourceAssigningAuthority } = ref;
            /** for uuid -> uuid, and for id and sourceAssigningAuthority -> id|sourceAssigningAuthority  */
            const idWithSourceAssigningAuthority = ReferenceParser.createReference({ id, sourceAssigningAuthority });
            // initial count as zero
            patientIdToCount.set(idWithSourceAssigningAuthority, 0);
        });

        patientsList.forEach((patient) => {
            /**
             * PatientIdsSet can have sourceId as well as uuid so check both of them.
             * One of them will be present inside the set
             * @type {string | null}
             */
            let patientId;
            // cover all the possible cases
            if (patient._uuid && patientIdToCount.has(patient._uuid)) {
                patientId = patient._uuid;
            } else {
                patientId = patient._sourceId;
            }

            const count = patientIdToCount.get(patientId) + 1;
            // this means duplicate resource is present
            if (count > 1) {
                idsWithMultipleResourcesSet.add(`${PATIENT_REFERENCE_PREFIX}${patientId}`);
            }

            // update the count
            patientIdToCount.set(patientId, count);
        });

        /** @type {string[]} */
        const idsWithMultipleResources = Array.from(idsWithMultipleResourcesSet);
        if (idsWithMultipleResources.length > 0) {
            const message = [
                'Multiple Patient Resources are present for passed patientIds: [',
                idsWithMultipleResources.map((s) => `'${s}'`).join(','),
                ']'
            ].join('');
            logError(`DataSharingManager.validatePatientIdsAsync: Bad Request, ${message}`);
            throw new BadRequestError(new Error(message), { patientIds: idsWithMultipleResources });
        }

        // if validation is success, return true
        return true;
    }
}

module.exports = {
    DataSharingManager
};
