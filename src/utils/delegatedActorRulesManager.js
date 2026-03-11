const { assertTypeEquals, assertIsValid } = require('./assertType');
const { ConfigManager } = require('./configManager');
const { DatabaseQueryFactory } = require('../dataLayer/databaseQueryFactory');
const { FilteringRulesCacheKeyGenerator } = require('./filteringRulesCacheKeyGenerator');
const { RedisManager } = require('./redisManager');
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
    HTTP_CONTEXT_KEYS
} = require('../constants');
const { dateQueryBuilder } = require('./querybuilder.util');
const { logError } = require('../operations/common/logging');
const httpContext = require('express-http-context');

/**
 * @typedef DelegatedActorFilteringRules
 * @property {string} consentId - ID of the consent resource
 * @property {string | null} consentVersion - Version of the consent resource
 * @property {string | null} provisionPeriodStart - Start date of the provision period
 * @property {string | null} provisionPeriodEnd - End date of the provision period
 * @property {string[]} deniedSensitiveCategories - List of sensitive categories denied
 */

/**
 * Manager for handling filtering rules for delegated actors
 */
class DelegatedActorRulesManager {
    /**
     * @param {Object} params
     * @param {ConfigManager} params.configManager
     * @param {DatabaseQueryFactory} params.databaseQueryFactory
     * @param {FilteringRulesCacheKeyGenerator} params.filteringRulesCacheKeyGenerator
     * @param {RedisManager} params.redisManager
     * @param {CustomTracer} params.customTracer
     */
    constructor({ configManager, databaseQueryFactory, filteringRulesCacheKeyGenerator, redisManager, customTracer }) {
        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);

        /**
         * @type {FilteringRulesCacheKeyGenerator}
         */
        this.filteringRulesCacheKeyGenerator = filteringRulesCacheKeyGenerator;
        assertTypeEquals(filteringRulesCacheKeyGenerator, FilteringRulesCacheKeyGenerator);

