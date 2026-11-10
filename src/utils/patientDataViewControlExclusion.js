const httpContext = require('express-http-context');
const { assertTypeEquals } = require('./assertType');
const { ConfigManager } = require('./configManager');
const { PatientDataViewControlManager } = require('./patientDataViewController');
const { PatientScopeManager } = require('../operations/security/patientScopeManager');
const { ParsedArgsItem } = require('../operations/query/parsedArgsItem');
const { QueryParameterValue } = require('../operations/query/queryParameterValue');
const { searchParameterQueries } = require('../searchParameters/searchParameters');
const { HTTP_CONTEXT_KEYS } = require('../constants');

/**
 * Applies the patient's `dataConnectionViewControl` Consent to a parsed read request by adding an
 * `_id:not` filter for every resource the Consent hides (REST search, REST read-by-id and
 * GraphQL v1). It reuses PatientDataViewControlManager (enrollment gate + Consent lookup) and loads
 * the Consent at most once per request.
 *
 * Only user (patient-scoped) tokens are affected; service/admin tokens and callers whose Person
 * owner is not in configManager.clientsWithDataConnectionViewControl are returned untouched.
 */
class PatientDataViewControlExclusion {
    /**
     * @param {ConfigManager} configManager
     * @param {PatientDataViewControlManager} patientDataViewControlManager
     * @param {PatientScopeManager} patientScopeManager
     */
    constructor({ configManager, patientDataViewControlManager, patientScopeManager }) {
        /** @type {ConfigManager} */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
        /** @type {PatientDataViewControlManager} */
        this.patientDataViewControlManager = patientDataViewControlManager;
        assertTypeEquals(patientDataViewControlManager, PatientDataViewControlManager);
        /** @type {PatientScopeManager} */
        this.patientScopeManager = patientScopeManager;
        assertTypeEquals(patientScopeManager, PatientScopeManager);
    }

    /**
     * The caller's view-control Consent lookup: the hidden resource ids by resourceType, plus the
     * Consent queries and options (for debug output). This is the single lookup every read path
     * shares. Memoized per request: the promise is stored in the request-scoped httpContext, so
     * concurrent GraphQL resolvers share one lookup. The result is frozen because it is shared.
     *
     * Service/admin tokens, user tokens without a person id, and deployments with no enrolled client
     * get an empty result without any lookup.
     * @param {import('./fhirRequestInfo').FhirRequestInfo|undefined} requestInfo
     * @param {string} base_version
     * @return {Promise<ViewControlConsentLookup>}
     */
    async getConsentLookupAsync({ requestInfo, base_version }) {
        if (
            !requestInfo?.isUser ||
            !requestInfo.personIdFromJwtToken ||
            this.configManager.clientsWithDataConnectionViewControl.length === 0
        ) {
            return emptyLookup();
        }
        const cacheKey = `${HTTP_CONTEXT_KEYS.PATIENT_VIEW_CONTROL_EXCLUDE_PREFIX}${requestInfo.personIdFromJwtToken}`;
        let pending = httpContext.get(cacheKey);
        if (!pending) {
            pending = this.loadAsync({ requestInfo, base_version });
            httpContext.set(cacheKey, pending);
            // never memoize a failure: the next call retries (and fails closed again if still broken)
            pending.catch(() => httpContext.set(cacheKey, undefined));
        }
        return pending;
    }

    /**
     * Resource ids hidden by the caller's Consent, by resourceType (see getConsentLookupAsync).
     * @param {import('./fhirRequestInfo').FhirRequestInfo|undefined} requestInfo
     * @param {string} base_version
     * @return {Promise<Readonly<{[resourceType: string]: ReadonlyArray<string>}>>}
     */
    async getExcludedIdsByResourceTypeAsync({ requestInfo, base_version }) {
        const { viewControlResourceToExcludeMap } = await this.getConsentLookupAsync({ requestInfo, base_version });
        return viewControlResourceToExcludeMap;
    }

