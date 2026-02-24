/**
 * SubscriptionTopic Manager
 * Manages SubscriptionTopic fixtures and provides search functionality
 * Per FHIR R5 Subscriptions IG - topics define what events can trigger subscriptions
 */
const { assertTypeEquals } = require('../utils/assertType');
const { getLogger } = require('../winstonInit');
const { DatabaseQueryFactory } = require('../dataLayer/databaseQueryFactory');
const { ConfigManager } = require('../utils/configManager');

const logger = getLogger();

/**
 * Standard SubscriptionTopic fixtures per FHIR R5 Subscriptions IG
 * These define what types of resources/events clients can subscribe to
 */
const SUBSCRIPTION_TOPIC_FIXTURES = [
    {
        resourceType: 'SubscriptionTopic',
        id: 'patient-create-update',
        url: 'http://icanbwell.com/fhir/SubscriptionTopic/patient-create-update',
        version: '1.0.0',
        name: 'PatientCreateUpdate',
        title: 'Patient Create and Update',
        status: 'active',
        date: '2026-02-23',
        publisher: 'b.well Connected Health',
        description: 'Subscription topic for Patient resource create and update events',
        resourceTrigger: [
            {
                description: 'Trigger on Patient create',
                resource: 'Patient',
                supportedInteraction: ['create']
            },
            {
                description: 'Trigger on Patient update',
                resource: 'Patient',
                supportedInteraction: ['update']
            }
        ],
        canFilterBy: [
            {
                description: 'Filter by patient identifier',
                resource: 'Patient',
                filterParameter: 'identifier',
                comparator: ['eq']
            },
            {
                description: 'Filter by patient ID',
                resource: 'Patient',
                filterParameter: '_id',
                comparator: ['eq']
            }
        ],
        notificationShape: [
            {
                resource: 'Patient',
                include: ['Patient:*']
            }
        ]
    },
    {
        resourceType: 'SubscriptionTopic',
        id: 'observation-create-update',
        url: 'http://icanbwell.com/fhir/SubscriptionTopic/observation-create-update',
        version: '1.0.0',
        name: 'ObservationCreateUpdate',
        title: 'Observation Create and Update',
        status: 'active',
        date: '2026-02-23',
        publisher: 'b.well Connected Health',
        description: 'Subscription topic for Observation resource create and update events',
        resourceTrigger: [
            {
                description: 'Trigger on Observation create',
                resource: 'Observation',
                supportedInteraction: ['create']
            },
            {
                description: 'Trigger on Observation update',
                resource: 'Observation',
                supportedInteraction: ['update']
            }
        ],
        canFilterBy: [
            {
                description: 'Filter by patient reference',
                resource: 'Observation',
                filterParameter: 'patient',
                comparator: ['eq']
            },
            {
                description: 'Filter by observation code',
                resource: 'Observation',
                filterParameter: 'code',
                comparator: ['eq']
            },
            {
                description: 'Filter by category',
                resource: 'Observation',
                filterParameter: 'category',
                comparator: ['eq']
            }
        ],
        notificationShape: [
            {
                resource: 'Observation',
                include: ['Observation:patient', 'Observation:subject']
            }
        ]
    },
    {
        resourceType: 'SubscriptionTopic',
        id: 'encounter-create-update',
        url: 'http://icanbwell.com/fhir/SubscriptionTopic/encounter-create-update',
        version: '1.0.0',
        name: 'EncounterCreateUpdate',
        title: 'Encounter Create and Update',
        status: 'active',
        date: '2026-02-23',
        publisher: 'b.well Connected Health',
        description: 'Subscription topic for Encounter resource create and update events',
        resourceTrigger: [
            {
                description: 'Trigger on Encounter create',
                resource: 'Encounter',
                supportedInteraction: ['create']
            },
            {
                description: 'Trigger on Encounter update',
                resource: 'Encounter',
                supportedInteraction: ['update']
            }
        ],
        canFilterBy: [
            {
                description: 'Filter by patient reference',
                resource: 'Encounter',
                filterParameter: 'patient',
                comparator: ['eq']
            },
            {
                description: 'Filter by encounter status',
                resource: 'Encounter',
                filterParameter: 'status',
                comparator: ['eq']
            }
        ],
        notificationShape: [
            {
                resource: 'Encounter',
                include: ['Encounter:patient', 'Encounter:subject']
            }
        ]
    },
    {
        resourceType: 'SubscriptionTopic',
        id: 'all-resources',
        url: 'http://icanbwell.com/fhir/SubscriptionTopic/all-resources',
        version: '1.0.0',
        name: 'AllResources',
        title: 'All Resource Changes',
        status: 'active',
        date: '2026-02-23',
        publisher: 'b.well Connected Health',
        description: 'Subscription topic for all resource create, update, and delete events. Use with caution - high volume.',
        resourceTrigger: [
            {
                description: 'Trigger on any resource create',
                resource: 'Resource',
                supportedInteraction: ['create']
            },
            {
                description: 'Trigger on any resource update',
                resource: 'Resource',
                supportedInteraction: ['update']
            },
            {
                description: 'Trigger on any resource delete',
                resource: 'Resource',
                supportedInteraction: ['delete']
            }
        ],
        canFilterBy: [
            {
                description: 'Filter by resource type',
                resource: 'Resource',
                filterParameter: '_type',
                comparator: ['eq']
            }
        ]
    }
];

