/**
 * Subscription Matcher
 * Matches FHIR resources against Subscription criteria to determine if notifications should be sent
 */
const { assertTypeEquals, assertIsValid } = require('../utils/assertType');
const { getLogger } = require('../winstonInit');
const { DatabaseQueryFactory } = require('../dataLayer/databaseQueryFactory');
const { FhirResourceCreator } = require('../fhir/fhirResourceCreator');
const { ConfigManager } = require('../utils/configManager');
const { NestedPropertyReader } = require('../utils/nestedPropertyReader');

const logger = getLogger();

/**
 * @typedef {Object} SubscriptionCriteria
 * @property {string} subscriptionId - Subscription resource ID
 * @property {string} topicUrl - SubscriptionTopic canonical URL
 * @property {string[]} resourceTypes - Resource types to match
 * @property {string[]} triggerTypes - Event types: 'create', 'update', 'delete'
 * @property {Object[]} filterCriteria - Array of filter conditions
 * @property {string} channelType - Channel type (e.g., 'sse', 'rest-hook')
 * @property {string} status - Subscription status
 */

/**
 * @typedef {Object} MatchResult
 * @property {boolean} matches - Whether the resource matches the subscription
 * @property {string} subscriptionId - Subscription ID
 * @property {string} reason - Reason for match/no-match
 */

class SubscriptionMatcher {
    /**
     * @param {Object} params
     * @param {DatabaseQueryFactory} params.databaseQueryFactory
     * @param {ConfigManager} params.configManager
     */
    constructor({ databaseQueryFactory, configManager }) {
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
         * Cache of active subscription criteria
         * @type {Map<string, SubscriptionCriteria>}
         */
        this._subscriptionCache = new Map();

        /**
         * Last cache refresh time
         * @type {Date|null}
         */
        this._lastCacheRefresh = null;

        /**
         * Cache TTL in milliseconds
         * @type {number}
         */
        this._cacheTtlMs = 60000; // 1 minute
    }

