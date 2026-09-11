const { assertTypeEquals, assertIsValid } = require('./assertType');
const { ConfigManager } = require('./configManager');
const { DatabaseQueryFactory } = require('../dataLayer/databaseQueryFactory');
const { CustomTracer } = require('./customTracer');
const { MongoQuerySimplifier } = require('./mongoQuerySimplifier');
const { RethrownError } = require('./rethrownError');
const {
    SearchFilterFromReference
} = require('../operations/query/filters/searchFilterFromReference');
const { ReferenceParser } = require('./referenceParser');
const { QueryItem } = require('../operations/graph/queryItem');
const { ForbiddenError } = require('./httpErrors');
const {
    CONSENT_OF_LINKED_PERSON_INDEX,
    PERSON_PROXY_PREFIX,
    SENSITIVE_CATEGORY,
    CONSENT_CATEGORY
} = require('../constants');
const { dateQueryBuilder } = require('./querybuilder.util');
const { isUuid, generateUUIDv5 } = require('./uid.util');
const { logWarn } = require('../operations/common/logging');

/**
 * @typedef DelegatedAccessFilteringRules
 * @property {string} consentId - ID of the consent resource
 * @property {string} consentVersion - Version of the consent resource
 * @property {string | null} provisionPeriodStart - Start date of the provision period
 * @property {string | null} provisionPeriodEnd - End date of the provision period
 * @property {string[]} deniedSensitiveCategories - List of sensitive categories denied
 */

/**
 * Manager for handling filtering rules for delegated actors
 */
class DelegatedAccessRulesManager {
    /**
     * @param {Object} params
     * @param {ConfigManager} params.configManager
     * @param {DatabaseQueryFactory} params.databaseQueryFactory
     * @param {CustomTracer} params.customTracer
     */
    constructor({ configManager, databaseQueryFactory, customTracer }) {
        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);

