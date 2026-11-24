const { assertTypeEquals, assertIsValid } = require('./assertType');
const { ConfigManager } = require('./configManager');
const { DatabaseQueryFactory } = require('../dataLayer/databaseQueryFactory');
const { CustomTracer } = require('./customTracer');
const { ReferenceParser } = require('./referenceParser');
const { QueryItem } = require('../operations/graph/queryItem');
const {
    PERSON_PROXY_PREFIX,
    SENSITIVE_CATEGORY,
    CONSENT_CATEGORY
} = require('../constants');
const { isUuid, generateUUIDv5 } = require('./uid.util');
const { logWarn } = require('../operations/common/logging');
const { SecurityTagSystem } = require('./securityTagSystem');

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
     * Returns the filtering rules for a delegated actor. For a RelatedPerson actor, reads the
     * Consent named in its `entitlements` by id and checks it against the token.
     * filteringRules as null means the Consent was refused.
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

        // An Organization actor's Consent is org-level (no `patient` field), so it can never
        // pass the grantor check below. Skip the lookup and trust the login-time check.
        if (actor.isOrganizationActor === true) {
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

        // A RelatedPerson actor's Consent is the one named in its `entitlements`. Any failed
        // check is logged and returns `filteringRules: null`.
        const refuse = ({ consentReference, actorConsentQueries = [] }) => {
            logWarn('Delegated Consent refused', {
                source: 'DelegatedAccessRulesManager.getFilteringRulesAsync',
                args: { consentReference }
            });
            return { filteringRules: null, actorConsentQueries, actorConsentQueryOptions: [] };
        };

        const filteringRulesObj = await this.customTracer.trace({
            name: 'DelegatedAccessRulesManager.getFilteringRulesAsync',
            func: async () => {
                const entitlements = Array.isArray(actor.entitlements) ? actor.entitlements : [];
                const consentReferences = entitlements.filter(
                    (entitlement) => typeof entitlement === 'string' &&
                        ReferenceParser.parseReference(entitlement).resourceType === 'Consent'
                );
                if (consentReferences.length !== 1) {
                    return refuse({ consentReference: null });
                }

                const [consentReference] = consentReferences;
                // Only a uuid id is read; a sourceId or an id with an authority is refused.
                const { id, sourceAssigningAuthority } = ReferenceParser.parseReference(consentReference);
                if (!isUuid(id) || sourceAssigningAuthority) {
                    return refuse({ consentReference });
                }

                const { consents, queryItem } = await this.findConsentByReferenceAsync({
                    consentReference,
                    base_version,
                    _debug
                });
                const actorConsentQueries = queryItem ? [queryItem] : [];

                if (consents.length !== 1) {
                    return refuse({ consentReference, actorConsentQueries });
                }

                const [consent] = consents;
                if (!this.consentGrantsAccess({
                    consent,
                    actorReference: actor.reference,
                    personIdFromJwtToken,
                    now: new Date()
                })) {
                    return refuse({ consentReference, actorConsentQueries });
                }

                return {
                    filteringRules: this.parseConsentFilteringRules({ consent }),
                    actorConsentQueries,
                    actorConsentQueryOptions: []
                };
            }
        });

        actor._filteringRules = filteringRulesObj.filteringRules;

        return filteringRulesObj;
    }

    /**
     * Whether a stored (server-enriched) reference points at `reference`. Matches the same
     * fields SearchFilterFromReference.buildFilter queries: `_uuid` for a uuid id,
     * `_sourceId` + `_sourceAssigningAuthority` for an id with an authority, else `_sourceId`.
     * @param {Object|undefined} storedReference
     * @param {string} reference
     * @return {boolean}
     */
    static referenceMatches(storedReference, reference) {
        if (!storedReference || typeof reference !== 'string') {
            return false;
        }
        const { id, resourceType, sourceAssigningAuthority } = ReferenceParser.parseReference(reference);
        if (!id || !resourceType) {
            return false;
        }
        const typedId = `${resourceType}/${id}`;
        if (isUuid(id)) {
            return storedReference._uuid === typedId;
        }
        if (sourceAssigningAuthority) {
            return storedReference._sourceId === typedId &&
                storedReference._sourceAssigningAuthority === sourceAssigningAuthority;
        }
        return storedReference._sourceId === typedId;
    }

    /**
     * Checks a Consent against the delegated token. Returns true when the Consent grants
     * access. An unparseable period date fails its check.
     * @param {Object} params
     * @param {Object} params.consent
     * @param {string} params.actorReference - `act.reference` from the token
     * @param {string} params.personIdFromJwtToken - the grantor (`clientFhirPersonId`)
     * @param {Date} params.now
     * @return {boolean}
     */
    consentGrantsAccess({ consent, actorReference, personIdFromJwtToken, now }) {
        if (consent.status !== 'active') {
            return false;
        }
        if (consent.provision?.type !== 'permit') {
            return false;
        }
        const allowedCategoryCodes = this.configManager.dataSharingAccessCodes;
        const hasAllowedCategory = (consent.category || []).some(
            (category) => (category?.coding || []).some(
                (coding) => coding?.system === CONSENT_CATEGORY.DATA_SHARING_ACCESS.SYSTEM &&
                    allowedCategoryCodes.includes(coding.code)
            )
        );
        if (!hasAllowedCategory) {
            return false;
        }
        // A present but empty or unparseable date fails its check, as the old `$exists` query did.
        const { start, end } = consent.provision.period || {};
        if (start === undefined && end === undefined) {
            return false;
        }
        if (start !== undefined && !(Date.parse(start) <= now.getTime())) {
            return false;
        }
        if (end !== undefined && !(Date.parse(end) >= now.getTime())) {
            return false;
        }
        if (!DelegatedAccessRulesManager.referenceMatches(
            consent.patient,
            `Patient/${PERSON_PROXY_PREFIX}${personIdFromJwtToken}`
        )) {
            return false;
        }
        const consentActors = Array.isArray(consent.provision.actor) ? consent.provision.actor : [];
        if (!consentActors.some(
            (consentActor) => DelegatedAccessRulesManager.referenceMatches(consentActor?.reference, actorReference)
        )) {
            return false;
        }
        return true;
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
        // Only set when there's a real per-person Consent (Organization actors have none).
        if (consentId) {
            actor.consentPolicy = consentVersion
                ? `Consent/${consentId}?version=${consentVersion}`
                : `Consent/${consentId}`;
        }
        return true;
    }

    /**
     * Resolves `purposeOfEvent.coding.code` from a JWT `entitlements` claim: a bare
     * v3-ActReason code passes through unchanged; a `Consent/<id>` reference is dereferenced
     * into the Consent's `provision.purpose` codes.
     *
     * Returns `null` if a Consent reference can't be resolved (not found/ambiguous) -- callers
     * treat that as an auth failure. Rejects instead of returning `null` on a transient lookup
     * error (see resolveEntitlementConsentAsync); callers must let that propagate.
     *
     * When `actor` is an Organization actor and a Consent is resolved, sets `actor.allowedConnectionTypes` to the
     * union of the Consents' `connectionType` securityLabel codes. It is `[]` (no data) when no
     * Consent lists a connection type or any label is malformed.
     *
     * @param {Object} params
     * @param {string[]|null} [params.entitlements]
     * @param {string} [params.base_version]
     * @param {import('./fhirRequestInfo').JwtActor} [params.actor]
     * @return {Promise<string[]|null>}
     */
    async resolvePurposeOfEventCodesAsync({ entitlements, base_version = '4_0_0', actor }) {
        if (!Array.isArray(entitlements) || entitlements.length === 0) {
            return entitlements ?? null;
        }

        const resolvedCodes = [];
        /** @type {Set<string>|undefined} */
        let allowedConnectionTypes;
        let hasMalformedConnectionType = false;
        for (const entitlement of entitlements) {
            const { resourceType } = ReferenceParser.parseReference(entitlement);
            if (resourceType === 'Consent') {
                const resolved = await this.resolveEntitlementConsentAsync({
                    consentReference: entitlement,
                    base_version
                });
                if (resolved === null) {
                    return null;
                }
                resolvedCodes.push(...resolved.purposeCodes);
                allowedConnectionTypes ??= new Set();
                if (resolved.connectionTypes) {
                    resolved.connectionTypes.codes.forEach(code => allowedConnectionTypes.add(code));
                    hasMalformedConnectionType ||= resolved.connectionTypes.malformed;
                }
            } else {
                // Legacy shape: a bare v3-ActReason code, passed through unchanged.
                resolvedCodes.push(entitlement);
            }
        }
        // Connection-type restriction applies to Organization actors only.
        if (actor?.isOrganizationActor === true && allowedConnectionTypes) {
            actor.allowedConnectionTypes = hasMalformedConnectionType ? [] : [...allowedConnectionTypes];
        }
        return resolvedCodes;
    }

    /**
     * Extracts `provision.securityLabel` codings with the connectionType system.
     * `null` = the Consent doesn't restrict connection types. `malformed` = at least one
     * connectionType label has no usable code.
     *
     * @param {Object} params
     * @param {Object} params.consent
     * @return {{ codes: string[], malformed: boolean } | null}
     */
    parseConnectionTypeLabels({ consent }) {
        const securityLabel = consent.provision?.securityLabel;
        if (!securityLabel) {
            return null;
        }
        const labels = Array.isArray(securityLabel) ? securityLabel : [securityLabel];
        const connectionTypeSystem = SecurityTagSystem.connectionType.toLowerCase();
        const connectionTypeLabels = labels.filter(
            label => typeof label?.system === 'string' && label.system.toLowerCase() === connectionTypeSystem
        );
        if (connectionTypeLabels.length === 0) {
            return null;
        }
        const codes = connectionTypeLabels
            .map(label => label.code)
            .filter(code => typeof code === 'string' && code.length > 0);
        const malformed = codes.length !== connectionTypeLabels.length;
        if (malformed) {
            logWarn('Consent connectionType securityLabel is malformed; denying connection-typed access', {
                source: 'DelegatedAccessRulesManager.parseConnectionTypeLabels',
                args: { consentId: consent._uuid }
            });
        }
        return { codes, malformed };
    }

    /**
     * Dereferences a `Consent/<id>` reference and returns its `provision.purpose` codes and
     * `connectionType` securityLabels.
     *
     * `null` = can't resolve (not found, or ambiguous bare-id match) -- distinct from empty
     * `purposeCodes` (found, no purpose codes). Rethrows transient lookup errors (isTransient/503
     * convention) instead of conflating them with "not found".
     *
     * @param {Object} params
     * @param {string} params.consentReference
     * @param {string} params.base_version
     * @return {Promise<{ purposeCodes: string[], connectionTypes: { codes: string[], malformed: boolean } | null } | null>}
     */
    async resolveEntitlementConsentAsync({ consentReference, base_version }) {
        return await this.customTracer.trace({
            name: 'DelegatedAccessRulesManager.resolveEntitlementConsentAsync',
            func: async () => {
                const { consents } = await this.findConsentByReferenceAsync({
                    consentReference,
                    base_version
                });

                if (consents.length === 0) {
                    logWarn(`Consent referenced by entitlements could not be resolved: ${consentReference}`, {
                        source: 'DelegatedAccessRulesManager.resolveEntitlementConsentAsync'
                    });
                    return null;
                }

                // Bare, authority-less id is ambiguous across tenants -- never substitute an
                // arbitrary match's purpose codes; fail closed like getFilteringRulesAsync does.
                if (consents.length > 1) {
                    logWarn(`Consent referenced by entitlements is ambiguous (${consents.length} matches): ${consentReference}`, {
                        source: 'DelegatedAccessRulesManager.resolveEntitlementConsentAsync'
                    });
                    return null;
                }

                const [consent] = consents;
                const purposeCodings = consent.provision?.purpose;
                return {
                    purposeCodes: Array.isArray(purposeCodings)
                        ? purposeCodings.map(coding => coding?.code).filter(Boolean)
                        : [],
                    connectionTypes: this.parseConnectionTypeLabels({ consent })
                };
            }
        });
    }

    /**
     * Reads the Consent a `Consent/<id>` reference names: a uuid id by `_uuid`, an id with a
     * sourceAssigningAuthority by its deterministic uuid, any other id by `_sourceId` (which
     * can match more than one tenant's Consent). A reference with no id matches nothing.
     *
     * Rethrows a lookup error marked transient (isTransient, statusCode 503 unless already
     * set) so callers surface a 503 instead of treating it as "not found".
     *
     * @param {Object} params
     * @param {string} params.consentReference
     * @param {string} params.base_version
     * @param {boolean} [params._debug] include the query plan in the returned QueryItem
     * @return {Promise<{ consents: Object[], queryItem: QueryItem|null }>}
     */
    async findConsentByReferenceAsync({ consentReference, base_version, _debug = false }) {
        const { id, sourceAssigningAuthority } = ReferenceParser.parseReference(consentReference);
        if (!id) {
            return { consents: [], queryItem: null };
        }

        let query;
        if (isUuid(id)) {
            query = { _uuid: id };
        } else if (sourceAssigningAuthority) {
            query = { _uuid: generateUUIDv5(`${id}|${sourceAssigningAuthority}`) };
        } else {
            query = { _sourceId: id };
        }

        try {
            const databaseQueryManager = this.databaseQueryFactory.createQuery({
                resourceType: 'Consent',
                base_version
            });
            const cursor = await databaseQueryManager.findAsync({ query });
            cursor.maxTimeMS({ milliSecs: this.configManager.mongoTimeout });
            const explanations = _debug ? await cursor.explainAsync() : [];
            const consents = await cursor.toArrayAsync();
            const queryItem = new QueryItem({
                query,
                resourceType: 'Consent',
                collectionName: cursor.getCollection?.(),
                explanations
            });
            return { consents, queryItem };
        } catch (error) {
            logWarn(`Error resolving Consent referenced by entitlements: ${consentReference}`, {
                source: 'DelegatedAccessRulesManager.findConsentByReferenceAsync',
                error
            });
            // A new error with a generic message: the REST error handler sends a non-500 message
            // to the caller, and the driver's text must not reach it. The data layer wraps driver
            // errors in RethrownError, which defaults to 500; a lookup failure is retriable, so
            // surface 503. A specific status (e.g. 429) stays.
            const transientError = new Error('Consent lookup temporarily unavailable', { cause: error });
            transientError.isTransient = true;
            transientError.statusCode =
                !error.statusCode || error.statusCode === 500 ? 503 : error.statusCode;
            throw transientError;
        }
    }
}

module.exports = {
    DelegatedAccessRulesManager
};