    /**
     * Refresh the subscription cache from the database
     * @returns {Promise<void>}
     */
    async refreshCacheAsync() {
        try {
            const databaseQueryManager = this.databaseQueryFactory.createQuery({
                resourceType: 'Subscription',
                base_version: '4_0_0'
            });

            // Query for active SSE subscriptions
            const cursor = await databaseQueryManager.findAsync({
                query: {
                    status: 'active',
                    'channel.type': { $in: ['sse', 'server-sent-events', 'message'] }
                },
                options: {}
            });

            const subscriptions = await cursor.toArrayAsync();
            this._subscriptionCache.clear();

            for (const sub of subscriptions) {
                const criteria = this._parseSubscriptionCriteria(sub);
                if (criteria) {
                    this._subscriptionCache.set(sub.id || sub._id, criteria);
                }
            }

            this._lastCacheRefresh = new Date();

            logger.info('SubscriptionMatcher: Cache refreshed', {
                activeSubscriptions: this._subscriptionCache.size
            });
        } catch (error) {
            logger.error('SubscriptionMatcher: Error refreshing cache', {
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Parse subscription resource into criteria object
     * @param {Object} subscription - FHIR Subscription resource
     * @returns {SubscriptionCriteria|null}
     * @private
     */
    _parseSubscriptionCriteria(subscription) {
        try {
            const criteria = {
                subscriptionId: subscription.id || subscription._id,
                topicUrl: subscription.topic || subscription.criteria,
                resourceTypes: [],
                triggerTypes: ['create', 'update', 'delete'], // Default to all
                filterCriteria: [],
                channelType: subscription.channel?.type || 'sse',
                status: subscription.status
            };

            // Parse filterBy criteria (R5 style)
            if (subscription.filterBy && Array.isArray(subscription.filterBy)) {
                for (const filter of subscription.filterBy) {
                    if (filter.resourceType) {
                        if (!criteria.resourceTypes.includes(filter.resourceType)) {
                            criteria.resourceTypes.push(filter.resourceType);
                        }
                    }

                    if (filter.filterParameter && filter.value) {
                        criteria.filterCriteria.push({
                            resourceType: filter.resourceType,
                            parameter: filter.filterParameter,
                            comparator: filter.comparator || 'eq',
                            value: filter.value
                        });
                    }
                }
            }

            // Parse criteria string (R4 style) - e.g., "Patient?identifier=123"
            if (subscription.criteria && typeof subscription.criteria === 'string') {
                const criteriaMatch = subscription.criteria.match(/^([A-Za-z]+)(\?.*)?$/);
                if (criteriaMatch) {
                    const resourceType = criteriaMatch[1];
                    if (!criteria.resourceTypes.includes(resourceType)) {
                        criteria.resourceTypes.push(resourceType);
                    }

                    // Parse query string filters
                    if (criteriaMatch[2]) {
                        const queryString = criteriaMatch[2].substring(1);
                        const params = new URLSearchParams(queryString);
                        for (const [param, value] of params) {
                            criteria.filterCriteria.push({
                                resourceType,
                                parameter: param,
                                comparator: 'eq',
                                value
                            });
                        }
                    }
                }
            }

            // If no resource types specified, match all
            if (criteria.resourceTypes.length === 0) {
                criteria.resourceTypes = ['*'];
            }

            return criteria;
        } catch (error) {
            logger.error('SubscriptionMatcher: Error parsing subscription criteria', {
                subscriptionId: subscription.id || subscription._id,
                error: error.message
            });
            return null;
        }
    }

    /**
     * Ensure cache is fresh
     * @returns {Promise<void>}
     * @private
     */
    async _ensureCacheFreshAsync() {
        const now = new Date();
        if (!this._lastCacheRefresh || (now - this._lastCacheRefresh) > this._cacheTtlMs) {
            await this.refreshCacheAsync();
        }
    }

    /**
     * Match a resource change against all active subscriptions
     * @param {Object} params
     * @param {string} params.resourceType - FHIR resource type
     * @param {Object} params.resource - The changed resource
     * @param {string} params.eventType - Event type: 'C' (create), 'U' (update), 'D' (delete)
     * @returns {Promise<MatchResult[]>}
     */
    async matchResourceAsync({ resourceType, resource, eventType }) {
        await this._ensureCacheFreshAsync();

        const results = [];
        const eventTypeMap = { C: 'create', U: 'update', D: 'delete' };
        const normalizedEventType = eventTypeMap[eventType] || eventType;

        for (const [subscriptionId, criteria] of this._subscriptionCache) {
            const result = this._matchAgainstCriteria({
                resourceType,
                resource,
                eventType: normalizedEventType,
                criteria
            });

            if (result.matches) {
                results.push(result);
            }
        }

        logger.debug('SubscriptionMatcher: Resource matched', {
            resourceType,
            resourceId: resource.id || resource._id,
            eventType: normalizedEventType,
            matchCount: results.length
        });

        return results;
    }

    /**
     * Match a specific subscription
     * @param {Object} params
     * @param {string} params.subscriptionId - Subscription ID to match against
     * @param {string} params.resourceType - FHIR resource type
     * @param {Object} params.resource - The changed resource
     * @param {string} params.eventType - Event type
     * @returns {Promise<MatchResult>}
     */
    async matchSubscriptionAsync({ subscriptionId, resourceType, resource, eventType }) {
        await this._ensureCacheFreshAsync();

        const criteria = this._subscriptionCache.get(subscriptionId);
        if (!criteria) {
            return {
                matches: false,
                subscriptionId,
                reason: 'Subscription not found or not active'
            };
        }

        const eventTypeMap = { C: 'create', U: 'update', D: 'delete' };
        const normalizedEventType = eventTypeMap[eventType] || eventType;

        return this._matchAgainstCriteria({
            resourceType,
            resource,
            eventType: normalizedEventType,
            criteria
        });
    }

    /**
     * Match resource against specific criteria
     * @param {Object} params
     * @param {string} params.resourceType
     * @param {Object} params.resource
     * @param {string} params.eventType
     * @param {SubscriptionCriteria} params.criteria
     * @returns {MatchResult}
     * @private
     */
    _matchAgainstCriteria({ resourceType, resource, eventType, criteria }) {
        // Check if resource type matches
        if (!criteria.resourceTypes.includes('*') && !criteria.resourceTypes.includes(resourceType)) {
            return {
                matches: false,
                subscriptionId: criteria.subscriptionId,
                reason: `Resource type ${resourceType} not in subscription criteria`
            };
        }

        // Check if event type matches
        if (!criteria.triggerTypes.includes(eventType)) {
            return {
                matches: false,
                subscriptionId: criteria.subscriptionId,
                reason: `Event type ${eventType} not in subscription triggers`
            };
        }

        // Check filter criteria
        for (const filter of criteria.filterCriteria) {
            // Skip if filter is for different resource type
            if (filter.resourceType && filter.resourceType !== resourceType) {
                continue;
            }

            const matches = this._evaluateFilter(resource, filter);
            if (!matches) {
                return {
                    matches: false,
                    subscriptionId: criteria.subscriptionId,
                    reason: `Filter ${filter.parameter}=${filter.value} did not match`
                };
            }
        }

        return {
            matches: true,
            subscriptionId: criteria.subscriptionId,
            reason: 'All criteria matched',
            topicUrl: criteria.topicUrl
        };
    }

    /**
     * Evaluate a single filter against a resource
     * @param {Object} resource
     * @param {Object} filter
     * @returns {boolean}
     * @private
     */
    _evaluateFilter(resource, filter) {
        const { parameter, comparator, value } = filter;

        // Get the value from the resource using dot notation
        const resourceValue = NestedPropertyReader.getNestedProperty({
            obj: resource,
            path: parameter
        });

        if (resourceValue === undefined || resourceValue === null) {
            return false;
        }

        // Handle array values (e.g., identifiers)
        const valuesToCheck = Array.isArray(resourceValue) ? resourceValue : [resourceValue];

        for (const val of valuesToCheck) {
            let checkValue = val;

            // Handle complex types like Identifier, CodeableConcept, etc.
            if (typeof val === 'object') {
                // For Identifier: check system|value or just value
                if (val.value !== undefined) {
                    if (value.includes('|')) {
                        checkValue = `${val.system || ''}|${val.value}`;
                    } else {
                        checkValue = val.value;
                    }
                }
                // For Reference: check reference
                else if (val.reference !== undefined) {
                    checkValue = val.reference;
                }
                // For CodeableConcept: check coding
                else if (val.coding && Array.isArray(val.coding)) {
                    for (const coding of val.coding) {
                        if (this._compareValues(coding.code, value, comparator) ||
                            this._compareValues(`${coding.system}|${coding.code}`, value, comparator)) {
                            return true;
                        }
                    }
                    continue;
                }
            }

            if (this._compareValues(checkValue, value, comparator)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Compare two values based on comparator
     * @param {*} resourceValue
     * @param {*} filterValue
     * @param {string} comparator
     * @returns {boolean}
     * @private
     */
    _compareValues(resourceValue, filterValue, comparator) {
        const strResourceValue = String(resourceValue).toLowerCase();
        const strFilterValue = String(filterValue).toLowerCase();

        switch (comparator) {
            case 'eq':
                return strResourceValue === strFilterValue;
            case 'ne':
                return strResourceValue !== strFilterValue;
            case 'gt':
                return resourceValue > filterValue;
            case 'lt':
                return resourceValue < filterValue;
            case 'ge':
                return resourceValue >= filterValue;
            case 'le':
                return resourceValue <= filterValue;
            case 'sa': // starts-after
                return strResourceValue > strFilterValue;
            case 'eb': // ends-before
                return strResourceValue < strFilterValue;
            case 'co': // contains
                return strResourceValue.includes(strFilterValue);
            case 'sw': // starts-with
                return strResourceValue.startsWith(strFilterValue);
            case 'ew': // ends-with
                return strResourceValue.endsWith(strFilterValue);
            default:
                return strResourceValue === strFilterValue;
        }
    }

    /**
     * Get all active subscriptions
     * @returns {Promise<SubscriptionCriteria[]>}
     */
    async getActiveSubscriptionsAsync() {
        await this._ensureCacheFreshAsync();
        return Array.from(this._subscriptionCache.values());
    }

    /**
     * Get subscription criteria by ID
     * @param {string} subscriptionId
     * @returns {Promise<SubscriptionCriteria|null>}
     */
    async getSubscriptionCriteriaAsync(subscriptionId) {
        await this._ensureCacheFreshAsync();
        return this._subscriptionCache.get(subscriptionId) || null;
    }

    /**
     * Force refresh of a specific subscription
     * @param {string} subscriptionId
     * @returns {Promise<void>}
     */
    async refreshSubscriptionAsync(subscriptionId) {
        try {
            const databaseQueryManager = this.databaseQueryFactory.createQuery({
                resourceType: 'Subscription',
                base_version: '4_0_0'
            });

            const subscription = await databaseQueryManager.findOneAsync({
                query: { id: subscriptionId }
            });

            if (subscription && subscription.status === 'active') {
                const criteria = this._parseSubscriptionCriteria(subscription);
                if (criteria) {
                    this._subscriptionCache.set(subscriptionId, criteria);
                }
            } else {
                this._subscriptionCache.delete(subscriptionId);
            }
        } catch (error) {
            logger.error('SubscriptionMatcher: Error refreshing subscription', {
                subscriptionId,
                error: error.message
            });
        }
    }

    /**
     * Remove subscription from cache (e.g., when deactivated)
     * @param {string} subscriptionId
     */
    removeSubscription(subscriptionId) {
        this._subscriptionCache.delete(subscriptionId);
    }

    /**
     * Clear the cache
     */
    clearCache() {
        this._subscriptionCache.clear();
        this._lastCacheRefresh = null;
    }

    /**
     * Get cache statistics
     * @returns {Object}
     */
    getCacheStats() {
        return {
            size: this._subscriptionCache.size,
            lastRefresh: this._lastCacheRefresh,
            subscriptionIds: Array.from(this._subscriptionCache.keys())
        };
    }
}

module.exports = {
    SubscriptionMatcher
};