        /**
         * @type {DatabaseQueryFactory}
         */
        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);

        /**
         * @type {CustomTracer}
         */
        this.customTracer = customTracer;
        assertTypeEquals(customTracer, CustomTracer);
    }

    /**
     * Returns the filtering rules for a delegated actor.
     * filteringRules as null represents no consent found.
     *
     * @param {Object} params
     * @param {string} params.base_version
     * @param {import('./fhirRequestInfo').JwtActor} params.actor
     * @param {string} params.personIdFromJwtToken
     * @param {boolean} params._debug
     *
     * @return {Promise<{
     *  filteringRules: DelegatedAccessFilteringRules | null,
     *  actorConsentQueries: QueryItem[],
     *  actorConsentQueryOptions: import('mongodb').FindOptions<import('mongodb').DefaultSchema>[]
     * }>}
     */
    async getFilteringRulesAsync({
        actor,
        personIdFromJwtToken,
        base_version = '4_0_0',
        _debug = false
    }) {
        assertIsValid(actor, 'Actor must be provided to get filtering rules');
        assertIsValid(personIdFromJwtToken, 'personIdFromJwtToken must be provided to get filtering rules');

        // Cache filtering rules on the actor object (request-scoped, same instance throughout).
        // If _debug is enabled, force a fresh DB fetch (no cache read).
        if (!_debug && actor._filteringRules !== undefined) {
            return {
                filteringRules: actor._filteringRules,
                actorConsentQueries: [],
                actorConsentQueryOptions: []
            };
        }

        const actorReference = actor.reference;

        // RFC: Delegated Token Generation for Client-Initiated Access (DCON-5236/DCON-5395).
        // An Organization-actor delegated token has no per-person Consent to fetch by design --
        // BIG already verifies Person ownership and an org-level Consent before minting the
        // token, and that org-level Consent has no `patient` field at all (it authorizes the
        // Organization generally, not a specific person), so it can never satisfy this query's
        // patient-match filter below. Skip the lookup entirely for this actor type rather than
        // re-deriving a per-person consent that was never meant to exist -- fhir-server trusts
        // BIG's mint-time verification here, the same way it trusts every other signed JWT claim.
        if (ReferenceParser.parseReference(actorReference).resourceType === 'Organization') {
            const filteringRules = {
                consentId: null,
                consentVersion: null,
                provisionPeriodStart: null,
                provisionPeriodEnd: null
            };
            Object.defineProperty(filteringRules, 'deniedSensitiveCategories', {
                value: [],
                enumerable: false
            });
            actor._filteringRules = filteringRules;
            return {
                filteringRules,
                actorConsentQueries: [],
                actorConsentQueryOptions: []
            };
        }

        const filteringRulesObj = await this.customTracer.trace({
            name: 'DelegatedAccessRulesManager.getFilteringRulesAsync',
            func: async () => {
                // Fetch Consent resources from database
                const { consentResources, queryItem, options } =
                    await this.fetchConsentResourcesAsync({
                        personIdFromJwtToken,
                        actorReference,
                        base_version,
                        _debug
                    });

                // No consent found - deny access
                if (consentResources.length === 0) {
                    return {
                        filteringRules: null,
                        actorConsentQueries: [queryItem],
                        actorConsentQueryOptions: [options]
                    };
                }

                // Multiple consents found - ambiguous, deny access for safety
                if (consentResources.length > 1) {
                    throw new ForbiddenError(
                        `ambiguous permissions found for the actor ${actorReference}`
                    );
                }

                // Parse the single consent resource to extract filtering rules
                const consent = consentResources[0];
                const filteringRules = this.parseConsentFilteringRules({ consent });
                return {
                    filteringRules,
                    actorConsentQueries: [queryItem],
                    actorConsentQueryOptions: [options]
                };
            }
        });

        actor._filteringRules = filteringRulesObj.filteringRules;

        return filteringRulesObj;
    }



    /**
     * Parses a Consent resource to extract filtering rules
     * @param {Object} params
     * @param {Object} params.consent - The Consent resource
     * @returns {DelegatedAccessFilteringRules}
     */
    parseConsentFilteringRules({ consent }) {
        /**
         * @type {string[]}
         */
        const deniedSensitiveCategories = [];

        // Extract denied sensitive categories from nested provisions
        if (consent.provision?.provision && Array.isArray(consent.provision.provision)) {
            const lowerSensitiveCategoryId = SENSITIVE_CATEGORY.SYSTEM.toLowerCase();
            for (const nestedProvision of consent.provision.provision) {
                if (nestedProvision.type === 'deny' && nestedProvision.securityLabel) {
                    const labels = Array.isArray(nestedProvision.securityLabel)
                        ? nestedProvision.securityLabel
                        : [nestedProvision.securityLabel];
                    for (const securityLabel of labels) {
                        if (securityLabel.code && securityLabel.system &&
                            // match with case insensitive
                            securityLabel.system.toLowerCase() === lowerSensitiveCategoryId) {
                            deniedSensitiveCategories.push(securityLabel.code);
                        }
                    }
                }
            }
        }

        const rules = {
            consentId: consent._uuid,
            consentVersion: consent.meta?.versionId,
            provisionPeriodStart: consent.provision?.period?.start,
            provisionPeriodEnd: consent.provision?.period?.end
        };
        // Store it as non-enumerable to avoid logging
        Object.defineProperty(rules, 'deniedSensitiveCategories', {
            value: deniedSensitiveCategories,
            enumerable: false
        });
        return rules;
    }

    /**
     * Fetches active Consent resources for the delegated actor
     * @param {Object} params
     * @param {string} params.personIdFromJwtToken
     * @param {string} params.actorReference
     * @param {string} params.base_version
     * @param {boolean} params._debug
     * @returns {Promise<{
     *  consentResources: Object[],
     *  queryItem: QueryItem,
     *  options: import('mongodb').FindOptions<import('mongodb').DefaultSchema>
     * }>}
     */
    async fetchConsentResourcesAsync({
        personIdFromJwtToken,
        actorReference,
        base_version,
        _debug = false
    }) {
        try {
            // Build patient reference filter
            const patientReferenceFilter = SearchFilterFromReference.buildFilter(
                [{ id: `${PERSON_PROXY_PREFIX}${personIdFromJwtToken}`, resourceType: 'Patient' }],
                'patient'
            );

            // Parse actor reference and build actor reference filter
            const {
                id: actorId,
                resourceType: actorResourceType,
                sourceAssigningAuthority: actorSourceAssigningAuthority
            } = ReferenceParser.parseReference(actorReference);

            assertIsValid(actorId, 'Actor reference must have an ID');
            assertIsValid(actorResourceType, 'Actor reference must have a resource type');
            const actorReferenceFilter = SearchFilterFromReference.buildFilter(
                [
                    {
                        id: actorId,
                        resourceType: actorResourceType,
                        sourceAssigningAuthority: actorSourceAssigningAuthority
                    }
                ],
                'provision.actor.reference'
            );

            const currDate = new Date().toISOString();
            /**
             * @type {import('mongodb').Document}
             */
            const query = {
                $and: [
                    // Consent must be active
                    { status: 'active' },
                    { $or: patientReferenceFilter },
                    { $or: actorReferenceFilter },
                    // Provision type must be permit
                    { 'provision.type': 'permit' },
                    {
                        'category.coding': {
                            $elemMatch: {
                                system: CONSENT_CATEGORY.DATA_SHARING_ACCESS.SYSTEM,
                                code: { $in: this.configManager.dataSharingAccessCodes }
                            }
                        }
                    },
                    // At least one of start or end must exist (FHIR period requires at least one)
                    {
                        $or: [
                            { 'provision.period.start': { $exists: true } },
                            { 'provision.period.end': { $exists: true } }
                        ]
                    },
                    // Period start must not be in the future OR not exist
                    {
                        $or: [
                            {
                                'provision.period.start': dateQueryBuilder({
                                    date: `le${currDate}`,
                                    type: 'dateTime'
                                })
                            },
                            { 'provision.period.start': { $exists: false } }
                        ]
                    },
                    // Period end must be in the future OR not exist
                    {
                        $or: [
                            {
                                'provision.period.end': dateQueryBuilder({
                                    date: `ge${currDate}`,
                                    type: 'dateTime'
                                })
                            },
                            { 'provision.period.end': { $exists: false } }
                        ]
                    }
                ]
            };

            const options = {
                projection: { _id: 0 }
            };

            // Simplify and optimize the query
            const simplifiedQuery = MongoQuerySimplifier.simplifyFilter({ filter: query });

            const databaseQueryManager = this.databaseQueryFactory.createQuery({
                resourceType: 'Consent',
                base_version
            });

            const cursor = await databaseQueryManager.findAsync({
                query: simplifiedQuery,
                options
            });

            // Set MongoDB timeout
            const maxMongoTimeMS = this.configManager.mongoTimeout;
            cursor.maxTimeMS({ milliSecs: maxMongoTimeMS });
            // can use custom index of status and patient id
            cursor.hint({
                indexHint: CONSENT_OF_LINKED_PERSON_INDEX
            });

            const collectionName = cursor.getCollection();

            /**
             * @type {import('mongodb').Document[]}
             */
            const explanations = _debug ? await cursor.explainAsync() : [];

            const consentResources = await cursor.toArrayAsync();

            const queryItem = new QueryItem({
                query: simplifiedQuery,
                resourceType: 'Consent',
                collectionName,
                explanations
            });

            return {
                consentResources,
                queryItem,
                options
            };
        } catch (error) {
            throw new RethrownError({
                message: `Error while fetching Consent resources for delegated actor: ${error.message}`,
                error,
                source: 'DelegatedAccessRulesManager.fetchConsentResourcesAsync',
                args: {
                    personIdFromJwtToken,
                    actorReference
                }
            });
        }
    }

    /**
     * Checks if a valid consent exists for the delegated actor
     * It also sets the consentPolicy on the actor if valid consent is found,
     * which can be used later in the request processing pipeline
     * @param {import('./fhirRequestInfo').JwtActor} actor
     * @param {string} personIdFromJwtToken
     * @param {string} [base_version] the FHIR version of the resource being requested;
     *  falls back to getFilteringRulesAsync's default when not supplied by the caller
     * @returns {Promise<boolean>}
     */
    async hasValidConsentAsync({ actor, personIdFromJwtToken, base_version }) {
        const result = await this.getFilteringRulesAsync({
            actor,
            personIdFromJwtToken,
            base_version
        });
        const filteringRules = result.filteringRules;
        if (!filteringRules) {
            return false;
        }
        const { consentId, consentVersion } = filteringRules;
        // set the actor policy -- only when there's an actual per-person Consent to point at.
        // An Organization actor's filteringRules carries no consentId (see getFilteringRulesAsync)
        // since there is no per-person Consent for this flow by design.
        if (consentId) {
            actor.consentPolicy = consentVersion
                ? `Consent/${consentId}?version=${consentVersion}`
                : `Consent/${consentId}`;
        }
        return true;
    }

    /**
     * Resolves the codes to surface as `purposeOfEvent.coding.code` on the AuditEvent from a
     * delegated actor's JWT `entitlements` claim.
     *
     * Two shapes are supported:
     * - Legacy: bare v3-ActReason codes (e.g. "FAMRQT") -- returned unchanged.
     * - DCON-5395: a `Consent/<id>` reference (minted by BIG's token-exchange flow for
     *   client-initiated access, DCON-5236), pointing at the org-level Consent created during
     *   client onboarding -- the Consent is dereferenced and its `provision.purpose` codes are
     *   substituted, so the audit event never carries a raw resource reference where an
     *   ActReason code belongs.
     *
     * Returns `null` if any `Consent/<id>` entitlement genuinely can't be resolved (not found,
     * or ambiguous) -- distinct from an empty array, which means every entitlement resolved
     * successfully but yielded no codes. The caller treats `null` as an authentication
     * failure: entitlements naming a Consent that can't be found is treated the same as any
     * other malformed/unverifiable claim, not silently downgraded to an empty `purposeOfEvent`
     * on an otherwise-successful request.
     *
     * Rejects (does not resolve to `null`) if the Consent lookup itself fails transiently (DB
     * timeout, network blip) -- see `resolveConsentPurposeCodesAsync`. Callers must let that
     * rejection propagate rather than catching it into `null`, so it surfaces as a retryable
     * error rather than a permanent auth failure.
     *
     * @param {Object} params
     * @param {string[]|null} [params.entitlements]
     * @param {string} [params.base_version]
     * @return {Promise<string[]|null>}
     */
    async resolvePurposeOfEventCodesAsync({ entitlements, base_version = '4_0_0' }) {
        if (!Array.isArray(entitlements) || entitlements.length === 0) {
            return entitlements ?? null;
        }

        const resolvedCodes = [];
        for (const entitlement of entitlements) {
            const { resourceType } = ReferenceParser.parseReference(entitlement);
            if (resourceType === 'Consent') {
                const purposeCodes = await this.resolveConsentPurposeCodesAsync({
                    consentReference: entitlement,
                    base_version
                });
                if (purposeCodes === null) {
                    return null;
                }
                resolvedCodes.push(...purposeCodes);
            } else {
                // Legacy shape: a bare v3-ActReason code, passed through unchanged.
                resolvedCodes.push(entitlement);
            }
        }
        return resolvedCodes;
    }

    /**
     * Dereferences a `Consent/<id>` reference and returns its `provision.purpose` codes.
     *
     * Returns `null` when the Consent genuinely can't be resolved -- deleted/wrong id, or
     * ambiguous (more than one Consent shares a bare, authority-less id; see below) -- `[]` is
     * reserved for "the Consent exists but has no `provision.purpose` codes," a distinct, more
     * benign case. Callers that fail closed on an unresolvable reference check for `null`.
     *
     * A transient lookup failure (DB timeout, network blip) is NOT treated as "not found" --
     * it's re-thrown with `isTransient`/`statusCode` set, mirroring this codebase's INC-322
     * convention for `getUserInfoFromUserInfoEndpoint`/JWKS failures elsewhere in
     * `authService.js`. `AuthService.processUserInfo` calls `verify()` runs this on every
     * request for an Organization-actor JWT (no cross-request caching), so conflating a
     * transient blip with "Consent doesn't exist" would turn a brief Mongo hiccup into a hard,
     * permanent-looking 401 for every request from that client instead of a retryable 503.
     *
     * @param {Object} params
     * @param {string} params.consentReference
     * @param {string} params.base_version
     * @return {Promise<string[]|null>}
     */
    async resolveConsentPurposeCodesAsync({ consentReference, base_version }) {
        try {
            const { id, sourceAssigningAuthority } = ReferenceParser.parseReference(consentReference);
            if (!id) {
                return null;
            }

            // Mirrors the by-reference lookup convention used elsewhere (e.g.
            // resourceValidator.validateNewPersonLinkTargetsBelongToCallersTenant): a reference
            // that names its target explicitly (UUID, or bare id + explicit authority) resolves
            // to exactly one resource by construction.
            let query;
            if (isUuid(id)) {
                query = { _uuid: id };
            } else if (sourceAssigningAuthority) {
                query = { _uuid: generateUUIDv5(`${id}|${sourceAssigningAuthority}`) };
            } else {
                query = { id };
            }

            const databaseQueryManager = this.databaseQueryFactory.createQuery({
                resourceType: 'Consent',
                base_version
            });
            const cursor = await databaseQueryManager.findAsync({ query });
            cursor.maxTimeMS({ milliSecs: this.configManager.mongoTimeout });
            const consents = await cursor.toArrayAsync();

            if (consents.length === 0) {
                logWarn(`Consent referenced by entitlements could not be resolved: ${consentReference}`, {
                    source: 'DelegatedAccessRulesManager.resolveConsentPurposeCodesAsync'
                });
                return null;
            }

            // A bare, authority-less id (the `else { query = { id } }` branch above) is
            // ambiguous across tenants by construction -- unlike the UUID/authority-qualified
            // branches, which resolve to exactly one resource. Never substitute an arbitrary
            // match's provision.purpose into this request's audit purposeOfEvent; fail closed
            // the same way getFilteringRulesAsync already does for an ambiguous per-person
            // Consent match, instead of picking whichever document Mongo returns first.
            if (consents.length > 1) {
                logWarn(`Consent referenced by entitlements is ambiguous (${consents.length} matches): ${consentReference}`, {
                    source: 'DelegatedAccessRulesManager.resolveConsentPurposeCodesAsync'
                });
                return null;
            }

            const [consent] = consents;
            const purposeCodings = consent.provision?.purpose;
            return Array.isArray(purposeCodings)
                ? purposeCodings.map(coding => coding?.code).filter(Boolean)
                : [];
        } catch (error) {
            logWarn(`Error resolving Consent referenced by entitlements: ${consentReference}`, {
                source: 'DelegatedAccessRulesManager.resolveConsentPurposeCodesAsync',
                error
            });
            error.isTransient = true;
            if (!error.statusCode) {
                error.statusCode = 503;
            }
            throw error;
        }
    }
}

module.exports = {
    DelegatedAccessRulesManager
};