        /**
         * @type {RedisManager}
         */
        this.redisManager = redisManager;
        assertTypeEquals(redisManager, RedisManager);

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
     * If no delegated actor present, then return null.
     * If delegated actor doesn't have valid consent, then return empty filtering results.
     * filteringRules as null represents no consent found.
     *
     * @param {Object} params
     * @param {string} params.base_version
     * @param {string | null} params.delegatedActor
     * @param {string} params.personIdFromJwtToken
     * @param {boolean} params._debug
     *
     * @return {Promise<{
     *  filteringRules: DelegatedActorFilteringRules | null,
     *  actorConsentQueries: QueryItem[],
     *  actorConsentQueryOptions: import('mongodb').FindOptions<import('mongodb').DefaultSchema>[]
     * } | null>}
     */
    async getFilteringRulesAsync({
        delegatedActor,
        personIdFromJwtToken,
        base_version = '4_0_0',
        _debug = false
    }) {
        if (!this.isUserDelegatedActor({ delegatedActor })) {
            return null;
        }

        assertIsValid(personIdFromJwtToken, 'personIdFromJwtToken is required');
        assertIsValid(delegatedActor, 'delegatedActor is required');
        const cacheKey = `${HTTP_CONTEXT_KEYS.DELEGATED_ACTOR_FILTERING_RULES_PREFIX}${base_version}-${personIdFromJwtToken}-${delegatedActor}`;

        // If _debug is enabled, force a fresh DB fetch (no cache read).
        // Still cache the computed filteringRules so subsequent non-debug code paths can reuse it.
        if (!_debug) {
            /**
             * @type {DelegatedActorFilteringRules | null | undefined}
             */
            const cachedFilteringRulesObj = httpContext.get(cacheKey);
            if (cachedFilteringRulesObj !== undefined) {
                return {
                    filteringRules: cachedFilteringRulesObj,
                    actorConsentQueries: [],
                    actorConsentQueryOptions: []
                };
            }

            // Check Redis cache (generation-based key)
            const redisCacheKey = await this.filteringRulesCacheKeyGenerator.generateCacheKeyAsync(
                personIdFromJwtToken, delegatedActor
            );
            if (redisCacheKey) {
                try {
                    const redisFilteringRules = await this.redisManager.readBundleFromCacheAsync(redisCacheKey);
                    if (redisFilteringRules) {
                        httpContext.set(cacheKey, redisFilteringRules);
                        this._setConsentPolicyInContext(redisFilteringRules);
                        return {
                            filteringRules: redisFilteringRules,
                            actorConsentQueries: [],
                            actorConsentQueryOptions: []
                        };
                    }
                } catch (error) {
                    logError('Error reading filtering rules from Redis cache', { error });
                }
            }
        }

        const filteringRulesObj = await this.customTracer.trace({
            name: 'DelegatedActorRulesManager.getFilteringRulesAsync',
            func: async () => {
                // Fetch Consent resources from database
                const { consentResources, queryItem, options } =
                    await this.fetchConsentResourcesAsync({
                        personIdFromJwtToken,
                        delegatedActor,
                        base_version,
                        _debug
                    });

                // No consent found - deny access
                if (!consentResources || consentResources.length === 0) {
                    return {
                        filteringRules: null,
                        actorConsentQueries: [queryItem],
                        actorConsentQueryOptions: [options]
                    };
                }

                // Multiple consents found - ambiguous, deny access for safety
                if (consentResources.length > 1) {
                    throw new ForbiddenError(
                        `ambiguous permissions found for the actor ${delegatedActor}`
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

        // Cache in Redis for cross-request reuse
        if (filteringRulesObj.filteringRules) {
            this._setConsentPolicyInContext(filteringRulesObj.filteringRules);
            const redisCacheKey = await this.filteringRulesCacheKeyGenerator.generateCacheKeyAsync(
                personIdFromJwtToken, delegatedActor
            );
            if (redisCacheKey) {
                try {
                    await this.redisManager.writeBundleAsync(redisCacheKey, filteringRulesObj.filteringRules);
                } catch (error) {
                    logError('Error writing filtering rules to Redis cache', { error });
                }
            }
        }

        return filteringRulesObj;
    }

    /**
     * Stores the consent policy URI in httpContext for audit logging
     * @param {DelegatedActorFilteringRules} filteringRules
     * @private
     */
    _setConsentPolicyInContext(filteringRules) {
        const { consentId, consentVersion } = filteringRules;
        const consentPolicy = consentVersion
            ? `Consent/${consentId}?version=${consentVersion}`
            : `Consent/${consentId}`;
        httpContext.set(HTTP_CONTEXT_KEYS.DELEGATED_ACTOR_CONSENT_POLICY, consentPolicy);
    }

    /**
     * Parses a Consent resource to extract filtering rules
     * @param {Object} params
     * @param {Object} params.consent - The Consent resource
     * @returns {DelegatedActorFilteringRules}
     */
    parseConsentFilteringRules({ consent }) {
        /**
         * @type {string[]}
         */
        const deniedSensitiveCategories = [];

        // Extract denied sensitive categories from nested provisions
        if (consent.provision?.provision && Array.isArray(consent.provision.provision)) {
            const sensitiveCategoryIdentifier = this.configManager.sensitiveCategorySystemIdentifier;
            for (const nestedProvision of consent.provision.provision) {
                if (nestedProvision.type === 'deny' && nestedProvision.securityLabel) {
                    for (const securityLabel of nestedProvision.securityLabel) {
                        if (securityLabel.code && securityLabel.system &&
                            // match with case insensitive
                            securityLabel.system.toLowerCase() === sensitiveCategoryIdentifier.toLowerCase()) {
                            deniedSensitiveCategories.push(securityLabel.code);
                        }
                    }
                }
            }
        }

        return {
            consentId: consent.id,
            consentVersion: consent.meta?.versionId || null,
            provisionPeriodStart: consent.provision?.period?.start || null,
            provisionPeriodEnd: consent.provision?.period?.end || null,
            deniedSensitiveCategories
        };
    }

    /**
     * Fetches active Consent resources for the delegated actor
     * @param {Object} params
     * @param {string} params.personIdFromJwtToken
     * @param {string} params.delegatedActor
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
        delegatedActor,
        base_version,
        _debug = false
    }) {
        try {
            // Build patient reference filter
            const patientReferenceFilter = SearchFilterFromReference.buildFilter(
                [{ id: `${PERSON_PROXY_PREFIX}${personIdFromJwtToken}`, resourceType: 'Patient' }],
                'patient'
            );

            // Parse delegatedActor reference and build actor reference filter
            const {
                id: actorId,
                resourceType: actorResourceType,
                sourceAssigningAuthority: actorSourceAssigningAuthority
            } = ReferenceParser.parseReference(delegatedActor);

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
                source: 'DelegatedActorRulesManager.fetchConsentResourcesAsync',
                args: {
                    personIdFromJwtToken,
                    delegatedActor
                }
            });
        }
    }

    /**
     * Checks if a valid consent exists for the delegated actor
     * @param {string} delegatedActor
     * @param {string} personIdFromJwtToken
     * @param {string} base_version
     * @returns {Promise<boolean>}
     */
    async hasValidConsentAsync({ delegatedActor, personIdFromJwtToken, base_version }) {
        const result = await this.getFilteringRulesAsync({
            delegatedActor,
            personIdFromJwtToken,
            base_version
        });
        // null means not a delegated actor — no consent needed
        if (result === null) {
            return true;
        }
        // filteringRules is null when no consent found
        return result.filteringRules !== null;
    }

    /**
     * Check if the user is a delegated actor
     * @param {Object} params
     * @param {string | null} params.delegatedActor
     * @returns {boolean}
     */
    isUserDelegatedActor({ delegatedActor }) {
        return this.configManager.enableDelegatedAccessFiltering && !!delegatedActor;
    }
}

module.exports = {
    DelegatedActorRulesManager
};