    /**
     * @private
     * @return {Promise<ViewControlConsentLookup>}
     */
    async loadAsync({ requestInfo, base_version }) {
        const { isUser, personIdFromJwtToken } = requestInfo;
        // getConsentAsync reads the caller's Person owner from httpContext; this populates it
        await this.patientScopeManager.getPatientIdsFromScopeAsync({
            base_version,
            isUser,
            personIdFromJwtToken,
            addPersonOwnerToContext: true,
            requestInfo
        });
        // Every Person has an owner tag (writes reject a resource without one), and enrollment is
        // decided by it. A missing owner is bad data, not "enrolled", so fail the request.
        const { viewControlResourceToExcludeMap, viewControlConsentQueries, viewControlConsentQueryOptions } =
            await this.patientDataViewControlManager.getConsentAsync({
                requestInfo,
                base_version,
                patientFilterReferences: null,
                raiseErrorForMissingUserOwner: true
            });
        return freezeLookup({
            viewControlResourceToExcludeMap: viewControlResourceToExcludeMap || {},
            viewControlConsentQueries: viewControlConsentQueries || [],
            viewControlConsentQueryOptions: viewControlConsentQueryOptions || []
        });
    }

    /**
     * Adds the Consent-driven `_id:not` filter to parsedArgs (in place).
     * @param {import('../operations/query/parsedArgs').ParsedArgs} parsedArgs
     * @param {string} resourceType
     * @param {string} base_version
     * @param {import('./fhirRequestInfo').FhirRequestInfo|undefined} requestInfo
     * @return {Promise<import('../operations/query/parsedArgs').ParsedArgs>}
     */
    async applyAsync({ parsedArgs, resourceType, base_version, requestInfo }) {
        const excludeMap = await this.getExcludedIdsByResourceTypeAsync({ requestInfo, base_version });
        const consentExcludedIds = excludeMap?.[resourceType] || [];
        if (consentExcludedIds.length === 0) {
            return parsedArgs;
        }
        // ParsedArgs.add() REPLACES an existing item with the same parameter+modifiers, so fold in any
        // `_id:not` the caller supplied rather than overwrite it.
        const isIdNotItem = (a) =>
            (a.queryParameter === '_id' || a.queryParameter === 'id') &&
            a.modifiers?.length === 1 &&
            a.modifiers[0] === 'not';
        const callerExcludedIds = parsedArgs.parsedArgItems
            .filter(isIdNotItem)
            .flatMap((a) => a.queryParameterValue.values || []);
        parsedArgs.add(
            new ParsedArgsItem({
                queryParameter: '_id',
                queryParameterValue: new QueryParameterValue({
                    value: [...new Set([...consentExcludedIds, ...callerExcludedIds])],
                    // '$or': FilterById splits a mixed uuid/sourceId list into two sub-filters; '$and'
                    // would require one document to match both, so $nor would exclude nothing.
                    operator: '$or'
                }),
                propertyObj: searchParameterQueries['Resource']['_id'],
                modifiers: ['not']
            })
        );
        return parsedArgs;
    }
}

/**
 * @typedef {Object} ViewControlConsentLookup
 * @property {Readonly<{[resourceType: string]: ReadonlyArray<string>}>} viewControlResourceToExcludeMap
 * @property {ReadonlyArray<Object>} viewControlConsentQueries Consent queries run (debug output only)
 * @property {ReadonlyArray<Object>} viewControlConsentQueryOptions their options (debug output only)
 */

/** @return {ViewControlConsentLookup} */
function emptyLookup() {
    return freezeLookup({
        viewControlResourceToExcludeMap: {},
        viewControlConsentQueries: [],
        viewControlConsentQueryOptions: []
    });
}

/**
 * The lookup is shared by every consumer in the request, so freeze the containers and id lists: a
 * consumer that changed them (appending its own ids, or replacing or removing blocked ones) would
 * otherwise change another consumer's filter. A change is never applied: array methods such as
 * push throw, and plain assignment throws in strict mode and is silently ignored otherwise (most of
 * this codebase is not strict). The query objects themselves are left as is (they are only read,
 * for debug output).
 * @param {ViewControlConsentLookup} lookup
 * @return {ViewControlConsentLookup}
 */
function freezeLookup(lookup) {
    for (const ids of Object.values(lookup.viewControlResourceToExcludeMap)) {
        Object.freeze(ids);
    }
    Object.freeze(lookup.viewControlResourceToExcludeMap);
    Object.freeze(lookup.viewControlConsentQueries);
    Object.freeze(lookup.viewControlConsentQueryOptions);
    return Object.freeze(lookup);
}

module.exports = { PatientDataViewControlExclusion };
