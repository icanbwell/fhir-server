const { QueryRewriter } = require('./queryRewriter');
const { assertTypeEquals, assertIsValid } = require('../../utils/assertType');
const { PersonToPatientIdsExpander } = require('../../utils/personToPatientIdsExpander');
const { QueryParameterValue } = require('../../operations/query/queryParameterValue');
const { isTrueWithFallback } = require('../../utils/isTrue');
const { ConfigManager } = require('../../utils/configManager');
const { FhirRequestInfo } = require('../../utils/fhirRequestInfo');
const { RequestSpecificCache } = require('../../utils/requestSpecificCache');
const { ReferenceParser } = require('../../utils/referenceParser');
const { DATA_SHARING_PATIENT_TO_PERSON_DATA } = require('../../constants');

const patientReferencePrefix = 'Patient/';
const personProxyPrefix = 'person.';
const patientReferencePlusPersonProxyPrefix = `${patientReferencePrefix}${personProxyPrefix}`;

class PatientProxyQueryRewriter extends QueryRewriter {
    /**
     * @typedef {object} PatientProxyQueryRewriterProps
     * @property {ConfigManager} configManager
     * @property {PersonToPatientIdsExpander} personToPatientIdsExpander
     * @property {RequestSpecificCache} requestSpecificCache
     * constructor
     * @param {PatientProxyQueryRewriterProps} params
     */
    constructor (
        {
            personToPatientIdsExpander,
            configManager,
            requestSpecificCache
        }
    ) {
        super();

        /**
         * @type {PersonToPatientIdsExpander}
         */
        this.personToPatientIdsExpander = personToPatientIdsExpander;
        assertTypeEquals(personToPatientIdsExpander, PersonToPatientIdsExpander);

        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);