class SubscriptionTopicManager {
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
         * In-memory cache of topics (fixtures are static)
         * @type {Map<string, Object>}
         */
        this._topicCache = new Map();

        /**
         * Map of topic URL to topic (for fast lookup)
         * @type {Map<string, Object>}
         */
        this._topicByUrl = new Map();

        // Initialize cache with fixtures
        this._initializeCache();
    }

    /**
     * Initialize the cache with fixture topics
     * @private
     */
    _initializeCache() {
        for (const topic of SUBSCRIPTION_TOPIC_FIXTURES) {
            this._topicCache.set(topic.id, topic);
            this._topicByUrl.set(topic.url, topic);
        }
        logger.info('SubscriptionTopicManager: Initialized with fixtures', {
            topicCount: this._topicCache.size
        });
    }

    /**
     * Get all available SubscriptionTopics
     * @returns {Object[]}
     */
    getAllTopics() {
        return Array.from(this._topicCache.values());
    }

    /**
     * Get a SubscriptionTopic by ID
     * @param {string} id
     * @returns {Object|null}
     */
    getTopicById(id) {
        return this._topicCache.get(id) || null;
    }

    /**
     * Get a SubscriptionTopic by URL
     * @param {string} url
     * @returns {Object|null}
     */
    getTopicByUrl(url) {
        return this._topicByUrl.get(url) || null;
    }

    /**
     * Search topics with optional filters
     * @param {Object} params
     * @param {string} [params.url] - Filter by URL
     * @param {string} [params.status] - Filter by status
     * @param {string} [params.name] - Filter by name (partial match)
     * @param {string} [params.resource] - Filter by trigger resource type
     * @returns {Object[]}
     */
    searchTopics({ url, status, name, resource } = {}) {
        let results = this.getAllTopics();

        if (url) {
            results = results.filter(t => t.url === url);
        }

        if (status) {
            results = results.filter(t => t.status === status);
        }

        if (name) {
            const nameLower = name.toLowerCase();
            results = results.filter(t =>
                t.name?.toLowerCase().includes(nameLower) ||
                t.title?.toLowerCase().includes(nameLower)
            );
        }

        if (resource) {
            results = results.filter(t =>
                t.resourceTrigger?.some(rt => rt.resource === resource || rt.resource === 'Resource')
            );
        }

        return results;
    }

    /**
     * Validate that a Subscription's criteria matches a valid topic
     * @param {Object} subscription - FHIR Subscription resource
     * @returns {Object} - { valid: boolean, topic: Object|null, error: string|null }
     */
    validateSubscriptionTopic(subscription) {
        // Check for topic reference (R5 style)
        const topicUrl = subscription.topic || subscription.criteria;

        if (!topicUrl) {
            return {
                valid: false,
                topic: null,
                error: 'Subscription must specify a topic URL or criteria'
            };
        }

        // Try to find topic by URL
        let topic = this.getTopicByUrl(topicUrl);

        // If not found by URL, try parsing criteria string (R4 style)
        if (!topic && typeof topicUrl === 'string') {
            // R4 criteria format: "ResourceType" or "ResourceType?query"
            const match = topicUrl.match(/^([A-Za-z]+)(\?.*)?$/);
            if (match) {
                const resourceType = match[1];
                // Find a topic that supports this resource type
                const matchingTopics = this.searchTopics({ resource: resourceType });
                if (matchingTopics.length > 0) {
                    topic = matchingTopics[0];
                }
            }
        }

        if (!topic) {
            return {
                valid: false,
                topic: null,
                error: `Unknown SubscriptionTopic: ${topicUrl}. Use GET /SubscriptionTopic to discover available topics.`
            };
        }

        return {
            valid: true,
            topic,
            error: null
        };
    }

    /**
     * Get resource types supported by a topic
     * @param {string} topicId
     * @returns {string[]}
     */
    getSupportedResourceTypes(topicId) {
        const topic = this.getTopicById(topicId);
        if (!topic || !topic.resourceTrigger) {
            return [];
        }

        return [...new Set(topic.resourceTrigger.map(rt => rt.resource))];
    }

    /**
     * Get supported interactions for a topic and resource type
     * @param {string} topicId
     * @param {string} resourceType
     * @returns {string[]}
     */
    getSupportedInteractions(topicId, resourceType) {
        const topic = this.getTopicById(topicId);
        if (!topic || !topic.resourceTrigger) {
            return [];
        }

        const interactions = [];
        for (const trigger of topic.resourceTrigger) {
            if (trigger.resource === resourceType || trigger.resource === 'Resource') {
                interactions.push(...(trigger.supportedInteraction || []));
            }
        }

        return [...new Set(interactions)];
    }

    /**
     * Create a Bundle containing all topics (for search results)
     * @param {Object[]} topics
     * @returns {Object}
     */
    createSearchBundle(topics) {
        return {
            resourceType: 'Bundle',
            type: 'searchset',
            total: topics.length,
            entry: topics.map(topic => ({
                fullUrl: `SubscriptionTopic/${topic.id}`,
                resource: topic,
                search: {
                    mode: 'match'
                }
            }))
        };
    }
}

module.exports = {
    SubscriptionTopicManager,
    SUBSCRIPTION_TOPIC_FIXTURES
};
