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
    HTTP_CONTEXT_KEYS,
    CONSENT_CATEGORY
} = require('../constants');
const { dateQueryBuilder } = require('./querybuilder.util');
const httpContext = require('express-http-context');

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
        const actorReference = actor.reference;
        const cacheKey = `${HTTP_CONTEXT_KEYS.DELEGATED_ACTOR_FILTERING_RULES_PREFIX}${base_version}-${personIdFromJwtToken}-${actorReference}`;

        // If _debug is enabled, force a fresh DB fetch (no cache read).
        // Still cache the computed filteringRules so subsequent non-debug code paths can reuse it.
        if (!_debug) {
            /**
             * @type {DelegatedAccessFilteringRules | null | undefined}
             */
            const cachedFilteringRulesObj = httpContext.get(cacheKey);
            if (cachedFilteringRulesObj !== undefined) {
                return {
                    filteringRules: cachedFilteringRulesObj,
                    actorConsentQueries: [],
                    actorConsentQueryOptions: []
                };
            }

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

        // Cache in httpContext for same-request reuse
        httpContext.set(cacheKey, filteringRulesObj.filteringRules);

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
                    for (const securityLabel of nestedProvision.securityLabel) {
                        if (securityLabel.code && securityLabel.system &&
                            // match with case insensitive
                            securityLabel.system.toLowerCase() === lowerSensitiveCategoryId) {
                            deniedSensitiveCategories.push(securityLabel.code);
                        }
                    }
                }
            }
        }

        return {
            consentId: consent._uuid,
            consentVersion: consent.meta?.versionId,
            provisionPeriodStart: consent.provision?.period?.start,
            provisionPeriodEnd: consent.provision?.period?.end,
            deniedSensitiveCategories
        };
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
     * @returns {Promise<boolean>}
     */
    async hasValidConsentAsync({ actor, personIdFromJwtToken }) {
        const result = await this.getFilteringRulesAsync({
            actor,
            personIdFromJwtToken
        });
        const filteringRules = result.filteringRules;
        if (!filteringRules) {
            return false;
        }
        const { consentId, consentVersion } = filteringRules;
        // set the actor policy
        actor.consentPolicy = `Consent/${consentId}?version=${consentVersion}`;
        return true;
    }
}

module.exports = {
    DelegatedAccessRulesManager
};