        /**
         * @type {RequestSpecificCache}
         */
        this.requestSpecificCache = requestSpecificCache;
        assertTypeEquals(requestSpecificCache, RequestSpecificCache);
    }

    /**
     * Whether this request is the specific request shape that
     * DataSharingManager.getValidatedPatientIdsMap's new cache-only branch requires:
     * Person/proxy-patient $everything, with the PROA feature enabled.
     *
     * This is the producer-side eligibility check: it decides whether writeProaSafeCache
     * actually runs. everythingHelper.js's two constructQueryAsync call sites compute the
     * consumer-side `useProxyPatientToPersonCache` boolean independently and must match this
     * condition exactly (method === 'GET' in particular) -- if they ever diverge, a request
     * could ask DataSharingManager to read a cache that was never written.
     *
     * The last clause guards the same hazard the old
     * configManager.enableProxyPersonScopeCheckForEverything check did, re-expressed against the
     * condition that actually governs it now. Previously, PersonToPatientIdsExpander only
     * computed the scope-derived securityTags its owner-tag verification needs when that flag
     * gated the access-scope check on to $everything GETs, so "flag off" meant "verification
     * cannot run". IDG-5 made that access-scope check unconditional and removed the flag, which
     * left the old clause reading `undefined` -- a permanently-false gate that silently disabled
     * this cache. What remains true is the underlying precondition: the expander computes those
     * securityTags only on its non-patient-scoped branch. A patient-scoped caller is filtered by
     * its own Person _uuid instead, so there is no scope-derived tag set to match an owner tag
     * against and ownerVerifiedPersonToLinkedPatients comes back empty. Writing a "successfully
     * populated but empty" cache in that case would make dataSharingManager.js silently treat
     * every patient as not-PROA-eligible; skipping the write instead lets its "cache entirely
     * absent" assertFail throw loudly, which is the intended failure mode. requestInfo.isUser is
     * the same patient-scope determination the expander's hasPatientScope makes -- see
     * ScopesManager.hasPatientScope's JSDoc on why the two must always agree.
     * @param {FhirRequestInfo} requestInfo
     * @return {boolean}
     */
    isProaCacheEligibleRequest (requestInfo) {
        return Boolean(
            this.configManager.enableConsentedProaDataAccess &&
            requestInfo?.originalUrl?.includes('$everything') &&
            requestInfo?.method === 'GET' &&
            !requestInfo?.isUser
        );
    }

    /**
     * Writes the owner-tag-verified Person->Patient result to RequestSpecificCache, in the two
     * shapes DataSharingManager.getValidatedPatientIdsMap needs to fully replace
     * BwellPersonFinder.getImmediatePersonIdsOfPatientsAsync for this request.
     * @param {FhirRequestInfo} requestInfo
     * @param {Map<string, Set<string>>} ownerVerifiedPersonToLinkedPatients
     */
    writeProaSafeCache ({ requestInfo, ownerVerifiedPersonToLinkedPatients }) {
        const cache = this.requestSpecificCache.getMap({ requestId: requestInfo.requestId, name: DATA_SHARING_PATIENT_TO_PERSON_DATA });
        if (cache.has('personToLinkedPatientsMap')) {
            // Already populated by an earlier proxy-id group processed in this same request.
            return;
        }
        /** @type {Map<string, string[]>} */
        const personToLinkedPatientsMap = new Map();
        /** @type {{[key: string]: string[]}} */
        const patientReferenceToPersonUuid = {};
        for (const [personUuid, patientRefsSet] of ownerVerifiedPersonToLinkedPatients) {
            const patientRefs = Array.from(patientRefsSet);
            personToLinkedPatientsMap.set(personUuid, patientRefs);
            for (const patientRef of patientRefs) {
                const { id: patientId } = ReferenceParser.parseReference(patientRef);
                if (!patientReferenceToPersonUuid[patientId]) {
                    patientReferenceToPersonUuid[patientId] = [];
                }
                patientReferenceToPersonUuid[patientId].push(personUuid);
            }
        }
        cache.set('personToLinkedPatientsMap', personToLinkedPatientsMap);
        cache.set('patientReferenceToPersonUuid', patientReferenceToPersonUuid);
    }

    /**
     * updates the queryParameters
     * @param {ParsedArgs} parsedArgs
     * @param {string} base_version
     * @param {boolean} includePatientPrefix
     * @param {boolean} cachePatientToPersonMap
     * @param {FhirRequestInfo} requestInfo
     * @returns {ParsedArgsItem}
     */
    async rewriteQueryParametersAsync ({ parsedArg, base_version, includePatientPrefix, cachePatientToPersonMap, requestInfo }) {
        const queryParameterValues = parsedArg.queryParameterValue.values;
        if (queryParameterValues && queryParameterValues.length > 0) {
            /**
             * @type {{queryParametersWithProxyPatientIds: string[], queryParametersWithoutProxyPatientIds: string[]}}
             */
            const { queryParametersWithProxyPatientIds, queryParametersWithoutProxyPatientIds } =
                queryParameterValues.reduce((queryParametersMap, queryParameterValue) => {
                    if (typeof queryParameterValue === 'string' && (
                        // either person.id or Patient/person.id
                        queryParameterValue.startsWith(patientReferencePlusPersonProxyPrefix) ||
                        (queryParameterValue.startsWith(personProxyPrefix))
                    )) {
                        queryParametersMap.queryParametersWithProxyPatientIds.push(queryParameterValue);
                    } else {
                        queryParametersMap.queryParametersWithoutProxyPatientIds.push(queryParameterValue);
                    }
                    return queryParametersMap;
                }, {
                    queryParametersWithProxyPatientIds: [],
                    queryParametersWithoutProxyPatientIds: []
                });

            if (queryParametersWithProxyPatientIds.length > 0) {
                const captureOwnerVerifiedLinks = this.isProaCacheEligibleRequest(requestInfo);

                /**
                 * @type {{[k: string]: string[]}}
                 */
                const rawResult = await this.personToPatientIdsExpander.getPatientProxyIdsAsync(
                    {
                        base_version,
                        ids: queryParametersWithProxyPatientIds,
                        includePatientPrefix,
                        toMap: true,
                        requestInfo,
                        captureOwnerVerifiedLinks
                    }
                );
                const patientProxyMap = captureOwnerVerifiedLinks ? rawResult.plainMap : rawResult;

                 /** @type {{[k: string]: string}} */
                const patientToPersonMap = {};

                /** @type {string[]} */
                const patientProxyIds = [];
                Object.entries(patientProxyMap).forEach(([personId, ids]) => {
                    patientProxyIds.push(...ids);

                    if (cachePatientToPersonMap) {
                        ids.forEach((id) => {
                            patientToPersonMap[`${id}`] = personId;
                        });
                    }
                });

                parsedArg.queryParameterValue = new QueryParameterValue({
                    value: [...patientProxyIds, ...queryParametersWithoutProxyPatientIds],
                    operator: '$or'
                });

                if (cachePatientToPersonMap) {
                    // assign the map here
                    parsedArg.patientToPersonMap = patientToPersonMap;
                }

                if (captureOwnerVerifiedLinks) {
                    this.writeProaSafeCache({
                        requestInfo,
                        ownerVerifiedPersonToLinkedPatients: rawResult.ownerVerifiedPersonToLinkedPatients
                    });
                }
            }
        }
        return parsedArg;
    }

    /**
     * rewrites the args
     * @param {string} base_version
     * @param {ParsedArgs} parsedArgs
     * @param {string} resourceType
     * @param {FhirRequestInfo} requestInfo
     * @return {Promise<ParsedArgs>}
     */

    async rewriteArgsAsync ({ base_version, parsedArgs, resourceType, requestInfo }) {
        assertIsValid(resourceType);
        assertIsValid(base_version);
        const cachePatientToPersonMap = isTrueWithFallback(parsedArgs._rewritePatientReference, this.configManager.rewritePatientReference);
        if (parsedArgs?.parsedArgItems) {
            parsedArgs.parsedArgItems = await Promise.all(
                parsedArgs.parsedArgItems.map(async parsedArg => {
                    if (resourceType === 'Patient') {
                        if (parsedArg.queryParameter === 'id' || parsedArg.queryParameter === '_id') {
                            parsedArg = await this.rewriteQueryParametersAsync({
                                parsedArg,
                                base_version,
                                includePatientPrefix: false,
                                cachePatientToPersonMap,
                                requestInfo
                            });
                        }
                    } else { // resourceType other than Patient
                        parsedArg = await this.rewriteQueryParametersAsync({
                            parsedArg,
                            base_version,
                            includePatientPrefix: true,
                            cachePatientToPersonMap,
                            requestInfo
                        });
                    }
                    return parsedArg;
                })
            );
        }

        return parsedArgs;
    }
}

module.exports = {
    PatientProxyQueryRewriter
};
