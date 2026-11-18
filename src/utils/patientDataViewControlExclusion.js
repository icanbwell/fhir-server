const httpContext = require('express-http-context');
const { assertTypeEquals, assertIsValid } = require('./assertType');
const { ConfigManager } = require('./configManager');
const { PatientDataViewControlManager } = require('./patientDataViewController');
const { PatientScopeManager } = require('../operations/security/patientScopeManager');
const {
    recordViewControlOutcome,
    VIEW_CONTROL_OUTCOME,
    VIEW_CONTROL_SUBJECT,
    VIEW_CONTROL_FAIL_REASON
} = require('./metrics');
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
 * is the user in the token, so service and admin tokens are unaffected. Subjects whose owner is not
 * in configManager.clientsWithDataConnectionViewControl are returned untouched.
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
     * With no subject (a service or admin token, or a user token without a person id), or no enrolled
     * client, the result is empty and no lookup runs.
     * @param {import('./fhirRequestInfo').FhirRequestInfo|undefined} requestInfo
     * @param {string} base_version
     * @param {ViewControlSubject|null} [subject] defaults to the user in the token
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
     * Resolves the lookup and records its outcome once (the caller memoizes per subject per request,
     * so this runs once for each). A failure is recorded as fail_closed and rethrown unchanged.
     * @private
     * @return {Promise<ViewControlConsentLookup>}
     */
    async loadAsync({ requestInfo, base_version, subject }) {
        const metricSubject = VIEW_CONTROL_SUBJECT.USER;
        let resolved;
        try {
            resolved = await this.resolveLookupAsync({ requestInfo, base_version, subject });
        } catch (error) {
            recordViewControlOutcome(VIEW_CONTROL_OUTCOME.FAIL_CLOSED, metricSubject, failReasonOf(error));
            throw error;
        }
        recordViewControlOutcome(resolved.outcome, metricSubject);
        return resolved.lookup;
    }

    /**
     * @private
     * @return {Promise<{ lookup: ViewControlConsentLookup, outcome: string }>} the lookup and its
     *  VIEW_CONTROL_OUTCOME (never fail_closed: that is a throw)
     */
    async resolveLookupAsync({ requestInfo, base_version, subject }) {
        const person = await this.loadTokenPersonAsync({ requestInfo, base_version, subject });
        // The walk found no Person the token can see (e.g. not provisioned yet): the user is linked
        // to no Patient and has no Consent, so there is nothing to hide.
        if (!person) {
            return { lookup: emptyLookup(), outcome: VIEW_CONTROL_OUTCOME.NO_PERSON };
        }
        const { personId, owner } = person;
        // Every Person should have an owner tag (writes reject a resource without one), and enrollment
        // is decided by it. A Person without one is treated as enrolled by getConsentAsync (the
        // Consent is applied).
        const { viewControlResourceToExcludeMap, viewControlConsentQueries, viewControlConsentQueryOptions } =
            await this.patientDataViewControlManager.getConsentAsync({
                requestInfo,
                base_version,
                personId,
                owner
            });
        const lookup = freezeLookup({
            viewControlResourceToExcludeMap: viewControlResourceToExcludeMap || {},
            viewControlConsentQueries: viewControlConsentQueries || [],
            viewControlConsentQueryOptions: viewControlConsentQueryOptions || []
        });
        const notEnrolled = Boolean(owner) && !this.configManager.clientsWithDataConnectionViewControl.includes(owner);
        const hidesSomething = Object.keys(lookup.viewControlResourceToExcludeMap).length > 0;
        let outcome = VIEW_CONTROL_OUTCOME.NO_CONSENT;
        if (notEnrolled) {
            outcome = VIEW_CONTROL_OUTCOME.NOT_ENROLLED;
        } else if (hidesSomething) {
            outcome = VIEW_CONTROL_OUTCOME.HIDDEN;
        }
        return { lookup, outcome };
    }

    /**
     * The user in the token: walking their Person records its owner in httpContext, as null for a
     * Person without an owner tag and as PERSON_NOT_FOUND_MARKER when the walk found no Person.
     * A walk that records nothing is a failure, not "not found": the lookup fails closed instead of
     * returning an empty lookup that would hide nothing.
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
        assertIsValid(
            owner !== undefined,
            'dataConnectionViewControl: the Person walk recorded neither the Person owner nor that the ' +
            'Person was not found, so the view control cannot be applied'
        );
        return owner === HTTP_CONTEXT_KEYS.PERSON_NOT_FOUND_MARKER ? null : { personId: subject.personId, owner };
    }

    /**
     * Adds the Consent-driven `_id:not` filter to parsedArgs (in place).
     * @param {import('../operations/query/parsedArgs').ParsedArgs} parsedArgs
     * @param {string} resourceType
     * @param {string} base_version
     * @param {import('./fhirRequestInfo').FhirRequestInfo|undefined} requestInfo
     * @param {ViewControlSubject|null} [subject] defaults to the user in the token
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
        const callerExcludedIds = parsedArgs.parsedArgItems
            .filter((a) => a.isIdExclusion)
            .flatMap((a) => a.queryParameterValue.values || []);
        parsedArgs.parsedArgItems = parsedArgs.parsedArgItems.filter(
            (a) => !(a.isIdExclusion && a.queryParameter === 'id')
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
 * @param {Error} error
 * @return {string} a VIEW_CONTROL_FAIL_REASON, so the metric label stays bounded
 */
function failReasonOf(error) {
    // by statusCode: ServerError resets its prototype, so instanceof can't tell the subclasses apart
    switch (error?.statusCode) {
        case 404:
            return VIEW_CONTROL_FAIL_REASON.NOT_FOUND;
        case 403:
            return VIEW_CONTROL_FAIL_REASON.FORBIDDEN;
        case 400:
            return VIEW_CONTROL_FAIL_REASON.BAD_REQUEST;
        default:
            return VIEW_CONTROL_FAIL_REASON.ERROR;
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

/**
 * The exclude map of the user in the token, for a read that applies it to the results rather than to
 * a query (Composition sections, cached replays). Undefined for any other token, so those reads leave
 * the results alone. The lookup is memoized per request.
 * @param {PatientDataViewControlExclusion} exclusion
 * @param {import('./fhirRequestInfo').FhirRequestInfo} requestInfo
 * @param {string} base_version
 * @return {Promise<ViewControlConsentLookup['viewControlResourceToExcludeMap']|undefined>}
 */
async function getUserViewControlExcludeMapAsync({ exclusion, requestInfo, base_version }) {
    if (!requestInfo.isUser) {
        return undefined;
    }
    return (await exclusion.getConsentLookupAsync({ requestInfo, base_version }))
        .viewControlResourceToExcludeMap;
}

module.exports = { PatientDataViewControlExclusion, getUserViewControlExcludeMapAsync };
