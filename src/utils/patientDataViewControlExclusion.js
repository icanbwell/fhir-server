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
     * Resource ids hidden by the caller's Consent, by resourceType. Memoized per request (the promise is
     * stored in the request-scoped httpContext, so concurrent GraphQL resolvers share one lookup).
     * @param {import('./fhirRequestInfo').FhirRequestInfo} requestInfo
     * @param {string} base_version
     * @return {Promise<{[resourceType: string]: string[]}>}
     */
    async getExcludedIdsByResourceTypeAsync({ requestInfo, base_version }) {
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
     * @private
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
        const { viewControlResourceToExcludeMap } =
            await this.patientDataViewControlManager.getConsentAsync({
                requestInfo,
                base_version,
                patientFilterReferences: null,
                raiseErrorForMissingUserOwner: true
            });
        return viewControlResourceToExcludeMap;
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
        if (
            !requestInfo?.isUser ||
            !requestInfo.personIdFromJwtToken ||
            this.configManager.clientsWithDataConnectionViewControl.length === 0
        ) {
            return parsedArgs;
        }
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

module.exports = { PatientDataViewControlExclusion };
