const httpContext = require('express-http-context');
const { assertTypeEquals } = require('./assertType');
const { ConfigManager } = require('./configManager');
const { PatientDataViewControlManager } = require('./patientDataViewController');
const { PatientScopeManager } = require('../operations/security/patientScopeManager');
const { ParsedArgsItem } = require('../operations/query/parsedArgsItem');
const { QueryParameterValue } = require('../operations/query/queryParameterValue');
const { searchParameterQueries } = require('../searchParameters/searchParameters');
const { HTTP_CONTEXT_KEYS } = require('../constants');
const { ViewControlSubject } = require('./viewControlSubject');

/**
 * Applies a Person's `dataConnectionViewControl` Consent to a read: the lookup every read path shares
 * (REST, GraphQL v1 and v2, $everything, /mcp), and the `_id:not` filter for the resources it hides.
 * It reuses PatientDataViewControlManager (enrollment gate + Consent lookup) and loads the Consent at
 * most once per subject per request.
 *
 * The subject Person is chosen by the caller (see ViewControlSubject). When a caller passes none, it
 * is the member in the token, so service and admin tokens are unaffected unless a caller opts in with
 * a URL Person. Subjects whose owner is not in configManager.clientsWithDataConnectionViewControl are
 * returned untouched.
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
     * With no subject (a service or admin token that didn't opt in, or a member token without a person
     * id), or no enrolled client, the result is empty and no lookup runs.
     * @param {import('./fhirRequestInfo').FhirRequestInfo|undefined} requestInfo
     * @param {string} base_version
     * @param {ViewControlSubject|null} [subject] defaults to the member in the token
     * @return {Promise<ViewControlConsentLookup>}
     */
    async getConsentLookupAsync({ requestInfo, base_version, subject = ViewControlSubject.fromToken(requestInfo) }) {
        if (!subject || this.configManager.clientsWithDataConnectionViewControl.length === 0) {
            return emptyLookup();
        }
        const cacheKey = `${HTTP_CONTEXT_KEYS.PATIENT_VIEW_CONTROL_EXCLUDE_PREFIX}${subject}`;
        let pending = httpContext.get(cacheKey);
        if (!pending) {
            pending = this.loadAsync({ requestInfo, base_version, subject });
            httpContext.set(cacheKey, pending);
            // never memoize a failure: the next call retries (and fails closed again if still broken)
            pending.catch(() => httpContext.set(cacheKey, undefined));
        }
        return pending;
    }

    /**
     * @private
     * @return {Promise<ViewControlConsentLookup>}
     */
    async loadAsync({ requestInfo, base_version, subject }) {
        const person = subject.isUrlPerson
            ? await this.loadUrlPersonAsync({ requestInfo, base_version, subject })
            : await this.loadTokenPersonAsync({ requestInfo, base_version, subject });
        // The token's Person was not found (e.g. not provisioned yet): the member is linked to no
        // Patient and has no Consent, so there is nothing to hide.
        if (!person) {
            return emptyLookup();
        }
        const { personId, owner } = person;
        // Every Person has an owner tag (writes reject a resource without one), and enrollment is
        // decided by it. A Person without one is bad data, not "enrolled", so getConsentAsync fails
        // the request.
        const { viewControlResourceToExcludeMap, viewControlConsentQueries, viewControlConsentQueryOptions } =
            await this.patientDataViewControlManager.getConsentAsync({
                requestInfo,
                base_version,
                personId,
                owner,
                patientFilterReferences: null
            });
        return freezeLookup({
            viewControlResourceToExcludeMap: viewControlResourceToExcludeMap || {},
            viewControlConsentQueries: viewControlConsentQueries || [],
            viewControlConsentQueryOptions: viewControlConsentQueryOptions || []
        });
    }

    /**
     * The member in the token: walking their Person records its owner in httpContext, as null for a
     * Person without an owner tag. Nothing is recorded when the Person was not found.
     * @private
     * @return {Promise<{ personId: string, owner: string|null }|null>} null when the Person was not found
     */
    async loadTokenPersonAsync({ requestInfo, base_version, subject }) {
        await this.patientScopeManager.getPatientIdsFromScopeAsync({
            base_version,
            isUser: requestInfo.isUser,
            personIdFromJwtToken: subject.personId,
            addPersonOwnerToContext: true,
            requestInfo
        });
        const owner = httpContext.get(`${HTTP_CONTEXT_KEYS.PERSON_OWNER_PREFIX}${subject.personId}`);
        return owner === undefined ? null : { personId: subject.personId, owner };
    }

    /**
     * A Person named in the URL: read through the caller's access filter, so a Person the caller can't
     * see is a 404 like a missing one. The Consent is keyed on the Person's uuid, whatever id form the
     * URL used.
     * @private
     * @return {Promise<{ personId: string, owner: string|undefined }>}
     */
    async loadUrlPersonAsync({ requestInfo, base_version, subject }) {
        const { uuid, owner } = await this.patientDataViewControlManager.findPersonAsync({
            requestInfo,
            base_version,
            personId: subject.personId
        });
        return { personId: uuid, owner };
    }

    /**
     * Adds the Consent-driven `_id:not` filter to parsedArgs (in place).
     * @param {import('../operations/query/parsedArgs').ParsedArgs} parsedArgs
     * @param {string} resourceType
     * @param {string} base_version
     * @param {import('./fhirRequestInfo').FhirRequestInfo|undefined} requestInfo
     * @param {ViewControlSubject|null} [subject] defaults to the member in the token
     * @return {Promise<import('../operations/query/parsedArgs').ParsedArgs>}
     */
    async applyAsync({ parsedArgs, resourceType, base_version, requestInfo, subject }) {
        const { viewControlResourceToExcludeMap: excludeMap } = await this.getConsentLookupAsync({
            requestInfo, base_version, subject
        });
        // recorded whatever the resourceType, so results can drop Composition sections that reference
        // a hidden resource of another type
        parsedArgs.viewControlExcludeMap = excludeMap;
        const consentExcludedIds = excludeMap?.[resourceType] || [];
        if (consentExcludedIds.length === 0) {
            return parsedArgs;
        }
        // Fold any `_id:not` / `id:not` the caller supplied into one `_id:not` item. ParsedArgs.add()
        // replaces the caller's `_id:not` item; the caller's `id:not` item is dropped here, or the
        // same ids would be excluded twice.
        const isIdNotItem = (a) =>
            (a.queryParameter === '_id' || a.queryParameter === 'id') &&
            a.modifiers?.length === 1 &&
            a.modifiers[0] === 'not';
        const callerExcludedIds = parsedArgs.parsedArgItems
            .filter(isIdNotItem)
            .flatMap((a) => a.queryParameterValue.values || []);
        parsedArgs.parsedArgItems = parsedArgs.parsedArgItems.filter(
            (a) => !(isIdNotItem(a) && a.queryParameter === 'id')
        );
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
